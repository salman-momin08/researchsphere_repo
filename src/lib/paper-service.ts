
import { db } from '@/lib/firebase';
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

// Helper to convert Firestore Timestamps to ISO strings
const convertPaperTimestamps = (paperData: any): Paper => {
  const convertTimestamp = (timestampField: any): string | null => {
    if (timestampField instanceof Timestamp) {
      return timestampField.toDate().toISOString();
    }
    if (typeof timestampField === 'string') { // Already a string
        return timestampField;
    }
    return null;
  };

  return {
    ...paperData,
    uploadDate: convertTimestamp(paperData.uploadDate) || new Date(0).toISOString(), // Fallback for required field
    submissionDate: convertTimestamp(paperData.submissionDate),
    paymentDueDate: convertTimestamp(paperData.paymentDueDate),
    paidAt: convertTimestamp(paperData.paidAt),
    // createdAt and updatedAt are often handled by Firestore directly or not part of the core Paper type for client
  } as Paper;
};


export const addPaper = async (paperData: Omit<Paper, 'id' | 'uploadDate'> & { uploadDate?: any }): Promise<string> => {
  try {
    const docRef = await addDoc(collection(db, "papers"), {
      ...paperData,
      uploadDate: paperData.uploadDate || serverTimestamp(), // Use server timestamp if not provided
      lastUpdatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    console.error("Error adding paper to Firestore: ", error);
    throw error;
  }
};

export const getPaper = async (paperId: string): Promise<Paper | null> => {
  try {
    const docRef = doc(db, "papers", paperId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return convertPaperTimestamps({ id: docSnap.id, ...docSnap.data() } as any);
    } else {
      console.log("No such document!");
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
    const updateData: Partial<Paper> & { lastUpdatedAt: any } = { status, lastUpdatedAt: serverTimestamp() };
    if (paymentDetails?.paidAt) {
      updateData.paidAt = paymentDetails.paidAt;
      if (status === "Submitted") { // Assuming "Submitted" is the status after payment
         updateData.submissionDate = paymentDetails.paidAt; // Set submissionDate to payment time
      }
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
    await updateDoc(paperRef, {
      ...data,
      lastUpdatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Error updating paper data in Firestore: ", error);
    throw error;
  }
};

// Example: Function to seed mock data (run once or as needed)
// This is illustrative. A proper seed script would be separate.
export const seedMockPapersToFirestore = async (mockPapers: Paper[]) => {
    const batch = writeBatch(db);
    const papersRef = collection(db, "papers");

    // Check if papers collection is empty or has few items
    const q = query(papersRef, orderBy("uploadDate", "desc"));
    const existingPapersSnap = await getDocs(q);

    if (existingPapersSnap.docs.length < mockPapers.length) { // Only seed if DB has fewer papers than mock
        console.log("Seeding mock papers to Firestore...");
        mockPapers.forEach(paper => {
            const { id, ...paperData } = paper; // Exclude mock ID
            const docRef = doc(papersRef); // Generate new ID
            
            // Convert string dates from mock to Timestamps for Firestore
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
