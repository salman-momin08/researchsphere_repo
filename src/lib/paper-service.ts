
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
} from "firebase/firestore";
import { auth, db as firestoreDb } from "@/lib/firebase";
import type { Paper, PaperStatus } from '@/types';

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

  return {
    ...paperData,
    uploadDate: convert(paperData.uploadDate),
    submissionDate: convert(paperData.submissionDate),
    paymentDueDate: convert(paperData.paymentDueDate),
    paidAt: convert(paperData.paidAt),
    lastUpdatedAt: convert(paperData.lastUpdatedAt),
  } as Paper;
};

const uploadToCloudinary = async (file: File): Promise<{ secure_url: string; original_filename: string; public_id: string, format: string, resource_type: string } | null> => {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    const errorMsg = "Cloudinary configuration (cloud name or upload preset) is missing. Please check environment variables.";
    console.error("Paper Service (uploadToCloudinary):", errorMsg); // Critical for developers
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
      console.error("Paper Service (uploadToCloudinary): Cloudinary upload failed:", cloudinaryErrorMsg); // Critical for developers
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
    console.error("Paper Service (uploadToCloudinary): Error during Cloudinary upload:", error.message, error); // Critical for developers
    throw error; // Re-throw to be caught by calling function
  }
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName' | 'lastUpdatedAt'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File | null, // Required for new submissions
  userIdClient: string,
  existingPaperId?: string // For updating an existing paper (e.g., after PayNow)
): Promise<Paper> => {
  if (!auth.currentUser) {
    throw new Error("User not authenticated. Cannot submit paper.");
  }
  if (auth.currentUser.uid !== userIdClient) {
    throw new Error("User ID mismatch. Cannot submit paper for another user.");
  }

  if (!firestoreDb) {
    throw new Error("Database service not available. Please try again later.");
  }

  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: Date | Timestamp | null = null;
  let paidAt: Date | Timestamp | null = null;
  let submissionDate: Date | Timestamp | null = null;

  let cloudinaryFileUrl: string | null = null;
  let originalFileName: string | null = null;

  if (existingPaperId) {
    // This is an update flow, likely after "Pay Now" success
    const paperDocRef = doc(firestoreDb, "papers", existingPaperId);
    const paperSnap = await getDoc(paperDocRef);
    if (!paperSnap.exists()) {
      throw new Error("Original paper not found for update.");
    }
    const existingPaperData = paperSnap.data();
    cloudinaryFileUrl = existingPaperData.fileUrl || null;
    originalFileName = existingPaperData.fileName || null;

    // This flow is typically when paymentOption was 'payNow' and payment succeeded
    status = 'Submitted';
    paidAt = Timestamp.fromDate(now);
    submissionDate = Timestamp.fromDate(now);
    paymentDueDate = null;

  } else {
    // This is a new paper submission
    if (!fileToUpload) {
      throw new Error("File is required for new paper submission.");
    }

    const cloudinaryResult = await uploadToCloudinary(fileToUpload);
    if (!cloudinaryResult || !cloudinaryResult.secure_url) {
      throw new Error("File upload to Cloudinary failed or did not return a URL.");
    }
    cloudinaryFileUrl = cloudinaryResult.secure_url;
    originalFileName = cloudinaryResult.original_filename || fileToUpload.name || 'uploaded_paper_file';

    if (paperData.paymentOption === 'payLater') {
      status = 'Payment Pending';
      const dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); 
      paymentDueDate = Timestamp.fromDate(dueDate);
      submissionDate = null;
      paidAt = null;
    } else { // 'payNow' for a new paper (this path is now split, initial create then update)
             // This case for brand new + payNow means it's likely being created with "Payment Pending" initially
             // then updated after successful payment modal.
             // For direct submission with "Pay Now", it would set status to Submitted.
             // To handle the two-step "Pay Now" (create then pay then update):
      status = 'Payment Pending'; // Create as pending, then update after payment
      const dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); // Set a due date even for pay now initial record
      paymentDueDate = Timestamp.fromDate(dueDate);
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
    uploadDate: existingPaperId ? 
                  (await getDoc(doc(firestoreDb, "papers", existingPaperId))).data()?.uploadDate : // Keep original uploadDate
                  Timestamp.fromDate(now).toDate().toISOString(), // New paper uploadDate
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
  };

  if (existingPaperId) {
    const updatePayload: any = {
      status,
      paidAt: paidAt instanceof Date ? Timestamp.fromDate(paidAt) : paidAt, // Ensure it's Timestamp or null
      submissionDate: submissionDate instanceof Date ? Timestamp.fromDate(submissionDate) : submissionDate,
      paymentDueDate: null, // Clear due date after payment
      lastUpdatedAt: serverTimestamp(),
    };
    const paperDocRef = doc(firestoreDb, "papers", existingPaperId);
    await updateDoc(paperDocRef, updatePayload);
    const updatedSnap = await getDoc(paperDocRef);
    if (!updatedSnap.exists()) {
      throw new Error("Failed to fetch paper after status update.");
    }
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
     if (!newDocSnap.exists()) {
        throw new Error("Failed to fetch newly created paper.");
    }
    return { ...convertPaperTimestamps(newDocSnap.data()), id: docRef.id };
  }
};


export const getPaper = async (paperId: string): Promise<Paper | null> => {
  if (!firestoreDb) {
    return null;
  }
  const paperDocRef = doc(firestoreDb, "papers", paperId);
  const paperSnap = await getDoc(paperDocRef);

  if (paperSnap.exists()) {
    return convertPaperTimestamps({ id: paperSnap.id, ...paperSnap.data() });
  } else {
    return null;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  if (!firestoreDb) {
    return [];
  }
  const papersRef = collection(firestoreDb, "papers");
  const q = query(papersRef, where("userId", "==", userId), orderBy("uploadDate", "desc"));
  try {
    const querySnapshot = await getDocs(q);
    const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
    return papers;
  } catch (error: any) {
    console.error(`Paper Service (getUserPapers): Error fetching papers for user ${userId}:`, error.message, error.code); // Keep for dev
    throw error; 
  }
};

export const getAllPapers = async (): Promise<Paper[]> => {
  if (!firestoreDb) {
    return [];
  }
  const papersRef = collection(firestoreDb, "papers");
  const q = query(papersRef, orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  return papers;
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  if (!firestoreDb) {
    throw new Error("Database service unavailable.");
  }
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
    if (paperSnap.exists() && !paperSnap.data().paymentDueDate) { 
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
  if (!firestoreDb) {
    throw new Error("Database service unavailable.");
  }
  const paperDocRef = doc(firestoreDb, "papers", paperId);
  await updateDoc(paperDocRef, { ...data, lastUpdatedAt: serverTimestamp() });
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after data update.");
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  if (!firestoreDb) {
    return [];
  }
  const papersRef = collection(firestoreDb, "papers");
  const q = query(papersRef, where("status", "==", "Published"), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  return papers;
};
