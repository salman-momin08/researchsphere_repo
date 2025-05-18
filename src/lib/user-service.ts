
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
} from "firebase/firestore";
import { db as firestoreDb } from "@/lib/firebase";
import type { User } from '@/types';

// Helper to convert Firestore Timestamps in user data
const convertUserTimestamps = (userData: any): User => {
  const convert = (timestamp: any): string | null => {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
    if (typeof timestamp === 'string' && !isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
    if (timestamp instanceof Date) return timestamp.toISOString();
    if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
      return new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000).toISOString();
    }
    return String(timestamp); 
  };

  return {
    ...userData,
    createdAt: convert(userData.createdAt),
    updatedAt: convert(userData.updatedAt),
  } as User;
};

// Fetches a single user profile from Firestore
export const getUserProfile = async (userId: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("UserService (getUserProfile): Firestore DB instance is not available."); // Keep critical service error
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", userId);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      return convertUserTimestamps({ id: userSnap.id, ...userSnap.data() });
    } else {
      return null;
    }
  } catch (error: any) {
    console.error(`UserService (getUserProfile): Error fetching profile for userId ${userId}:`, error.message); // Keep critical fetch error
    throw error;
  }
};

// Fetches all users from Firestore (for admin use)
export const getAllUsers = async (): Promise<User[]> => {
  if (!firestoreDb) {
    console.error("UserService (getAllUsers): Firestore DB instance is not available."); // Keep critical service error
    return [];
  }
  let users: User[] = [];
  try {
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    users = querySnapshot.docs.map(docSnap => convertUserTimestamps({ id: docSnap.id, ...docSnap.data() }));
  } catch (error: any) {
    console.error("UserService (getAllUsers): Error fetching users:", error.message); // Keep critical fetch error
    throw error;
  }
  return users;
};

// Fetches users with the "Reviewer" role
export const getReviewers = async (): Promise<User[]> => {
  if (!firestoreDb) {
     console.error("UserService (getReviewers): Firestore DB instance is not available."); // Keep critical service error
    return [];
  }
  try {
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, where("role", "==", "Reviewer"), orderBy("displayName", "asc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(docSnap => convertUserTimestamps({ id: docSnap.id, ...docSnap.data() }));
  } catch (error: any) {
    console.error("UserService (getReviewers): Error fetching reviewers:", error.message); // Keep critical fetch error
    throw error;
  }
};

export const toggleUserAdminStatus = async (targetUserId: string, currentIsAdmin: boolean | undefined): Promise<void> => {
  if (!firestoreDb) {
    throw new Error("UserService (toggleUserAdminStatus): Database service unavailable.");
  }
  const userDocRef = doc(firestoreDb, "users", targetUserId);
  try {
    await updateDoc(userDocRef, {
      isAdmin: !currentIsAdmin,
      role: !currentIsAdmin ? "Admin" : "Author", 
      updatedAt: serverTimestamp(),
    });
  } catch (error: any) {
    console.error(`UserService (toggleUserAdminStatus): Error toggling admin status for user ${targetUserId}:`, error.message); // Keep critical update error
    throw new Error("Failed to update user admin status.");
  }
};

export const toggleUserSuspensionStatus = async (targetUserId: string, currentIsSuspended: boolean | undefined): Promise<void> => {
  if (!firestoreDb) {
    throw new Error("UserService (toggleUserSuspensionStatus): Database service unavailable.");
  }
  const userDocRef = doc(firestoreDb, "users", targetUserId);
  try {
    await updateDoc(userDocRef, {
      isSuspended: !currentIsSuspended,
      updatedAt: serverTimestamp(),
    });
  } catch (error: any) {
     console.error(`UserService (toggleUserSuspensionStatus): Error toggling suspension status for user ${targetUserId}:`, error.message); // Keep critical update error
    throw new Error("Failed to update user suspension status.");
  }
};
