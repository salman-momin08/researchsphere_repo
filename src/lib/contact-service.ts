
"use client";

import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db as firestoreDb } from "@/lib/firebase";
import type { ContactSubmission } from '@/types';

const convertContactSubmissionTimestamps = (submissionData: any): ContactSubmission => {
  const convert = (timestamp: any): string => {
    if (!timestamp) return new Date().toISOString(); // Should always have sentAt
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

  return {
    ...submissionData,
    sentAt: convert(submissionData.sentAt),
  } as ContactSubmission;
};

export const addContactSubmission = async (
  submissionData: Omit<ContactSubmission, 'id' | 'sentAt' | 'isRead'>
): Promise<ContactSubmission> => {
  if (!firestoreDb) {
    throw new Error("Database service not available.");
  }

  try {
    const docRef = await addDoc(collection(firestoreDb, "contactSubmissions"), {
      ...submissionData,
      sentAt: serverTimestamp(),
      isRead: false,
    });
    // Simulate fetching after write for timestamp conversion, or just construct it
    return {
      id: docRef.id,
      ...submissionData,
      sentAt: new Date().toISOString(), // Use client time as an immediate approximation
      isRead: false,
    };
  } catch (error: any) {
    console.error("ContactService (addContactSubmission): Error adding submission:", error.message);
    throw new Error("Failed to send your message. Please try again later.");
  }
};

export const getContactSubmissions = async (): Promise<ContactSubmission[]> => {
  if (!firestoreDb) {
    console.error("ContactService (getContactSubmissions): Firestore DB instance is not available.");
    return [];
  }
  try {
    const submissionsRef = collection(firestoreDb, "contactSubmissions");
    const q = query(submissionsRef, orderBy("sentAt", "desc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(docSnap =>
      convertContactSubmissionTimestamps({ id: docSnap.id, ...docSnap.data() })
    );
  } catch (error: any) {
    console.error("ContactService (getContactSubmissions): Error fetching submissions:", error.message);
    throw error;
  }
};

export const markContactSubmissionAsRead = async (submissionId: string): Promise<void> => {
  if (!firestoreDb) {
    throw new Error("Database service unavailable.");
  }
  const submissionDocRef = doc(firestoreDb, "contactSubmissions", submissionId);
  try {
    await updateDoc(submissionDocRef, {
      isRead: true,
    });
  } catch (error: any) {
    console.error(`ContactService (markContactSubmissionAsRead): Error marking as read for ${submissionId}:`, error.message);
    throw new Error("Failed to update message status.");
  }
};
