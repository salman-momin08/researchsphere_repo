
import { db, storage } from '@/lib/firebase';
import type { Paper, PaperStatus } from '@/types';
import {
  collection,
  addDoc,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
  Timestamp,
  orderBy,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

const convertPaperTimestamps = (paperData: any): Paper => {
  const convertTimestamp = (timestampField: any): string | null => {
    if (timestampField instanceof Timestamp) {
      return timestampField.toDate().toISOString();
    }
    if (typeof timestampField === 'string') {
        return timestampField;
    }
    return null;
  };

  return {
    ...paperData,
    uploadDate: convertTimestamp(paperData.uploadDate) || new Date(0).toISOString(),
    submissionDate: convertTimestamp(paperData.submissionDate),
    paymentDueDate: convertTimestamp(paperData.paymentDueDate),
    paidAt: convertTimestamp(paperData.paidAt),
  } as Paper;
};

export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'fileUrl' | 'fileName'> & { uploadDate?: any },
  fileToUpload: File,
  userId: string
): Promise<string> => {
  console.log("paper-service: addPaper called with userId:", userId, "fileName:", fileToUpload.name);
  try {
    const timestamp = Date.now();
    const storageFileName = `${timestamp}-${fileToUpload.name.replace(/\s+/g, '_')}`;
    const storageRef = ref(storage, `papers/${userId}/${storageFileName}`);

    console.log(`paper-service: Attempting to upload ${fileToUpload.name} to Storage path: ${storageRef.fullPath}`);
    const uploadTask = uploadBytesResumable(storageRef, fileToUpload);

    await uploadTask; // Wait for the upload to complete
    console.log(`paper-service: File ${fileToUpload.name} uploaded successfully to Storage.`);

    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
    console.log(`paper-service: Obtained download URL: ${downloadURL}`);

    const paperDocData = {
      ...paperData,
      userId: userId,
      fileName: fileToUpload.name,
      fileUrl: downloadURL,
      uploadDate: paperData.uploadDate ? Timestamp.fromDate(new Date(paperData.uploadDate)) : serverTimestamp(),
      submissionDate: paperData.submissionDate ? Timestamp.fromDate(new Date(paperData.submissionDate)) : null,
      paymentDueDate: paperData.paymentDueDate ? Timestamp.fromDate(new Date(paperData.paymentDueDate)) : null,
      paidAt: paperData.paidAt ? Timestamp.fromDate(new Date(paperData.paidAt)) : null,
      lastUpdatedAt: serverTimestamp(),
    };

    console.log("paper-service: Attempting to add paper metadata to Firestore with data:", paperDocData);
    const docRef = await addDoc(collection(db, "papers"), paperDocData);
    console.log(`paper-service: Paper metadata added to Firestore with ID: ${docRef.id}`);
    return docRef.id;

  } catch (error: any) {
    console.error("paper-service: Error in addPaper:", error);
    // Log specific Firebase Storage or Firestore errors if possible
    if (error.code && error.message) { // Firebase errors often have code and message
      console.error(`paper-service: Firebase Error Code: ${error.code}, Message: ${error.message}`);
    }
    throw new Error(`Failed to add paper: ${error.message || 'Unknown error during paper submission service.'}`);
  }
};

export const getPaper = async (paperId: string): Promise<Paper | null> => {
  try {
    const docRef = doc(db, "papers", paperId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() } as any);
    } else {
      console.log("No such document for paper ID:", paperId);
      return null;
    }
  } catch (error) {
    console.error("Error getting paper from Firestore: ", error);
    throw error;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  try {
    const papersRef = collection(db, "papers");
    const q = query(papersRef, where("userId", "==", userId), orderBy("uploadDate", "desc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => convertPaperTimestamps({ id: doc.id, ...doc.data() } as any));
  } catch (error) {
    console.error("Error getting user papers from Firestore: ", error);
    throw error;
  }
};

export const getAllPapers = async (): Promise<Paper[]> => {
  try {
    const papersRef = collection(db, "papers");
    const q = query(papersRef, orderBy("uploadDate", "desc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => convertPaperTimestamps({ id: doc.id, ...doc.data() } as any));
  } catch (error) {
    console.error("Error getting all papers from Firestore: ", error);
    throw error;
  }
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<void> => {
  try {
    const paperRef = doc(db, "papers", paperId);
    const updateData: { [key: string]: any } = { status, lastUpdatedAt: serverTimestamp() };

    if (paymentDetails?.paidAt) {
      updateData.paidAt = Timestamp.fromDate(new Date(paymentDetails.paidAt));
      if (status === "Submitted") {
         updateData.submissionDate = serverTimestamp(); // Use server timestamp for submission
         updateData.paymentDueDate = null;
      }
    } else if (status === "Payment Pending" && !updateData.paymentDueDate) {
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 2);
      updateData.paymentDueDate = Timestamp.fromDate(dueDate);
    }


    await updateDoc(paperRef, updateData);
  } catch (error) {
    console.error("Error updating paper status in Firestore: ", error);
    throw error;
  }
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id'>>): Promise<void> => {
  try {
    const paperRef = doc(db, "papers", paperId);
    const dataToUpdate = { ...data, lastUpdatedAt: serverTimestamp() };

    if (data.submissionDate && typeof data.submissionDate === 'string') {
      dataToUpdate.submissionDate = Timestamp.fromDate(new Date(data.submissionDate));
    }
    if (data.paymentDueDate && typeof data.paymentDueDate === 'string') {
      dataToUpdate.paymentDueDate = Timestamp.fromDate(new Date(data.paymentDueDate));
    }
    if (data.paidAt && typeof data.paidAt === 'string') {
      dataToUpdate.paidAt = Timestamp.fromDate(new Date(data.paidAt));
    }

    await updateDoc(paperRef, dataToUpdate);
  } catch (error) {
    console.error("Error updating paper data in Firestore: ", error);
    throw error;
  }
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  try {
    const papersRef = collection(db, "papers");
    const q = query(papersRef, where("status", "==", "Published"), orderBy("uploadDate", "desc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => convertPaperTimestamps({ id: doc.id, ...doc.data() } as any));
  } catch (error) {
    console.error("Error getting published papers from Firestore: ", error);
    throw error;
  }
};


export const seedMockPapersToFirestore = async (mockPapers: Paper[]) => {
    const batch = writeBatch(db);
    const papersRef = collection(db, "papers");

    const q = query(papersRef, orderBy("uploadDate", "desc"));
    const existingPapersSnap = await getDocs(q);

    if (existingPapersSnap.docs.length < mockPapers.length) {
        console.log("Seeding mock papers to Firestore...");
        mockPapers.forEach(paper => {
            const { id, ...paperData } = paper;
            const docRef = doc(papersRef);

            const firestorePaperData = {
                ...paperData,
                uploadDate: paperData.uploadDate ? Timestamp.fromDate(new Date(paperData.uploadDate)) : serverTimestamp(),
                submissionDate: paperData.submissionDate ? Timestamp.fromDate(new Date(paperData.submissionDate)) : null,
                paymentDueDate: paperData.paymentDueDate ? Timestamp.fromDate(new Date(paperData.paymentDueDate)) : null,
                paidAt: paperData.paidAt ? Timestamp.fromDate(new Date(paperData.paidAt)) : null,
                lastUpdatedAt: serverTimestamp()
            };
            batch.set(docRef, firestorePaperData);
        });
        try {
            await batch.commit();
            console.log("Mock papers seeded successfully.");
        } catch (error) {
            console.error("Error seeding mock papers: ", error);
        }
    } else {
        console.log("Firestore papers collection already populated or matches mock data count. Skipping seed.");
    }
};

export const deletePaperFileFromStorage = async (fileUrl: string): Promise<void> => {
  if (!fileUrl || !fileUrl.startsWith('https://firebasestorage.googleapis.com/')) {
    console.log("Invalid or non-Firebase Storage URL, skipping delete from storage:", fileUrl);
    return;
  }
  try {
    const fileRef = ref(storage, fileUrl);
    await deleteObject(fileRef);
    console.log("File deleted successfully from Firebase Storage:", fileUrl);
  } catch (error: any) {
    if (error.code === 'storage/object-not-found') {
      console.warn("File not found in Firebase Storage, skipping delete:", fileUrl);
    } else {
      console.error("Error deleting file from Firebase Storage:", error);
    }
  }
};

    