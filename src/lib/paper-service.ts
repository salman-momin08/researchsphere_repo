
"use client";

import {
  collection,
  addDoc,
  getDoc,
  doc,
  query,
  where,
  getDocs,
  updateDoc,
  orderBy,
  Timestamp,
  serverTimestamp,
  deleteDoc,
  arrayUnion
} from "firebase/firestore";
import { auth, db as firestoreDb } from "@/lib/firebase";
import type { Paper, PaperStatus, Review } from '@/types';

// Helper to convert Firestore Timestamps in paper data
const convertPaperTimestamps = (paperData: any): Paper => {
  const convert = (timestamp: any) => {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
    if (typeof timestamp === 'string') {
      if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
    }
    if (typeof timestamp === 'object' && timestamp._seconds && typeof timestamp._seconds === 'number') {
      return new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1000000).toISOString();
    }
    return String(timestamp); // Fallback
  };

  const reviews = paperData.reviews?.map((review: any) => ({
    ...review,
    submittedAt: convert(review.submittedAt),
  })) || [];

  return {
    ...paperData,
    uploadDate: convert(paperData.uploadDate),
    submissionDate: convert(paperData.submissionDate),
    paymentDueDate: convert(paperData.paymentDueDate),
    paidAt: convert(paperData.paidAt),
    lastUpdatedAt: convert(paperData.lastUpdatedAt),
    reviews: reviews,
  } as Paper;
};

const uploadToCloudinary = async (file: File): Promise<{ secure_url: string; original_filename: string; public_id: string, format: string, resource_type: string } | null> => {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    const errorMsg = "Cloudinary configuration (cloud name or upload preset) is missing.";
    console.error("Paper Service (uploadToCloudinary):", errorMsg);
    throw new Error(errorMsg);
  }
  
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      const cloudinaryErrorMsg = data.error?.message || `Cloudinary upload failed with status ${response.status}.`;
      console.error("Paper Service (uploadToCloudinary): Cloudinary upload failed:", cloudinaryErrorMsg);
      throw new Error(cloudinaryErrorMsg);
    }
    return {
      secure_url: data.secure_url,
      original_filename: data.original_filename || file.name || 'uploaded_paper_file',
      public_id: data.public_id,
      format: data.format,
      resource_type: data.resource_type
    };
  } catch (error: any) {
    console.error("Paper Service (uploadToCloudinary): Error during Cloudinary upload:", error.message);
    throw error;
  }
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName' | 'lastUpdatedAt' | 'reviews' | 'assignedReviewerIds'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File | null,
  userIdClient: string,
  existingPaperId?: string
): Promise<Paper> => {
  if (!auth.currentUser) throw new Error("User not authenticated.");
  if (auth.currentUser.uid !== userIdClient) throw new Error("User ID mismatch.");
  if (!firestoreDb) throw new Error("Database service not available.");

  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: Date | Timestamp | null = null;
  let paidAt: Date | Timestamp | null = null;
  let submissionDate: Date | Timestamp | null = Timestamp.fromDate(now); // Default submission date

  let cloudinaryFileUrl: string | null = null;
  let originalFileName: string | null = null;

  if (existingPaperId) {
    const paperDocRef = doc(firestoreDb, "papers", existingPaperId);
    const paperSnap = await getDoc(paperDocRef);
    if (!paperSnap.exists()) throw new Error("Original paper not found for update.");
    const existingPaperData = paperSnap.data();
    cloudinaryFileUrl = existingPaperData.fileUrl || null;
    originalFileName = existingPaperData.fileName || null;
    status = 'Submitted';
    paidAt = Timestamp.fromDate(now);
    // submissionDate is already set or will be set to now if not previously set.
    submissionDate = existingPaperData.submissionDate ? (existingPaperData.submissionDate instanceof Timestamp ? existingPaperData.submissionDate : Timestamp.fromDate(new Date(existingPaperData.submissionDate))) : Timestamp.fromDate(now);
    paymentDueDate = null;
  } else {
    if (!fileToUpload) throw new Error("File is required for new paper submission.");
    const cloudinaryResult = await uploadToCloudinary(fileToUpload);
    if (!cloudinaryResult || !cloudinaryResult.secure_url) throw new Error("File upload to Cloudinary failed.");
    cloudinaryFileUrl = cloudinaryResult.secure_url;
    originalFileName = cloudinaryResult.original_filename;

    if (paperData.paymentOption === 'payLater') {
      status = 'Payment Pending';
      paymentDueDate = Timestamp.fromDate(new Date(now.getTime() + 2 * 60 * 60 * 1000));
      submissionDate = null; // Not formally submitted until paid
      paidAt = null;
    } else { // 'payNow' for a new paper
      status = 'Submitted'; // Or 'Payment Pending' if payment is a separate step after this initial save
      paidAt = Timestamp.fromDate(now); // Assume paid if 'payNow' for initial creation
      submissionDate = Timestamp.fromDate(now);
      paymentDueDate = null;
    }
  }

  const paperDocData: Omit<Paper, 'id' | 'lastUpdatedAt'> = {
    userId: userIdClient,
    title: paperData.title,
    abstract: paperData.abstract,
    authors: paperData.authors,
    keywords: paperData.keywords,
    fileName: originalFileName || null,
    fileUrl: cloudinaryFileUrl || null,
    uploadDate: existingPaperId ? 
                  (await getDoc(doc(firestoreDb, "papers", existingPaperId))).data()?.uploadDate.toDate().toISOString() :
                  now.toISOString(),
    status: status,
    paymentOption: paperData.paymentOption,
    paymentDueDate: paymentDueDate instanceof Timestamp ? paymentDueDate.toDate().toISOString() : null,
    paidAt: paidAt instanceof Timestamp ? paidAt.toDate().toISOString() : null,
    submissionDate: submissionDate instanceof Timestamp ? submissionDate.toDate().toISOString() : null,
    plagiarismScore: null, 
    acceptanceProbability: null,
    plagiarismReport: null,
    acceptanceReport: null,
    adminFeedback: null,
    assignedReviewerIds: [],
    reviews: [],
  };

  if (existingPaperId) {
    const updatePayload: any = {
      status,
      paidAt: paidAt instanceof Timestamp ? paidAt : (paidAt ? Timestamp.fromDate(new Date(paidAt)) : null),
      submissionDate: submissionDate instanceof Timestamp ? submissionDate : (submissionDate ? Timestamp.fromDate(new Date(submissionDate)) : null),
      paymentDueDate: null,
      lastUpdatedAt: serverTimestamp(),
    };
    const paperDocRef = doc(firestoreDb, "papers", existingPaperId);
    await updateDoc(paperDocRef, updatePayload);
    const updatedSnap = await getDoc(paperDocRef);
    if (!updatedSnap.exists()) throw new Error("Failed to fetch paper after status update.");
    return { ...convertPaperTimestamps(updatedSnap.data()), id: existingPaperId };
  } else {
    const paperDocForFirestore = {
      ...paperDocData,
      uploadDate: paperDocData.uploadDate ? Timestamp.fromDate(new Date(paperDocData.uploadDate)) : serverTimestamp(),
      submissionDate: paperDocData.submissionDate ? Timestamp.fromDate(new Date(paperDocData.submissionDate)) : null,
      paidAt: paperDocData.paidAt ? Timestamp.fromDate(new Date(paperDocData.paidAt)) : null,
      paymentDueDate: paperDocData.paymentDueDate ? Timestamp.fromDate(new Date(paperDocData.paymentDueDate)) : null,
      lastUpdatedAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(firestoreDb, "papers"), paperDocForFirestore);
    const newDocSnap = await getDoc(docRef);
     if (!newDocSnap.exists()) throw new Error("Failed to fetch newly created paper.");
    return { ...convertPaperTimestamps(newDocSnap.data()), id: docRef.id };
  }
};


export const getPaper = async (paperId: string): Promise<Paper | null> => {
  if (!firestoreDb) return null;
  const paperDocRef = doc(firestoreDb, "papers", paperId);
  const paperSnap = await getDoc(paperDocRef);
  if (paperSnap.exists()) {
    return convertPaperTimestamps({ id: paperSnap.id, ...paperSnap.data() });
  }
  return null;
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  if (!firestoreDb) return [];
  const papersRef = collection(firestoreDb, "papers");
  const q = query(papersRef, where("userId", "==", userId), orderBy("uploadDate", "desc"));
  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  } catch (error: any) {
    throw error; 
  }
};

export const getAllPapers = async (): Promise<Paper[]> => {
  if (!firestoreDb) return [];
  const papersRef = collection(firestoreDb, "papers");
  const q = query(papersRef, orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
};

export const getPapersForReviewer = async (reviewerId: string): Promise<Paper[]> => {
  if (!firestoreDb) return [];
  const papersRef = collection(firestoreDb, "papers");
  // Firestore doesn't support array-contains-any for multiple values in a single query efficiently for this use case with ordering.
  // It's often better to query for papers under review and filter client-side or restructure data.
  // For now, a broader query and client-side filter is implied if not directly querying by array-contains.
  // A direct query:
  const q = query(papersRef, where("assignedReviewerIds", "array-contains", reviewerId), orderBy("uploadDate", "desc"));
  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  } catch (error: any) {
    console.error("Error fetching papers for reviewer:", error);
    throw error;
  }
};


export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  if (!firestoreDb) throw new Error("Database service unavailable.");
  const paperDocRef = doc(firestoreDb, "papers", paperId);
  const updateData: Partial<Paper & { lastUpdatedAt: any, paymentDueDate: any | null, submissionDate: any | null, paidAt: any | null }> = { status, lastUpdatedAt: serverTimestamp() };

  if (paymentDetails?.paidAt) {
    updateData.paidAt = Timestamp.fromDate(new Date(paymentDetails.paidAt));
  }

  if (status === 'Submitted') {
    updateData.submissionDate = serverTimestamp(); 
    updateData.paymentDueDate = null; 
    if (!updateData.paidAt) { 
      updateData.paidAt = serverTimestamp();
    }
  } else if (status === 'Payment Pending') {
    const paperSnap = await getDoc(paperDocRef);
    const existingPaperData = paperSnap.data();
    if (paperSnap.exists() && (!existingPaperData || !existingPaperData.paymentDueDate || (existingPaperData.paidAt))) { 
        const dueDate = new Date();
        dueDate.setHours(dueDate.getHours() + 2); 
        updateData.paymentDueDate = Timestamp.fromDate(dueDate);
    }
  }

  await updateDoc(paperDocRef, updateData);
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after status update.");
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id' | 'lastUpdatedAt'>>): Promise<Paper> => {
  if (!firestoreDb) throw new Error("Database service unavailable.");
  const paperDocRef = doc(firestoreDb, "papers", paperId);
  // Ensure arrays are handled correctly for Firestore (e.g., not undefined)
  const updatePayload = { ...data };
  if (updatePayload.assignedReviewerIds === undefined) {
    delete updatePayload.assignedReviewerIds; // Or set to [] if appropriate for your logic
  }
  if (updatePayload.reviews === undefined) {
    delete updatePayload.reviews; // Or set to []
  }
  
  await updateDoc(paperDocRef, { ...updatePayload, lastUpdatedAt: serverTimestamp() });
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after data update.");
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const addReviewToPaper = async (paperId: string, review: Review): Promise<Paper> => {
  if (!firestoreDb) throw new Error("Database service unavailable.");
  const paperDocRef = doc(firestoreDb, "papers", paperId);
  
  const reviewForFirestore = {
    ...review,
    submittedAt: Timestamp.fromDate(new Date(review.submittedAt)), // Ensure it's a Firestore Timestamp
  };

  await updateDoc(paperDocRef, {
    reviews: arrayUnion(reviewForFirestore),
    lastUpdatedAt: serverTimestamp(),
  });
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after adding review.");
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};


export const getPublishedPapers = async (): Promise<Paper[]> => {
  if (!firestoreDb) return [];
  const papersRef = collection(firestoreDb, "papers");
  const q = query(papersRef, where("status", "==", "Published"), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
};

