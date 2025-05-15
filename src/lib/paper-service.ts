
"use client";

import {
  getFirestore,
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
} from "firebase/firestore";
import { auth, db as firestoreDb } from "@/lib/firebase";
import type { Paper, PaperStatus } from '@/types';

const convertPaperTimestamps = (paperData: any): Paper => {
  const convert = (timestamp: any) =>
    timestamp instanceof Timestamp ? timestamp.toDate().toISOString() : (timestamp || null);

  return {
    ...paperData,
    uploadDate: convert(paperData.uploadDate),
    submissionDate: convert(paperData.submissionDate),
    paymentDueDate: convert(paperData.paymentDueDate),
    paidAt: convert(paperData.paidAt),
    lastUpdatedAt: convert(paperData.lastUpdatedAt),
  } as Paper;
};

// Function to upload file to Cloudinary
const uploadToCloudinary = async (file: File): Promise<{ secure_url: string; original_filename: string; public_id: string, format: string, resource_type: string } | null> => {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  // console.log("Paper Service (uploadToCloudinary): Using Cloud Name:", cloudName);
  // console.log("Paper Service (uploadToCloudinary): Using Upload Preset:", uploadPreset);

  if (!cloudName || !uploadPreset) {
    console.error("Paper Service (uploadToCloudinary): Cloudinary configuration (cloud name or upload preset) is missing in environment variables.");
    throw new Error("Cloudinary configuration is missing. Please check NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET environment variables.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  try {
    // console.log(`Paper Service (uploadToCloudinary): Attempting to upload file "${file.name}" to Cloudinary.`);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Paper Service (uploadToCloudinary): Cloudinary upload failed:", data.error?.message || response.statusText);
      throw new Error(data.error?.message || "Cloudinary upload failed.");
    }

    // console.log("Paper Service (uploadToCloudinary): Cloudinary upload successful:", { url: data.secure_url, filename: data.original_filename });
    return {
      secure_url: data.secure_url,
      original_filename: data.original_filename,
      public_id: data.public_id,
      format: data.format,
      resource_type: data.resource_type
    };
  } catch (error) {
    console.error("Paper Service (uploadToCloudinary): Error during Cloudinary upload:", error);
    throw error;
  }
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName' | 'lastUpdatedAt'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File | null,
  userIdClient: string,
  existingPaperId?: string
): Promise<Paper> => {
  // console.log(`Paper Service (addPaper): Called. ExistingPaperId: ${existingPaperId}, File to upload name: ${fileToUpload?.name}`);
  if (!auth.currentUser) {
    console.error("Paper Service (addPaper): User not authenticated.");
    throw new Error("User not authenticated. Cannot submit paper.");
  }
  if (auth.currentUser.uid !== userIdClient) {
    console.error("Paper Service (addPaper): User ID mismatch.");
    throw new Error("User ID mismatch. Cannot submit paper for another user.");
  }

  const db = firestoreDb;
  if (!db) {
    console.error("Paper Service (addPaper): Firestore DB instance is not available.");
    throw new Error("Database service not available. Please try again later.");
  }
  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: Date | null = null;
  let paidAt: Date | null = null;
  let submissionDate: Date | Timestamp | null = null;

  let cloudinaryFileUrl: string | undefined = undefined;
  let originalFileName: string | undefined = undefined;

  if (existingPaperId) {
    // console.log(`Paper Service (addPaper): Updating existing paper ${existingPaperId} (likely post-payment).`);
    const paperDocRef = doc(db, "papers", existingPaperId);
    const paperSnap = await getDoc(paperDocRef);
    if (!paperSnap.exists()) {
      console.error(`Paper Service (addPaper): Original paper ${existingPaperId} not found for update.`);
      throw new Error("Original paper not found for update.");
    }
    const existingPaperData = paperSnap.data();
    cloudinaryFileUrl = existingPaperData.fileUrl;
    originalFileName = existingPaperData.fileName;

    if (paperData.paymentOption === 'payNow') {
      status = 'Submitted';
      paidAt = now;
      submissionDate = Timestamp.fromDate(now);
      paymentDueDate = null;
    } else {
      status = existingPaperData.status;
    }
  } else {
    if (!fileToUpload) {
      console.error("Paper Service (addPaper): File is required for new paper submission.");
      throw new Error("File is required for new paper submission.");
    }
    // console.log(`Paper Service (addPaper): New submission. Uploading file: ${fileToUpload.name}`);

    const cloudinaryResult = await uploadToCloudinary(fileToUpload);
    if (!cloudinaryResult || !cloudinaryResult.secure_url) {
      console.error("Paper Service (addPaper): File upload to Cloudinary failed or did not return a URL.");
      throw new Error("File upload failed.");
    }
    cloudinaryFileUrl = cloudinaryResult.secure_url;
    originalFileName = cloudinaryResult.original_filename;
    // console.log(`Paper Service (addPaper): Cloudinary upload successful. URL: ${cloudinaryFileUrl}`);

    if (paperData.paymentOption === 'payLater') {
      status = 'Payment Pending';
      const dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      paymentDueDate = dueDate;
      submissionDate = null;
      paidAt = null;
    } else { 
      status = 'Submitted';
      paidAt = now;
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
    fileName: originalFileName,
    fileUrl: cloudinaryFileUrl,
    uploadDate: existingPaperId ? (await getDoc(doc(db, "papers", existingPaperId))).data()?.uploadDate.toDate().toISOString() : Timestamp.fromDate(now).toDate().toISOString(),
    status: status,
    paymentOption: paperData.paymentOption,
    paymentDueDate: paymentDueDate ? paymentDueDate.toISOString() : null,
    paidAt: paidAt ? paidAt.toISOString() : null,
    submissionDate: submissionDate instanceof Timestamp ? submissionDate.toDate().toISOString() : null,
    plagiarismScore: null,
    acceptanceProbability: null,
    ...(existingPaperId && {
      plagiarismReport: (await getDoc(doc(db, "papers", existingPaperId))).data()?.plagiarismReport || null,
      acceptanceReport: (await getDoc(doc(db, "papers", existingPaperId))).data()?.acceptanceReport || null,
      adminFeedback: (await getDoc(doc(db, "papers", existingPaperId))).data()?.adminFeedback || null,
    })
  };

  if (existingPaperId) {
    const updatePayload: any = {
      status,
      paidAt: paidAt ? Timestamp.fromDate(paidAt) : null,
      submissionDate: submissionDate || null,
      paymentDueDate: paymentDueDate ? Timestamp.fromDate(paymentDueDate) : null,
      lastUpdatedAt: serverTimestamp(),
    };
    // console.log("Paper Service (addPaper - update existing): Updating Firestore doc:", existingPaperId, "Payload:", updatePayload);
    const paperDocRef = doc(db, "papers", existingPaperId);
    await updateDoc(paperDocRef, updatePayload);
    const updatedSnap = await getDoc(paperDocRef);
    if (!updatedSnap.exists()) {
      console.error("Paper Service (addPaper - update existing): Failed to fetch paper after status update for ID:", existingPaperId);
      throw new Error("Failed to fetch paper after status update.");
    }
    // console.log("Paper Service (addPaper - update existing): Firestore update successful for ID:", existingPaperId);
    return { ...convertPaperTimestamps(updatedSnap.data()), id: existingPaperId };
  } else {
    const paperDocForFirestore = {
      ...paperDocData,
      uploadDate: Timestamp.fromDate(new Date(paperDocData.uploadDate)),
      submissionDate: paperDocData.submissionDate ? Timestamp.fromDate(new Date(paperDocData.submissionDate)) : null,
      paidAt: paperDocData.paidAt ? Timestamp.fromDate(new Date(paperDocData.paidAt)) : null,
      paymentDueDate: paperDocData.paymentDueDate ? Timestamp.fromDate(new Date(paperDocData.paymentDueDate)) : null,
      lastUpdatedAt: serverTimestamp(),
    };
    // console.log("Paper Service (addPaper - new): Adding new document to Firestore. Data:", paperDocForFirestore);
    const docRef = await addDoc(collection(db, "papers"), paperDocForFirestore);
    // console.log("Paper Service (addPaper - new): Document added to Firestore with ID:", docRef.id);
    const newDocSnap = await getDoc(docRef);
     if (!newDocSnap.exists()) {
        console.error("Paper Service (addPaper - new): Failed to fetch newly created paper from Firestore:", docRef.id);
        throw new Error("Failed to fetch newly created paper.");
    }
    return { ...convertPaperTimestamps(newDocSnap.data()), id: docRef.id };
  }
};


export const getPaper = async (paperId: string): Promise<Paper | null> => {
  const db = firestoreDb;
  if (!db) {
    console.error("Paper Service (getPaper): Firestore DB instance is not available.");
    return null;
  }
  const paperDocRef = doc(db, "papers", paperId);
  const paperSnap = await getDoc(paperDocRef);

  if (paperSnap.exists()) {
    return convertPaperTimestamps({ id: paperSnap.id, ...paperSnap.data() });
  } else {
    // console.warn(`Paper Service (getPaper): Paper with ID ${paperId} not found.`);
    return null;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  const db = firestoreDb;
  if (!db) {
    console.error("Paper Service (getUserPapers): Firestore DB instance is not available.");
    return [];
  }
  const papersRef = collection(db, "papers");
  // console.log(`Paper Service (getUserPapers): Fetching papers for user ID: ${userId}`);
  const q = query(papersRef, where("userId", "==", userId), orderBy("uploadDate", "desc"));
  try {
    const querySnapshot = await getDocs(q);
    const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
    // console.log(`Paper Service (getUserPapers): Found ${papers.length} papers for user ${userId}.`);
    return papers;
  } catch (error: any) {
    console.error(`Paper Service (getUserPapers): Error fetching papers for user ${userId}:`, error);
    throw error;
  }
};

export const getAllPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  if (!db) {
    console.error("Paper Service (getAllPapers): Firestore DB instance is not available.");
    return [];
  }
  const papersRef = collection(db, "papers");
  // console.log("Paper Service (getAllPapers): Fetching all papers.");
  const q = query(papersRef, orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  // console.log(`Paper Service (getAllPapers): Found ${papers.length} total papers.`);
  return papers;
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  const db = firestoreDb;
  if (!db) {
    console.error("Paper Service (updatePaperStatus): Firestore DB instance is not available.");
    throw new Error("Database service unavailable.");
  }
  const paperDocRef = doc(db, "papers", paperId);
  // console.log(`Paper Service (updatePaperStatus): Updating paper ${paperId} to status ${status}`);

  const updateData: Partial<Paper & { lastUpdatedAt: any, paymentDueDate: any, submissionDate: any, paidAt: any }> = { status, lastUpdatedAt: serverTimestamp() };

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
  // console.log(`Paper Service (updatePaperStatus): Paper ${paperId} status updated successfully.`);
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id' | 'lastUpdatedAt'>>): Promise<Paper> => {
  const db = firestoreDb;
  if (!db) {
    console.error("Paper Service (updatePaperData): Firestore DB instance is not available.");
    throw new Error("Database service unavailable.");
  }
  const paperDocRef = doc(db, "papers", paperId);
  // console.log(`Paper Service (updatePaperData): Updating data for paper ${paperId}`, data);
  await updateDoc(paperDocRef, { ...data, lastUpdatedAt: serverTimestamp() });
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after data update.");
  // console.log(`Paper Service (updatePaperData): Paper ${paperId} data updated successfully.`);
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  if (!db) {
    console.error("Paper Service (getPublishedPapers): Firestore DB instance is not available.");
    return [];
  }
  const papersRef = collection(db, "papers");
  // console.log("Paper Service (getPublishedPapers): Fetching published papers.");
  const q = query(papersRef, where("status", "==", "Published"), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  // console.log(`Paper Service (getPublishedPapers): Found ${papers.length} published papers.`);
  return papers;
};
