
"use client"; // Still a client-side service, but interacting with Firebase

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
  deleteDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { auth, db as firestoreDb } from "@/lib/firebase"; // Use db from firebase.ts
import type { Paper, PaperStatus } from '@/types';

// Helper to convert Firestore Timestamps to ISO strings for client-side use
const convertPaperTimestamps = (paperData: any): Paper => {
  const convert = (timestamp: any) => 
    timestamp instanceof Timestamp ? timestamp.toDate().toISOString() : (timestamp || null);

  return {
    ...paperData,
    uploadDate: convert(paperData.uploadDate),
    submissionDate: convert(paperData.submissionDate),
    paymentDueDate: convert(paperData.paymentDueDate),
    paidAt: convert(paperData.paidAt),
    lastUpdatedAt: convert(paperData.lastUpdatedAt), // Assuming you might add this
  } as Paper;
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName' | 'lastUpdatedAt'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File,
  userIdClient: string
): Promise<Paper> => {
  if (!auth.currentUser) {
    // console.error("Paper Service (addPaper): User not authenticated.");
    throw new Error("User not authenticated. Cannot submit paper.");
  }
  if (auth.currentUser.uid !== userIdClient) {
    // console.error("Paper Service (addPaper): Authenticated user UID does not match provided userIdClient.");
    throw new Error("User ID mismatch. Cannot submit paper for another user.");
  }

  const db = firestoreDb; // Use the initialized Firestore instance
  const storage = getStorage();
  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: Date | null = null;
  let submissionDate: Date | Timestamp | null = serverTimestamp(); // Default to server timestamp if paying now

  if (paperData.paymentOption === 'payLater') {
    status = 'Payment Pending';
    const dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    paymentDueDate = dueDate;
    submissionDate = null; 
  }

  // Upload file to Firebase Storage
  const timestampForFile = Date.now();
  const storagePath = `papers/${userIdClient}/${timestampForFile}-${fileToUpload.name}`;
  const storageRef = ref(storage, storagePath);
  // console.log(`Paper Service (addPaper): Attempting to upload file to Firebase Storage: ${storagePath}`);
  await uploadBytes(storageRef, fileToUpload);
  // console.log(`Paper Service (addPaper): File uploaded successfully to Storage.`);
  const downloadURL = await getDownloadURL(storageRef);
  // console.log(`Paper Service (addPaper): Got download URL: ${downloadURL}`);

  const newPaperDoc: Omit<Paper, 'id' | 'lastUpdatedAt'> = {
    userId: userIdClient,
    title: paperData.title,
    abstract: paperData.abstract,
    authors: paperData.authors,
    keywords: paperData.keywords,
    fileName: fileToUpload.name,
    fileUrl: downloadURL,
    uploadDate: Timestamp.fromDate(now).toDate().toISOString(), // Store as ISO string matching type
    status: status,
    paymentOption: paperData.paymentOption,
    paymentDueDate: paymentDueDate ? paymentDueDate.toISOString() : null,
    paidAt: paperData.paymentOption === 'payNow' ? Timestamp.fromDate(now).toDate().toISOString() : null,
    submissionDate: submissionDate instanceof Date ? submissionDate.toISOString() : ( submissionDate === null ? null : now.toISOString() ), // conditional serverTimestamp handle
    plagiarismScore: null,
    acceptanceProbability: null,
  };

  // console.log("Paper Service (addPaper): Attempting to add document to Firestore with data:", newPaperDoc);
  const docRef = await addDoc(collection(db, "papers"), {
    ...newPaperDoc,
    uploadDate: Timestamp.fromDate(now), // Store as Firestore Timestamp
    submissionDate: submissionDate, // Store as Firestore Timestamp or null
    paidAt: newPaperDoc.paidAt ? Timestamp.fromDate(new Date(newPaperDoc.paidAt)) : null,
    paymentDueDate: paymentDueDate ? Timestamp.fromDate(paymentDueDate) : null,
    lastUpdatedAt: serverTimestamp(),
  });
  // console.log("Paper Service (addPaper): Document added to Firestore with ID:", docRef.id);

  return { ...convertPaperTimestamps(newPaperDoc), id: docRef.id, lastUpdatedAt: now.toISOString() };
};

export const getPaper = async (paperId: string): Promise<Paper | null> => {
  const db = firestoreDb;
  const paperDocRef = doc(db, "papers", paperId);
  // console.log(`Paper Service (getPaper): Fetching paper with ID: ${paperId} from Firestore.`);
  const paperSnap = await getDoc(paperDocRef);

  if (paperSnap.exists()) {
    // console.log(`Paper Service (getPaper): Paper ${paperId} found in Firestore.`);
    return convertPaperTimestamps({ id: paperSnap.id, ...paperSnap.data() });
  } else {
    // console.warn(`Paper Service (getPaper): Paper ${paperId} not found in Firestore.`);
    return null;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  const db = firestoreDb;
  // console.log(`Paper Service (getUserPapers): Fetching papers for user ID: ${userId} from Firestore.`);
  const papersRef = collection(db, "papers");
  const q = query(papersRef, where("userId", "==", userId), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  // console.log(`Paper Service (getUserPapers): Found ${papers.length} papers for user ${userId}.`);
  return papers;
};

export const getAllPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  // console.log("Paper Service (getAllPapers): Fetching all papers (admin) from Firestore.");
  const papersRef = collection(db, "papers");
  const q = query(papersRef, orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  // console.log(`Paper Service (getAllPapers): Returning ${papers.length} papers.`);
  return papers;
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  const db = firestoreDb;
  // console.log(`Paper Service (updatePaperStatus): Updating status for paper ${paperId} to ${status}. Payment details:`, paymentDetails);
  const paperDocRef = doc(db, "papers", paperId);
  
  const updateData: Partial<Paper & { lastUpdatedAt: any, paymentDueDate: any, submissionDate: any, paidAt: any }> = { status, lastUpdatedAt: serverTimestamp() };

  if (paymentDetails?.paidAt) {
    updateData.paidAt = Timestamp.fromDate(new Date(paymentDetails.paidAt));
  }
  if (status === 'Submitted' && paymentDetails?.paidAt) {
    updateData.submissionDate = serverTimestamp();
    updateData.paymentDueDate = null; 
  } else if (status === 'Payment Pending') {
    const paperSnap = await getDoc(paperDocRef);
    if (paperSnap.exists() && !paperSnap.data().paymentDueDate) {
        const dueDate = new Date();
        dueDate.setHours(dueDate.getHours() + 2);
        updateData.paymentDueDate = Timestamp.fromDate(dueDate);
    }
  }


  await updateDoc(paperDocRef, updateData);
  // console.log(`Paper Service (updatePaperStatus): Status updated for paper ${paperId}.`);
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after status update.");
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id' | 'lastUpdatedAt'>>): Promise<Paper> => {
  const db = firestoreDb;
  // console.log(`Paper Service (updatePaperData): Updating data for paper ${paperId}. Data:`, data);
  const paperDocRef = doc(db, "papers", paperId);
  await updateDoc(paperDocRef, { ...data, lastUpdatedAt: serverTimestamp() });
  // console.log(`Paper Service (updatePaperData): Data updated for paper ${paperId}.`);
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after data update.");
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  // console.log("Paper Service (getPublishedPapers): Fetching published papers from Firestore.");
  const papersRef = collection(db, "papers");
  const q = query(papersRef, where("status", "==", "Published"), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  // console.log(`Paper Service (getPublishedPapers): Found ${papers.length} published papers.`);
  return papers;
};

export const deletePaperWithFile = async (paperId: string): Promise<void> => {
  if (!auth.currentUser) {
    throw new Error("User not authenticated. Cannot delete paper.");
  }
  const db = firestoreDb;
  const storage = getStorage();
  const paperDocRef = doc(db, "papers", paperId);

  // console.log(`Paper Service (deletePaperWithFile): Attempting to delete paper ${paperId}.`);
  const paperSnap = await getDoc(paperDocRef);

  if (!paperSnap.exists()) {
    // console.warn(`Paper Service (deletePaperWithFile): Paper ${paperId} not found for deletion.`);
    throw new Error("Paper not found.");
  }

  const paperData = paperSnap.data() as Paper;

  // Authorization: Only owner or admin can delete
  const isAdmin = auth.currentUser.email === MOCK_ADMIN_EMAIL; // Or check from custom claims/Firestore profile
  if (paperData.userId !== auth.currentUser.uid && !isAdmin) {
    // console.error(`Paper Service (deletePaperWithFile): User ${auth.currentUser.uid} not authorized to delete paper ${paperId}.`);
    throw new Error("Not authorized to delete this paper.");
  }

  // Delete file from Firebase Storage if fileUrl exists
  if (paperData.fileUrl) {
    try {
      const fileRef = ref(storage, paperData.fileUrl); // Firebase Storage URL can be used to create a ref
      // console.log(`Paper Service (deletePaperWithFile): Attempting to delete file from Storage: ${paperData.fileUrl}`);
      await deleteObject(fileRef);
      // console.log(`Paper Service (deletePaperWithFile): File deleted successfully from Storage.`);
    } catch (error: any) {
      // Log error but continue to delete Firestore doc, especially if file was already deleted or path is wrong
      console.error(`Paper Service (deletePaperWithFile): Error deleting file ${paperData.fileUrl} from Storage. Paper: ${paperId}. Error:`, error.message);
       if (error.code === 'storage/object-not-found') {
        // console.warn(`Paper Service (deletePaperWithFile): File not found in Storage, proceeding with Firestore document deletion.`);
      } else {
        // For other storage errors, you might reconsider if you want to stop the whole process
        // For now, we'll log and proceed.
      }
    }
  }

  // Delete Firestore document
  // console.log(`Paper Service (deletePaperWithFile): Attempting to delete Firestore document for paper ${paperId}.`);
  await deleteDoc(paperDocRef);
  // console.log(`Paper Service (deletePaperWithFile): Firestore document for paper ${paperId} deleted successfully.`);
};

// Helper for mock file download for original paper in components
// This function is now primarily for components that might try to download *before* full Firebase Storage integration is complete
// or if a fileUrl is somehow missing.
export const simulateFileDownload = (fileUrl: string | undefined, fileName?: string) => {
  if (fileUrl && !fileUrl.startsWith('/uploads/mock/')) { // If it's a real URL (e.g., Firebase Storage)
    window.open(fileUrl, '_blank');
    return;
  }
  // Fallback for mock URLs or missing URLs
  const mockContent = `This is a mock download for the file originally named: ${fileName || 'paper.pdf'}.\nIts mock URL was: ${fileUrl || 'Not available'}\nIn a real system, the actual file content would be downloaded from Firebase Storage.`;
  const blob = new Blob([mockContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName || 'downloaded_paper_details'}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Define if not imported from elsewhere
