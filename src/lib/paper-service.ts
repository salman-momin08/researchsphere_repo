
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
  const convert = (timestamp: any): string | null => {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
    if (typeof timestamp === 'string') {
      if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
    }
     if (timestamp instanceof Date) return timestamp.toISOString();
    if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
      return new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000).toISOString();
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
    console.error("Paper Service (uploadToCloudinary):", errorMsg); // Keep critical config error
    throw new Error(errorMsg);
  }
  
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  formData.append("resource_type", "auto"); // Explicitly tell Cloudinary to auto-detect resource type

  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      const cloudinaryErrorMsg = data.error?.message || `Cloudinary upload failed with status ${response.status}.`;
      console.error("Paper Service (uploadToCloudinary): Cloudinary upload failed:", cloudinaryErrorMsg); // Keep critical upload error
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
    console.error("Paper Service (uploadToCloudinary): Error during Cloudinary upload:", error.message); // Keep critical upload error
    throw error;
  }
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName' | 'lastUpdatedAt' | 'reviews' | 'assignedReviewerIds'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File | null,
  userIdClient: string,
  existingPaperId?: string
): Promise<Paper> => {
  if (!auth?.currentUser) throw new Error("User not authenticated.");
  if (auth.currentUser.uid !== userIdClient) throw new Error("User ID mismatch.");
  if (!firestoreDb) throw new Error("Database service not available.");

  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: Date | Timestamp | null = null;
  let paidAt: Date | Timestamp | null = null;
  let submissionDate: Date | Timestamp | null = Timestamp.fromDate(now); 

  let cloudinaryFileUrl: string | null = null;
  let originalFileName: string | null = null;

  if (existingPaperId) {
    const paperDocRef = doc(firestoreDb, "papers", existingPaperId);
    const paperSnap = await getDoc(paperDocRef);
    if (!paperSnap.exists()) throw new Error("Original paper not found for update.");
    const existingPaperData = paperSnap.data();
    cloudinaryFileUrl = existingPaperData.fileUrl || null;
    originalFileName = existingPaperData.fileName || null;
    status = 'Submitted'; // Explicitly submitted after payment
    paidAt = Timestamp.fromDate(now);
    submissionDate = Timestamp.fromDate(now); // Set submission date on payment
    paymentDueDate = null;
  } else {
    if (!fileToUpload) throw new Error("File is required for new paper submission.");
    const cloudinaryResult = await uploadToCloudinary(fileToUpload);
    if (!cloudinaryResult || !cloudinaryResult.secure_url) throw new Error("File upload to Cloudinary failed.");
    cloudinaryFileUrl = cloudinaryResult.secure_url;
    originalFileName = cloudinaryResult.original_filename || fileToUpload.name || 'uploaded_file';

    if (paperData.paymentOption === 'payLater') {
      status = 'Payment Pending';
      paymentDueDate = Timestamp.fromDate(new Date(now.getTime() + 2 * 60 * 60 * 1000)); // 2 hours
      submissionDate = null; 
      paidAt = null;
    } else { // 'payNow' for a new paper (initial creation before modal)
      status = 'Payment Pending'; // Initially payment pending, will be updated after successful payment
      // paymentDueDate could be set here too, or handled by UI implicitly before payment modal
      paymentDueDate = Timestamp.fromDate(new Date(now.getTime() + 2 * 60 * 60 * 1000)); // Also give a due date
      submissionDate = null;
      paidAt = null;
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
    uploadDate: existingPaperId && (await getDoc(doc(firestoreDb, "papers", existingPaperId))).data()?.uploadDate instanceof Timestamp ? 
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
      status: 'Submitted', // Assuming this update is post-payment
      paidAt: Timestamp.fromDate(now),
      submissionDate: Timestamp.fromDate(now),
      paymentDueDate: null, // Payment is done
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
    console.error("PaperService (getUserPapers): Error fetching papers:", error.message); // Keep critical fetch error
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
  const q = query(papersRef, where("assignedReviewerIds", "array-contains", reviewerId), orderBy("uploadDate", "desc"));
  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  } catch (error: any) {
    console.error("PaperService (getPapersForReviewer): Error fetching papers:", error.message); // Keep critical fetch error
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
    if (paperSnap.exists()) {
        const existingPaperData = paperSnap.data();
        if (!existingPaperData.paymentDueDate || existingPaperData.paidAt) { // Only set due date if not already pending or if it was paid
            const dueDate = new Date();
            dueDate.setHours(dueDate.getHours() + 2); 
            updateData.paymentDueDate = Timestamp.fromDate(dueDate);
        }
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
  
  const updatePayload = { ...data };
  // Ensure arrays are handled correctly for Firestore (e.g., not undefined)
  if ('assignedReviewerIds' in updatePayload && updatePayload.assignedReviewerIds === undefined) {
    delete updatePayload.assignedReviewerIds;
  }
  if ('reviews' in updatePayload && updatePayload.reviews === undefined) {
    delete updatePayload.reviews;
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
    submittedAt: review.submittedAt ? Timestamp.fromDate(new Date(review.submittedAt)) : serverTimestamp(),
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

export const deletePaper = async (paperId: string): Promise<void> => {
  if (!firestoreDb) {
    throw new Error("Database service unavailable.");
  }
  const paperDocRef = doc(firestoreDb, "papers", paperId);
  try {
    await deleteDoc(paperDocRef);
  } catch (error: any) {
    console.error(`PaperService (deletePaper): Error deleting paper ${paperId}:`, error.message);
    throw new Error(`Failed to delete paper: ${error.message}`);
  }
};
