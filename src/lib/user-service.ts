
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
    if (typeof timestamp === 'string') { // Could be an ISO string already
        if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
    }
    if (timestamp instanceof Date) return timestamp.toISOString(); // Handle Date objects
    // Check for Firestore-like timestamp object structure if directly from non-converted snapshot
    if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
        return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
    }
    return null; // Fallback if not a recognizable timestamp format
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
  } catch (error) {
    return null;
  }
};

// Creates or updates a user profile in Firestore
export const createOrUpdateUserProfileInFirestore = async (
  uid: string,
  data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>> & { email?: string | null }
): Promise<User | null> => {
  if (!firestoreDb) {
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
      role: data.role || "Author", // Default role
      phoneNumber: data.phoneNumber || null,
      institution: data.institution || null,
      researcherId: data.researcherId || null,
      isAdmin: data.isAdmin === true, // Ensure boolean, default to false if not explicitly set
      ...data, 
    };
     // Ensure all optional fields that might be empty strings from forms become null
    (Object.keys(baseProfileData) as Array<keyof typeof baseProfileData>).forEach(key => {
        if (baseProfileData[key] === "") {
            if (['username', 'phoneNumber', 'institution', 'researcherId', 'photoURL', 'displayName'].includes(key)) {
                (baseProfileData as any)[key] = null;
            }
        }
    });


    if (userSnap.exists()) {
      profileToSave = { ...baseProfileData, updatedAt: now };
      // Preserve createdAt if it exists
      if (userSnap.data().createdAt && !profileToSave.createdAt) {
        profileToSave.createdAt = userSnap.data().createdAt;
      }
      await updateDoc(userDocRef, profileToSave);
    } else {
      profileToSave = {
        id: uid, // Store the UID as id field as well
        userId: uid, // And as userId if preferred by queries
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
    return null;
  }
};


// Fetches all users from Firestore (for admin use)
export const getAllUsers = async (): Promise<User[]> => {
  if (!firestoreDb) {
    return [];
  }
  try {
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, orderBy("createdAt", "desc")); 
    const querySnapshot = await getDocs(q);
    const users = querySnapshot.docs.map(docSnap => convertUserTimestamps({ id: docSnap.id, ...docSnap.data() }));
    return users;
  } catch (error: any) {
    throw error; 
  }
};

export const isUsernameTakenInFirestore = async (username: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb) {
    return false; 
  }
  if (!username || username.trim() === "") return false;

  const usersRef = collection(firestoreDb, "users");
  const q = query(usersRef, where("username", "==", username));
  try {
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      return false;
    }
    // If excludeUserId is provided, check if any found doc is not the user being updated
    if (excludeUserId) {
      return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
    }
    return true; // Username taken
  } catch (error) {
    return false; // On error, assume not taken or handle error upstream
  }
};

export const isPhoneNumberTakenInFirestore = async (phoneNumber: string, excludeUserId?: string): Promise<boolean> => {
  if (!firestoreDb) {
    return false;
  }
   if (!phoneNumber || phoneNumber.trim() === "") return false;

  const usersRef = collection(firestoreDb, "users");
  const q = query(usersRef, where("phoneNumber", "==", phoneNumber));
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
    return false;
  }
};

export const toggleUserAdminStatus = async (targetUserId: string, currentIsAdmin: boolean): Promise<void> => {
  if (!firestoreDb) {
    throw new Error("Database service unavailable.");
  }
  const userDocRef = doc(firestoreDb, "users", targetUserId);
  try {
    await updateDoc(userDocRef, {
      isAdmin: !currentIsAdmin,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    throw new Error("Failed to update user admin status.");
  }
};

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
