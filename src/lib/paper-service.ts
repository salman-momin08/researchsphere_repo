
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
  deleteDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { auth, db as firestoreDb } from "@/lib/firebase";
import type { Paper, PaperStatus } from '@/types';

const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Placeholder, actual admin logic uses isAdmin flag from Firestore

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


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName' | 'lastUpdatedAt'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File | null, // Allow null if updating existing paper status after payment
  userIdClient: string,
  existingPaperId?: string // Optional: for updating status after payment
): Promise<Paper> => {
  if (!auth.currentUser) {
    throw new Error("User not authenticated. Cannot submit paper.");
  }
  if (auth.currentUser.uid !== userIdClient) {
    throw new Error("User ID mismatch. Cannot submit paper for another user.");
  }

  const db = firestoreDb;
  const storage = getStorage();
  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: Date | null = null;
  let paidAt: Date | null = null;
  let submissionDate: Date | Timestamp | null = null;

  let downloadURL: string | undefined = undefined;
  let originalFileName: string | undefined = undefined;

  if (existingPaperId) { // This is an update after "Pay Now" flow, or general status update
      console.log(`Paper Service (addPaper/update): Updating existing paper ${existingPaperId}`);
      const paperDocRef = doc(db, "papers", existingPaperId);
      const paperSnap = await getDoc(paperDocRef);
      if (!paperSnap.exists()) {
        throw new Error("Original paper not found for update.");
      }
      const existingPaperData = paperSnap.data();
      downloadURL = existingPaperData.fileUrl; // Preserve existing file
      originalFileName = existingPaperData.fileName;

      if (paperData.paymentOption === 'payNow') { // Confirming payment for an existing paper
        status = 'Submitted';
        paidAt = now;
        submissionDate = serverTimestamp();
        paymentDueDate = null; // Clear due date
      } else {
        // This path shouldn't normally be hit if existingPaperId is only for post-payment update
        // If it's a generic status update, this might need different logic
        status = existingPaperData.status; // Preserve current status if not a payment confirmation
      }
  } else { // This is a new paper submission
    if (!fileToUpload) {
      throw new Error("File is required for new paper submission.");
    }
    originalFileName = fileToUpload.name;
    const timestampForFile = Date.now();
    const storagePath = `papers/${userIdClient}/${timestampForFile}-${originalFileName}`;
    const storageRef = ref(storage, storagePath);
    console.log(`Paper Service (addPaper/new): Attempting to upload file to Firebase Storage: ${storagePath}`);
    await uploadBytes(storageRef, fileToUpload);
    console.log(`Paper Service (addPaper/new): File uploaded successfully to Storage.`);
    downloadURL = await getDownloadURL(storageRef);
    console.log(`Paper Service (addPaper/new): Got download URL: ${downloadURL}`);

    if (paperData.paymentOption === 'payLater') {
      status = 'Payment Pending';
      const dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
      paymentDueDate = dueDate;
      submissionDate = null;
      paidAt = null;
    } else { // payNow for a new paper
      status = 'Submitted';
      paidAt = now;
      submissionDate = serverTimestamp(); // Set submission date if paying now
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
    fileUrl: downloadURL,
    uploadDate: existingPaperId ? (await getDoc(doc(db, "papers", existingPaperId))).data()?.uploadDate.toDate().toISOString() : Timestamp.fromDate(now).toDate().toISOString(),
    status: status,
    paymentOption: paperData.paymentOption,
    paymentDueDate: paymentDueDate ? paymentDueDate.toISOString() : null,
    paidAt: paidAt ? paidAt.toISOString() : null,
    submissionDate: submissionDate instanceof Date ? submissionDate.toISOString() : ( submissionDate === null ? null : now.toISOString() ),
    plagiarismScore: null,
    acceptanceProbability: null,
    // Ensure these are present if updating
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
      submissionDate: submissionDate || null, // serverTimestamp() or null
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
    const docRef = await addDoc(collection(db, "papers"), {
      ...paperDocData,
      uploadDate: Timestamp.fromDate(now),
      submissionDate: submissionDate,
      paidAt: paperDocData.paidAt ? Timestamp.fromDate(new Date(paperDocData.paidAt)) : null,
      paymentDueDate: paymentDueDate ? Timestamp.fromDate(paymentDueDate) : null,
      lastUpdatedAt: serverTimestamp(),
    });
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
    return null;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  const db = firestoreDb;
  const papersRef = collection(db, "papers");
  const q = query(papersRef, where("userId", "==", userId), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  return papers;
};

export const getAllPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  const papersRef = collection(db, "papers");
  const q = query(papersRef, orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  return papers;
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  const db = firestoreDb;
  const paperDocRef = doc(db, "papers", paperId);
  
  const updateData: Partial<Paper & { lastUpdatedAt: any, paymentDueDate: any, submissionDate: any, paidAt: any }> = { status, lastUpdatedAt: serverTimestamp() };

  if (paymentDetails?.paidAt) {
    updateData.paidAt = Timestamp.fromDate(new Date(paymentDetails.paidAt));
  }

  if (status === 'Submitted') {
    updateData.submissionDate = serverTimestamp(); // Set/update submission date
    updateData.paymentDueDate = null; // Clear payment due date
    if (!updateData.paidAt) { // Ensure paidAt is set if moving to Submitted
      updateData.paidAt = serverTimestamp();
    }
  } else if (status === 'Payment Pending') {
    const paperSnap = await getDoc(paperDocRef);
    if (paperSnap.exists() && !paperSnap.data().paymentDueDate) { // Only set if not already set
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
  const db = firestoreDb;
  const paperDocRef = doc(db, "papers", paperId);
  await updateDoc(paperDocRef, { ...data, lastUpdatedAt: serverTimestamp() });
  const updatedPaperSnap = await getDoc(paperDocRef);
  if (!updatedPaperSnap.exists()) throw new Error("Failed to fetch paper after data update.");
  return convertPaperTimestamps({ id: updatedPaperSnap.id, ...updatedPaperSnap.data() });
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  const db = firestoreDb;
  const papersRef = collection(db, "papers");
  const q = query(papersRef, where("status", "==", "Published"), orderBy("uploadDate", "desc"));
  const querySnapshot = await getDocs(q);
  const papers = querySnapshot.docs.map(docSnap => convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() }));
  return papers;
};

export const deletePaperWithFile = async (paperId: string): Promise<void> => {
  if (!auth.currentUser) {
    throw new Error("User not authenticated. Cannot delete paper.");
  }
  const db = firestoreDb;
  const storage = getStorage();
  const paperDocRef = doc(db, "papers", paperId);

  const paperSnap = await getDoc(paperDocRef);

  if (!paperSnap.exists()) {
    throw new Error("Paper not found.");
  }

  const paperData = paperSnap.data() as Paper;

  const userProfile = await getDoc(doc(db, "users", auth.currentUser.uid));
  const isAdmin = userProfile.exists() && userProfile.data().isAdmin === true;

  if (paperData.userId !== auth.currentUser.uid && !isAdmin) {
    throw new Error("Not authorized to delete this paper.");
  }

  if (paperData.fileUrl) {
    try {
      const fileRef = ref(storage, paperData.fileUrl); 
      await deleteObject(fileRef);
    } catch (error: any) {
      console.error(`Paper Service (deletePaperWithFile): Error deleting file ${paperData.fileUrl} from Storage. Paper: ${paperId}. Error:`, error.message);
       if (error.code === 'storage/object-not-found') {
        console.warn(`Paper Service (deletePaperWithFile): File not found in Storage, proceeding with Firestore document deletion.`);
      }
    }
  }
  await deleteDoc(paperDocRef);
};
