
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
  orderBy, // Added orderBy import
} from "firebase/firestore";
import { db as firestoreDb } from "@/lib/firebase"; // Use db from firebase.ts
import type { User } from '@/types';

// Helper to convert Firestore Timestamps in user data
const convertUserTimestamps = (userData: any): User => {
  const convert = (timestamp: any) => {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
    // Handle cases where it might already be an ISO string or a Date object from client-side mock data
    if (typeof timestamp === 'string') return timestamp;
    if (timestamp instanceof Date) return timestamp.toISOString();
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
    console.error("User Service (getUserProfile): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", userId);
  try {
    // console.log(`User Service (getUserProfile): Fetching user profile for UID ${userId}.`);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      // console.log(`User Service (getUserProfile): User profile found for ${userId}. Data:`, userSnap.data());
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
// Note: `email` is typically managed by Firebase Auth and should be consistent.
// `isAdmin` is managed server-side or manually for security.
export const createOrUpdateUserProfileInFirestore = async (
  uid: string,
  data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'isAdmin'>> & { email?: string | null, isAdmin?: boolean }
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("User Service (createOrUpdateUserProfileInFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    const userSnap = await getDoc(userDocRef);
    const now = serverTimestamp();
    let profileToSave: any;

    if (userSnap.exists()) {
      // Update existing document
      // console.log(`User Service (createOrUpdateUserProfileInFirestore): Updating existing profile for ${uid}. Data:`, data);
      profileToSave = { ...data, updatedAt: now };
      // Preserve existing createdAt if not provided (shouldn't be in updates)
      if (userSnap.data().createdAt && !profileToSave.createdAt) {
        profileToSave.createdAt = userSnap.data().createdAt;
      }
      await updateDoc(userDocRef, profileToSave);
    } else {
      // Create new document
      // console.log(`User Service (createOrUpdateUserProfileInFirestore): Creating new profile for ${uid}. Data:`, data);
      profileToSave = {
        id: uid, // Ensure id is stored in the document
        email: data.email || null,
        displayName: data.displayName || "User",
        photoURL: data.photoURL || null,
        username: data.username || null,
        role: data.role || "Author",
        phoneNumber: data.phoneNumber || null,
        institution: data.institution || null,
        researcherId: data.researcherId || null,
        isAdmin: data.isAdmin || false, // Default isAdmin to false for new profiles unless specified
        createdAt: now,
        updatedAt: now,
        ...data, // Spread remaining data
      };
      await setDoc(userDocRef, profileToSave);
    }
    // Fetch the possibly merged/updated document to return consistent data
    const updatedSnap = await getDoc(userDocRef);
    if (updatedSnap.exists()) {
      // console.log(`User Service (createOrUpdateUserProfileInFirestore): Profile operation successful for ${uid}.`);
      return convertUserTimestamps({ id: updatedSnap.id, ...updatedSnap.data() });
    }
    return null;
  } catch (error) {
    console.error(`User Service (createOrUpdateUserProfileInFirestore): Error for UID ${uid}:`, error);
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

// Check if a username is already taken (excluding a specific user, for updates)
export const isUsernameTaken = async (username: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb) {
    console.error("User Service (isUsernameTaken): Firestore DB instance is not available.");
    return false; // Or throw error, depending on desired handling
  }
  const usersRef = collection(firestoreDb, "users");
  let q = query(usersRef, where("username", "==", username));
  try {
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      return false; // Username not taken
    }
    // If excludeUserId is provided, check if the found user is different
    if (excludeUserId) {
      return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
    }
    return true; // Username taken and no exclusion
  } catch (error) {
    console.error("User Service (isUsernameTaken): Error checking username:", error);
    return false; // Default to not taken on error to avoid blocking valid signups, or handle error differently
  }
};

// Check if a phone number is already taken (excluding a specific user, for updates)
export const isPhoneNumberTaken = async (phoneNumber: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb) {
    console.error("User Service (isPhoneNumberTaken): Firestore DB instance is not available.");
    return false;
  }
  if (!phoneNumber) return false; // Empty phone number is not "taken"

  const usersRef = collection(firestoreDb, "users");
  let q = query(usersRef, where("phoneNumber", "==", phoneNumber));
  try {
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      return false; // Phone number not taken
    }
    if (excludeUserId) {
      return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
    }
    return true; // Phone number taken
  } catch (error) {
    console.error("User Service (isPhoneNumberTaken): Error checking phone number:", error);
    return false;
  }
};

// Helper to convert client-side User data to Firestore-compatible data, especially for timestamps
export const prepareUserDataForFirestore = (userData: Partial<User>): any => {
  const data: any = { ...userData };
  if (data.createdAt && typeof data.createdAt === 'string') {
    data.createdAt = Timestamp.fromDate(new Date(data.createdAt));
  }
  if (data.updatedAt && typeof data.updatedAt === 'string') {
    data.updatedAt = Timestamp.fromDate(new Date(data.updatedAt));
  }
  return data;
};
