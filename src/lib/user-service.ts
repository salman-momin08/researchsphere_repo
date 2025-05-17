
"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  Timestamp,
  serverTimestamp,
  orderBy,
  deleteDoc,
} from "firebase/firestore";
import { db as firestoreDb } from "@/lib/firebase";
import type { User } from '@/types';

// Helper to convert Firestore Timestamps in user data
const convertUserTimestamps = (userData: any): User => {
  const convert = (timestamp: any) => {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
    if (typeof timestamp === 'string') { 
        if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
    }
    if (timestamp instanceof Date) return timestamp.toISOString(); 
    if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
        return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
    }
    return null; 
  }

  return {
    ...userData,
    createdAt: convert(userData.createdAt),
    updatedAt: convert(userData.updatedAt),
  } as User;
};

// Fetches a single user profile from Firestore
export const getUserProfile = async (userId: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("User Service: Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", userId);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      return convertUserTimestamps({ id: userSnap.id, ...userSnap.data() });
    } else {
      console.warn(`User Service: No profile found for userId: ${userId}`);
      return null;
    }
  } catch (error: any) {
    console.error(`User Service: Error fetching profile for userId ${userId}:`, error.message, error.code);
    return null;
  }
};

// Fetches all users from Firestore (for admin use)
export const getAllUsers = async (): Promise<User[]> => {
  if (!firestoreDb) {
    console.error("User Service: Firestore DB instance is not available.");
    return [];
  }
  try {
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, orderBy("createdAt", "desc")); 
    const querySnapshot = await getDocs(q);
    const users = querySnapshot.docs.map(docSnap => convertUserTimestamps({ id: docSnap.id, ...docSnap.data() }));
    return users;
  } catch (error: any) {
    console.error("User Service (getAllUsers): Error fetching users:", error.message, error.code);
    throw error; 
  }
};

export const toggleUserAdminStatus = async (targetUserId: string, currentIsAdmin: boolean | undefined): Promise<void> => {
  if (!firestoreDb) {
    throw new Error("User Service: Database service unavailable.");
  }
  const userDocRef = doc(firestoreDb, "users", targetUserId);
  try {
    await updateDoc(userDocRef, {
      isAdmin: !currentIsAdmin,
      updatedAt: serverTimestamp(),
    });
  } catch (error: any) {
    console.error(`User Service: Error toggling admin status for user ${targetUserId}:`, error.message, error.code);
    throw new Error("Failed to update user admin status.");
  }
};

export const toggleUserSuspensionStatus = async (targetUserId: string, currentIsSuspended: boolean | undefined): Promise<void> => {
  if (!firestoreDb) {
    throw new Error("User Service: Database service unavailable.");
  }
  const userDocRef = doc(firestoreDb, "users", targetUserId);
  try {
    await updateDoc(userDocRef, {
      isSuspended: !currentIsSuspended,
      updatedAt: serverTimestamp(),
    });
  } catch (error: any) {
    console.error(`User Service: Error toggling suspension status for user ${targetUserId}:`, error.message, error.code);
    throw new Error("Failed to update user suspension status.");
  }
};

// Helper to check if a username is taken, excluding a specific user ID (for updates)
export const isUsernameTakenInFirestore = async (username: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb || !username || username.trim() === "") return false;

  const usersRef = collection(firestoreDb, "users");
  const q = query(usersRef, where("username", "==", username));
  try {
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return false;
    if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
    return true;
  } catch (error) {
    console.error("User Service: Error checking username uniqueness:", error);
    return false; // Fail safe, assume not taken on error or rethrow
  }
};

// Helper to check if a phone number is taken, excluding a specific user ID (for updates)
export const isPhoneNumberTakenInFirestore = async (phoneNumber: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb || !phoneNumber || phoneNumber.trim() === "") return false;

  const usersRef = collection(firestoreDb, "users");
  const q = query(usersRef, where("phoneNumber", "==", phoneNumber));
  try {
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return false;
    if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
    return true;
  } catch (error) {
    console.error("User Service: Error checking phone number uniqueness:", error);
    return false; // Fail safe
  }
};
