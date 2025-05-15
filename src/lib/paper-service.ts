
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
  // deleteDoc, // Not used yet, but keep for potential future use
} from "firebase/firestore";
// Remove Firebase Storage imports
// import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
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

// New function to upload file to Cloudinary
const uploadToCloudinary = async (file: File): Promise<{ secure_url: string; original_filename: string; public_id: string, format: string, resource_type: string } | null> => {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    console.error("Cloudinary configuration (cloud name or upload preset) is missing in environment variables.");
    throw new Error("Cloudinary configuration is missing.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  // Optional: Add a folder if not set in the preset
  // formData.append("folder", "papers");

  try {
    console.log(`Paper Service (uploadToCloudinary): Attempting to upload file "${file.name}" to Cloudinary.`);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Cloudinary upload failed:", data.error?.message || response.statusText);
      throw new Error(data.error?.message || "Cloudinary upload failed.");
    }

    console.log("Cloudinary upload successful:", { url: data.secure_url, filename: data.original_filename });
    return {
      secure_url: data.secure_url,
      original_filename: data.original_filename,
      public_id: data.public_id,
      format: data.format,
      resource_type: data.resource_type
    };
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    throw error; // Re-throw to be caught by addPaper
  }
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName' | 'lastUpdatedAt' | 'fileMimeType'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File | null,
  userIdClient: string,
  existingPaperId?: string
): Promise<Paper> => {
  if (!auth.currentUser) {
    throw new Error("User not authenticated. Cannot submit paper.");
  }
  if (auth.currentUser.uid !== userIdClient) {
    throw new Error("User ID mismatch. Cannot submit paper for another user.");
  }

  const db = firestoreDb;
  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: Date | null = null;
  let paidAt: Date | null = null;
  let submissionDate: Date | Timestamp | null = null;

  let cloudinaryFileUrl: string | undefined = undefined;
  let originalFileName: string | undefined = undefined;
  // let fileMimeType: string | undefined = undefined; // Not directly needed if Cloudinary handles delivery

  if (existingPaperId) {
    console.log(`Paper Service (addPaper/update): Updating existing paper ${existingPaperId}`);
    const paperDocRef = doc(db, "papers", existingPaperId);
    const paperSnap = await getDoc(paperDocRef);
    if (!paperSnap.exists()) {
      throw new Error("Original paper not found for update.");
    }
    const existingPaperData = paperSnap.data();
    cloudinaryFileUrl = existingPaperData.fileUrl;
    originalFileName = existingPaperData.fileName;
    // fileMimeType = existingPaperData.fileMimeType;

    if (paperData.paymentOption === 'payNow') {
      status = 'Submitted';
      paidAt = now;
      submissionDate = serverTimestamp();
      paymentDueDate = null;
    } else {
      status = existingPaperData.status;
    }
  } else {
    if (!fileToUpload) {
      console.error("Paper Service (addPaper/new): File is required for new paper submission.");
      throw new Error("File is required for new paper submission.");
    }
    console.log(`Paper Service (addPaper/new): File to upload: ${fileToUpload.name}, Type: ${fileToUpload.type}, Size: ${fileToUpload.size}`);

    // Upload to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(fileToUpload);
    if (!cloudinaryResult) {
        throw new Error("File upload to Cloudinary failed.");
    }
    cloudinaryFileUrl = cloudinaryResult.secure_url;
    originalFileName = cloudinaryResult.original_filename;
    // fileMimeType = fileToUpload.type; // Can still store if needed, but Cloudinary URL handles delivery

    console.log(`Paper Service (addPaper/new): Cloudinary URL: ${cloudinaryFileUrl}, Original Filename: ${originalFileName}`);


    if (paperData.paymentOption === 'payLater') {
      status = 'Payment Pending';
      const dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      paymentDueDate = dueDate;
      submissionDate = null;
      paidAt = null;
    } else {
      status = 'Submitted';
      paidAt = now;
      submissionDate = serverTimestamp();
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
    // fileMimeType: fileMimeType,
    uploadDate: existingPaperId ? (await getDoc(doc(db, "papers", existingPaperId))).data()?.uploadDate.toDate().toISOString() : Timestamp.fromDate(now).toDate().toISOString(),
    status: status,
    paymentOption: paperData.paymentOption,
    paymentDueDate: paymentDueDate ? paymentDueDate.toISOString() : null,
    paidAt: paidAt ? paidAt.toISOString() : null,
    submissionDate: submissionDate instanceof Date ? submissionDate.toISOString() : (submissionDate === null ? null : now.toISOString()),
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
    console.log("Paper Service (update existing): Updating document in Firestore with ID:", existingPaperId, "Payload:", updatePayload);
    const paperDocRef = doc(db, "papers", existingPaperId);
    await updateDoc(paperDocRef, updatePayload);
    const updatedSnap = await getDoc(paperDocRef);
    if (!updatedSnap.exists()) throw new Error("Failed to fetch paper after status update.");
    return { ...convertPaperTimestamps(updatedSnap.data()), id: existingPaperId };
  } else {
    console.log("Paper Service (addPaper/new): Attempting to add document to Firestore with data:", paperDocData);
    const paperDocForFirestore = {
      ...paperDocData,
      uploadDate: Timestamp.fromDate(now),
      submissionDate: submissionDate instanceof Date ? Timestamp.fromDate(submissionDate) : submissionDate,
      paidAt: paperDocData.paidAt ? Timestamp.fromDate(new Date(paperDocData.paidAt)) : null,
      paymentDueDate: paymentDueDate ? Timestamp.fromDate(paymentDueDate) : null,
      lastUpdatedAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(db, "papers"), paperDocForFirestore);
    console.log("Paper Service (addPaper/new): Document added to Firestore with ID:", docRef.id);
    return { ...convertPaperTimestamps(paperDocData), id: docRef.id, lastUpdatedAt: now.toISOString() };
  }
};

export const getPaper = async (paperId: string): Promise<Paper | null> => {
  const db = firestoreDb;
  const paperDocRef = doc(db, "papers", paperId);
  const paperSnap = await getDoc(paperDocRef);

  if (paperSnap.exists()) {
    return convertPaperTimestamps({ id: paperSnap.id, ...paperSnap.data() });
  } else {
    console.warn(`Paper Service (getPaper): Paper with ID ${paperId} not found.`);
    return null;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  const db = firestoreDb;
  const papersRef = collection(db, "papers");
  console.log(`Paper Service (getUserPapers): Fetching papers for user ID: ${userId}`);
  const q = query(papersRef, where("userId", "==", userId), orderBy("uploadDate", "desc"));
  try {
    const querySnapshot = await getDocs(q);
    const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
    console.log(`Paper Service (getUserPapers): Found ${papers.length} papers for user ${userId}.`);
    return papers;
  } catch (error) {
    console.error(`Paper Service (getUserPapers): Error fetching papers for user ${userId}:`, error);
    // This might be a permission error or a missing index error.
    // The toast for "Error Loading Papers" is in DashboardContent.tsx
    throw error; // Re-throw to be handled by the calling component
  }
};

export const getAllPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  const papersRef = collection(db, "papers");
  console.log("Paper Service (getAllPapers): Fetching all papers.");
  const q = query(papersRef, orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  console.log(`Paper Service (getAllPapers): Found ${papers.length} total papers.`);
  return papers;
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  const db = firestoreDb;
  const paperDocRef = doc(db, "papers", paperId);
  console.log(`Paper Service (updatePaperStatus): Updating paper ${paperId} to status ${status}`);

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
  console.log(`Paper Service (updatePaperStatus): Paper ${paperId} status updated successfully.`);
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id' | 'lastUpdatedAt'>>): Promise<Paper> => {
  const db = firestoreDb;
  const paperDocRef = doc(db, "papers", paperId);
  console.log(`Paper Service (updatePaperData): Updating data for paper ${paperId}`);
  await updateDoc(paperDocRef, { ...data, lastUpdatedAt: serverTimestamp() });
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after data update.");
  console.log(`Paper Service (updatePaperData): Paper ${paperId} data updated successfully.`);
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  const papersRef = collection(db, "papers");
  console.log("Paper Service (getPublishedPapers): Fetching published papers.");
  const q = query(papersRef, where("status", "==", "Published"), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  console.log(`Paper Service (getPublishedPapers): Found ${papers.length} published papers.`);
  return papers;
};

// Note: deletePaperWithFile would need to be adapted if files are in Cloudinary
// It would involve making an API call to Cloudinary to delete the asset by its public_id
// This is more complex and requires backend or secure handling of Cloudinary API secret.
// For now, focusing on upload and retrieval.
/*
export const deletePaperWithFile = async (paperId: string): Promise<void> => {
  // ... Firestore deletion logic ...
  // ... If Cloudinary, call Cloudinary API to delete file using public_id stored in Firestore ...
};
*/
