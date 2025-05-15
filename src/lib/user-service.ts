
"use client";

import {
  getFirestore,
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
} from "firebase/firestore";
import { db as firestoreDb } from "@/lib/firebase"; // Use db from firebase.ts
import type { User } from '@/types';

// Helper to convert Firestore Timestamps in user data
const convertUserTimestamps = (userData: any): User => {
  const convert = (timestamp: any) =>
    timestamp instanceof Timestamp ? timestamp.toDate().toISOString() : (timestamp || null);

  return {
    ...userData,
    createdAt: convert(userData.createdAt),
    updatedAt: convert(userData.updatedAt),
  } as User;
};

// Fetches a single user profile from Firestore
export const getUserProfile = async (userId: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("User Service (getUserProfile): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", userId);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      return convertUserTimestamps({ id: userSnap.id, ...userSnap.data() });
    } else {
      console.warn(`User Service (getUserProfile): No user document found for UID ${userId}.`);
      return null;
    }
  } catch (error) {
    console.error(`User Service (getUserProfile): Error fetching user profile for UID ${userId}:`, error);
    return null;
  }
};

// Creates or updates a user profile in Firestore
export const createOrUpdateUserProfile = async (
  userId: string,
  profileData: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>> & { email?: string | null }
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("User Service (createOrUpdateUserProfile): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", userId);
  try {
    const userSnap = await getDoc(userDocRef);
    let finalProfileData: User;

    if (userSnap.exists()) {
      // Update existing document
      const existingData = userSnap.data() as User;
      const updatePayload: Partial<User> & { updatedAt: any } = {
        ...profileData,
        updatedAt: serverTimestamp(),
      };
      // Ensure email is not accidentally overwritten with null if not provided and already exists
      if (profileData.email === undefined && existingData.email) {
        updatePayload.email = existingData.email;
      }
      await updateDoc(userDocRef, updatePayload);
      finalProfileData = { ...existingData, ...updatePayload, id: userId, updatedAt: new Date().toISOString() } as User;
    } else {
      // Create new document
      const newPayload: Omit<User, 'id' | 'createdAt' | 'updatedAt'> & { createdAt: any, updatedAt: any, id: string } = {
        id: userId,
        email: profileData.email || null,
        displayName: profileData.displayName || "User",
        photoURL: profileData.photoURL || null,
        username: profileData.username || null,
        role: profileData.role || "Author", // Default role
        phoneNumber: profileData.phoneNumber || null,
        institution: profileData.institution || null,
        researcherId: profileData.researcherId || null,
        isAdmin: profileData.isAdmin || false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userDocRef, newPayload);
      finalProfileData = { ...newPayload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as User;
    }
    return convertUserTimestamps(finalProfileData);
  } catch (error) {
    console.error(`User Service (createOrUpdateUserProfile): Error for UID ${userId}:`, error);
    return null;
  }
};

// Fetches all users from Firestore (for admin use)
export const getAllUsers = async (): Promise<User[]> => {
  if (!firestoreDb) {
    console.error("User Service (getAllUsers): Firestore DB instance is not available.");
    return [];
  }
  try {
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, orderBy("createdAt", "desc")); // Order by creation date, for example
    const querySnapshot = await getDocs(q);
    const users = querySnapshot.docs.map(docSnap => convertUserTimestamps({ id: docSnap.id, ...docSnap.data() }));
    return users;
  } catch (error) {
    console.error("User Service (getAllUsers): Error fetching all users:", error);
    return [];
  }
};

// Check if a username is already taken
export const isUsernameTaken = async (username: string, currentUserId?: string): Promise<boolean> => {
  if (!firestoreDb) return false;
  const usersRef = collection(firestoreDb, "users");
  // Query for username, excluding the current user if provided (for profile updates)
  let q = query(usersRef, where("username", "==", username));
  if (currentUserId) {
    // This query is more complex and might require a composite index on username and a way to exclude currentUserId
    // For simplicity, we fetch all and filter, or rely on Firestore rules preventing duplicates + try/catch on write
    // A simpler approach for updates is to allow the write and catch duplicate errors,
    // or fetch the specific user by username and check if its ID is different than currentUserId.
    const userSnap = await getDocs(q);
    if (userSnap.empty) return false;
    return userSnap.docs.some(doc => doc.id !== currentUserId);
  }
  const querySnapshot = await getDocs(q);
  return !querySnapshot.empty;
};

// Check if a phone number is already taken
export const isPhoneNumberTaken = async (phoneNumber: string, currentUserId?: string): Promise<boolean> => {
  if (!firestoreDb || !phoneNumber) return false;
  const usersRef = collection(firestoreDb, "users");
  let q = query(usersRef, where("phoneNumber", "==", phoneNumber));
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) return false;
  if (currentUserId) {
    return querySnapshot.docs.some(doc => doc.id !== currentUserId);
  }
  return !querySnapshot.empty;
};
