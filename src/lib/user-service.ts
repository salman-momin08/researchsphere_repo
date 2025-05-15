
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
  orderBy,
} from "firebase/firestore";
import { db as firestoreDb } from "@/lib/firebase";
import type { User } from '@/types';

// Helper to convert Firestore Timestamps in user data
const convertUserTimestamps = (userData: any): User => {
  const convert = (timestamp: any) => {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
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
export const createOrUpdateUserProfileInFirestore = async (
  uid: string,
  data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>> & { email?: string | null }
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

    const baseProfileData = {
      email: data.email || null,
      displayName: data.displayName || "User",
      photoURL: data.photoURL || null,
      username: data.username || null,
      role: data.role || "Author",
      phoneNumber: data.phoneNumber || null,
      institution: data.institution || null,
      researcherId: data.researcherId || null,
      isAdmin: data.isAdmin || false, // Ensure this default is considered
      ...data, // Spread remaining data to override defaults if present
    };

    if (userSnap.exists()) {
      profileToSave = { ...baseProfileData, updatedAt: now };
      if (userSnap.data().createdAt && !profileToSave.createdAt) {
        profileToSave.createdAt = userSnap.data().createdAt;
      }
      await updateDoc(userDocRef, profileToSave);
    } else {
      profileToSave = {
        id: uid,
        ...baseProfileData,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(userDocRef, profileToSave);
    }
    const updatedSnap = await getDoc(userDocRef);
    if (updatedSnap.exists()) {
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
  console.log("User Service (getAllUsers): Attempting to fetch all users from Firestore.");
  try {
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    console.log(`User Service (getAllUsers): Firestore query successful. Found ${querySnapshot.docs.length} user documents.`);
    if (querySnapshot.empty) {
        console.warn("User Service (getAllUsers): No user documents found in the 'users' collection.");
    }
    const users = querySnapshot.docs.map(docSnap => {
      // console.log(`User Service (getAllUsers): Processing user doc: ${docSnap.id}`, docSnap.data());
      return convertUserTimestamps({ id: docSnap.id, ...docSnap.data() });
    });
    return users;
  } catch (error) {
    console.error("User Service (getAllUsers): Error fetching all users from Firestore:", error);
    return [];
  }
};

// Check if a username is already taken (excluding a specific user, for updates)
export const isUsernameTaken = async (username: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb) {
    console.error("User Service (isUsernameTaken): Firestore DB instance is not available.");
    return false;
  }
  const usersRef = collection(firestoreDb, "users");
  let q = query(usersRef, where("username", "==", username));
  try {
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      return false;
    }
    if (excludeUserId) {
      return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
    }
    return true;
  } catch (error) {
    console.error("User Service (isUsernameTaken): Error checking username:", error);
    return false;
  }
};

// Check if a phone number is already taken (excluding a specific user, for updates)
export const isPhoneNumberTaken = async (phoneNumber: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb) {
    console.error("User Service (isPhoneNumberTaken): Firestore DB instance is not available.");
    return false;
  }
  if (!phoneNumber) return false;

  const usersRef = collection(firestoreDb, "users");
  let q = query(usersRef, where("phoneNumber", "==", phoneNumber));
  try {
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      return false;
    }
    if (excludeUserId) {
      return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
    }
    return true;
  } catch (error) {
    console.error("User Service (isPhoneNumberTaken): Error checking phone number:", error);
    return false;
  }
};

export const toggleUserAdminStatus = async (targetUserId: string, currentIsAdmin: boolean): Promise<void> => {
  if (!firestoreDb) {
    console.error("User Service (toggleUserAdminStatus): Firestore DB instance is not available.");
    throw new Error("Database service unavailable.");
  }
  console.log(`User Service (toggleUserAdminStatus): Attempting to set admin status for user ${targetUserId} to ${!currentIsAdmin}.`);
  const userDocRef = doc(firestoreDb, "users", targetUserId);
  try {
    await updateDoc(userDocRef, {
      isAdmin: !currentIsAdmin,
      updatedAt: serverTimestamp(),
    });
    console.log(`User Service (toggleUserAdminStatus): Successfully updated admin status for user ${targetUserId}.`);
  } catch (error) {
    console.error(`User Service (toggleUserAdminStatus): Error updating admin status for user ${targetUserId}:`, error);
    throw new Error("Failed to update user admin status.");
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
