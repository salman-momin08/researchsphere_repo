
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction, useContext } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import {
  auth as firebaseAuth,
  db as firestoreDb,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider,
} from '@/lib/firebase';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  type User as FirebaseUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com';

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard'; // Assuming this exists
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const HOME_PATH = '/';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (emailAddress: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt' | 'userId'>>) => Promise<User | null>;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const convertTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof timestamp === 'object' && typeof timestamp.seconds === 'number' && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  // console.warn("AuthContext (convertTimestampToISO): Could not convert timestamp, returning as string:", timestamp);
  return String(timestamp);
};

const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB is not available.");
    toast({ variant: "destructive", title: "Database Error", description: "User profile database is not available. Please try again later." });
    return null;
  }
  const { uid, email: firebaseEmail, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let finalUserData: User;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as Partial<User>;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

      const isCreatorOrMockAdminByEmail = firebaseEmail === ADMIN_CREATOR_EMAIL || firebaseEmail === MOCK_ADMIN_EMAIL;

      const dataToUpdate: Partial<User> & { updatedAt?: any, createdAt?: any } = {
        userId: uid, // Ensure userId is always present
        email: firebaseEmail || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (firebaseEmail ? firebaseEmail.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username !== undefined ? existingData.username : null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role !== undefined ? existingData.role : (isCreatorOrMockAdminByEmail ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber !== undefined ? existingData.phoneNumber : null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution !== undefined ? existingData.institution : null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId !== undefined ? existingData.researcherId : null),
        isAdmin: isCreatorOrMockAdminByEmail || existingData.isAdmin === true, // Prioritize email check, then existing
        isSuspended: existingData.isSuspended === true, // Preserve existing suspension status
        updatedAt: serverTimestamp(),
      };

      if (existingData.createdAt) {
        dataToUpdate.createdAt = existingData.createdAt; // Preserve original creation timestamp
      } else {
        // console.warn(`AuthContext (ensureFirestoreUserProfile): Missing createdAt for existing user ${uid}. Setting now.`);
        dataToUpdate.createdAt = serverTimestamp(); // Set if somehow missing
      }
      
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToUpdate);
      await setDoc(userDocRef, dataToUpdate, { merge: true });
      const updatedSnap = await getDoc(userDocRef);
      if (!updatedSnap.exists()) {
        console.error(`AuthContext (ensureFirestoreUserProfile): Failed to re-fetch user document after update for ${uid}.`);
        throw new Error("Failed to re-fetch user document after update.");
      }
      
      const rawUpdatedData = { id: uid, ...updatedSnap.data() } as any;
      finalUserData = {
        ...rawUpdatedData,
        createdAt: convertTimestampToISO(rawUpdatedData.createdAt),
        updatedAt: convertTimestampToISO(rawUpdatedData.updatedAt),
      } as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated existing user ${uid} with data:`, finalUserData);

    } else { // User document doesn't exist, create it
      const isCreatorOrMockAdminByEmail = firebaseEmail === ADMIN_CREATOR_EMAIL || firebaseEmail === MOCK_ADMIN_EMAIL;
      const dataToSave: Omit<User, 'id'> & { createdAt: any, updatedAt: any } = {
        userId: uid,
        email: firebaseEmail,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (firebaseEmail ? firebaseEmail.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isCreatorOrMockAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorOrMockAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      // console.log(`AuthContext (ensureFirestoreUserProfile): Creating new Firestore profile for ${uid} with data:`, dataToSave);
      await setDoc(userDocRef, dataToSave); // No merge needed for new doc
      const newSnap = await getDoc(userDocRef);
      if (!newSnap.exists()) {
        console.error(`AuthContext (ensureFirestoreUserProfile): Failed to create user document after setDoc for ${uid}.`);
        throw new Error("Failed to create user document.");
      }
      
      const rawNewData = { id: uid, ...newSnap.data() } as any;
      finalUserData = {
        ...rawNewData,
        createdAt: convertTimestampToISO(rawNewData.createdAt),
        updatedAt: convertTimestampToISO(rawNewData.updatedAt),
      } as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Created and hydrated new user ${uid} with data:`, finalUserData);
    }
    return finalUserData;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}" "${error.code}"`, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [justCompletedProfile, setJustCompletedProfile] = useState(false); // Semaphore flag

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    // console.log("AuthContext: Top of main useEffect. Pathname:", pathname, "IsMounted:", isMounted);
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        setLoading(false);
      }
      return;
    }

    if (justCompletedProfile) {
        // console.log("AuthContext: justCompletedProfile is true, resetting and returning early from main useEffect.");
        setJustCompletedProfile(false);
        return; // Let the redirect from updateUserProfile be the definitive one
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser:", firebaseUser ? firebaseUser.uid : null);
      setLoading(true);
      setActiveSocialLoginProvider(null);

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          const finalIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(finalIsAdmin);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Hydrated appUser, isAdmin: ${finalIsAdmin}`);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): ProfileComplete: ${isProfileComplete}. Username: '${appUser.username}', Role: '${appUser.role}', Phone: '${appUser.phoneNumber}'`);
          
          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
            // Correct stale /user/profile/settings paths
            if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
              redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH;
              localStorage.setItem('redirectAfterLogin', AUTHOR_PROFILE_SETTINGS_PATH);
            }
          }
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${pathname}, IsAdmin: ${finalIsAdmin}, ProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}`);

          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            // console.log(`AuthContext: Profile incomplete for ${appUser.email}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            // console.log(`AuthContext: Profile complete for ${appUser.email} AND on profile settings with completing flag. Redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              localStorage.removeItem('redirectAfterLogin'); // Clear this as its purpose is served
            }
            const targetDashboard = finalIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH ? redirectAfterLoginPath : targetDashboard);
          } else if (redirectAfterLoginPath && redirectAfterLoginPath !== pathname) {
            // console.log(`AuthContext: Found redirectAfterLoginPath: ${redirectAfterLoginPath} for ${appUser.email}. Redirecting.`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            let targetPath = redirectAfterLoginPath;
            if (finalIsAdmin && !targetPath.startsWith('/admin/')) {
              targetPath = ADMIN_DASHBOARD_PATH;
            } else if (!finalIsAdmin && targetPath.startsWith('/admin/')) {
              targetPath = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
            }
            router.push(targetPath);
          } else {
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === HOME_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH);

            if (finalIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
              if (pathname !== ADMIN_DASHBOARD_PATH) {
                // console.log(`AuthContext: Admin ${appUser.email} on non-admin entry point ${pathname}. Redirecting to Admin Dashboard.`);
                router.push(ADMIN_DASHBOARD_PATH);
              }
            } else if (!finalIsAdmin && onAuthPages && isProfileComplete) {
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              // console.log(`AuthContext: Non-admin ${appUser.email} on auth page ${pathname} with complete profile. Redirecting to ${userDashboard}.`);
              router.push(userDashboard);
            } else {
              // console.log(`AuthContext: No specific redirect needed for ${appUser.email} on ${pathname}.`);
            }
          }
        } else { // appUser is null from ensureFirestoreUserProfile
          console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // No firebaseUser
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
        }
      }
      // console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
      setLoading(false);
    });
    return () => unsubscribe();
  }, [isMounted, router, pathname, searchParamsFromHook, user, justCompletedProfile]); // Added user and justCompletedProfile

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDocData = querySnapshot.docs[0].data();
          if (userDocData.email) {
            emailToLogin = userDocData.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            // console.error(`AuthContext (login): Username '${identifier}' found but no associated email.`);
            throw new Error("Username found but no associated email. Please try logging in with email.");
          }
        } else {
          // console.warn(`AuthContext (login): Username '${identifier}' not found in Firestore.`);
           throw new Error("Invalid email/username or password."); // Generic message for security
        }
      } catch (dbError: any) {
        setLoading(false);
        console.error("AuthContext (login): Firestore error looking up username:", dbError);
        toast({ variant: "destructive", title: "Login Error", description: dbError.message || "Error looking up username." });
        throw dbError;
      }
    }
    try {
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle redirection and user state
    } catch (error) {
      const firebaseError = error as { code?: string; message?: string };
      let errorMessage = "An unknown error occurred during login.";
      if (firebaseError.code) {
        switch (firebaseError.code) {
          case 'auth/user-not-found':
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            errorMessage = 'Invalid email/username or password.';
            break;
          case 'auth/invalid-email':
            errorMessage = 'The email address is not valid.';
            break;
          case 'auth/user-disabled':
            errorMessage = 'This user account has been disabled.';
            break;
          default:
            errorMessage = firebaseError.message || errorMessage;
        }
      }
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      // setLoading(false) handled by onAuthStateChanged
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    try {
      // Check username uniqueness in Firestore
      if (data.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", data.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Check phone number uniqueness in Firestore
      if (data.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (data.fullName && data.fullName !== cred.user.displayName) {
        await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      // Pass signup data to ensureFirestoreUserProfile to create the Firestore doc
      await ensureFirestoreUserProfile(cred.user, data);
      // onAuthStateChanged will handle setting user state and redirecting.
      toast({ title: "Account Created!", description: "Welcome! Please complete your profile if prompted." });
    } catch (error: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'The email address is not valid.';
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMessage = 'Email/password accounts are not enabled.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'The password is too weak.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      console.error("AuthContext (signup): Signup error:", errorMessage, error);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
    // setLoading(false) handled by onAuthStateChanged
  };

  const logout = async () => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      return;
    }
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      // setUser and setIsAdminUser are handled by onAuthStateChanged
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push(HOME_PATH);
    } catch (error: any) {
      console.error("AuthContext (logout): Logout error:", error);
      toast({ variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out." });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    setLoading(false); 
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName} Login Error`;
    let toastMessage = `Could not sign in with ${providerName}. Please try again.`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Please log in with that method.";
          break;
        case 'auth/operation-not-allowed':
            toastMessage = `Sign-in with ${providerName} is not enabled. Please contact support.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, firebaseError);
    toast({
      variant: "destructive",
      title: toastTitle,
      description: toastMessage,
      duration: 10000,
    });
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available (Firebase Auth).` });
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle profile creation/fetch and redirection.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) is handled by onAuthStateChanged or error handler
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    try {
      await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
    } catch (error: any) {
      console.error("AuthContext (sendPasswordResetEmail): Error:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt' | 'userId'>>): Promise<User | null> => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      toast({ variant: "destructive", title: "Update Error", description: "User not logged in or database service unavailable." });
      throw new Error("User not logged in or database service unavailable.");
    }
    setLoading(true);
    const updatePayloadFS: any = { updatedAt: serverTimestamp() };
    let firebaseAuthUpdatePayload: { displayName?: string } = {};

    // Prepare Firestore payload
    if (updatedData.displayName !== undefined) {
      firebaseAuthUpdatePayload.displayName = updatedData.displayName || "";
      updatePayloadFS.displayName = updatedData.displayName || null;
    }
    if (updatedData.username !== undefined) {
      const newUsername = updatedData.username || null;
      if(newUsername && newUsername !== user.username){
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", newUsername));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
            setLoading(false);
            throw new Error("Username already taken. Please choose another one.");
        }
      }
      updatePayloadFS.username = newUsername;
    }
    if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || null;
    if (updatedData.phoneNumber !== undefined) {
      const newPhoneNumber = updatedData.phoneNumber || null;
      if(newPhoneNumber && newPhoneNumber !== user.phoneNumber){
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", newPhoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
            setLoading(false);
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }
      updatePayloadFS.phoneNumber = newPhoneNumber;
    }
    if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution || null;
    if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId || null;

    try {
      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }
      const userDocRef = doc(firestoreDb, "users", user.id);
      if (Object.keys(updatePayloadFS).length > 1) { // more than just updatedAt
        // console.log("AuthContext (updateUserProfile): Updating Firestore with payload:", updatePayloadFS);
        await updateDoc(userDocRef, updatePayloadFS);
      }

      // Optimistically update local state, then re-fetch to confirm & get server timestamps
      const optimisticallyUpdatedUser = {
        ...user,
        ...updatePayloadFS, 
        displayName: firebaseAuthUpdatePayload.displayName !== undefined ? firebaseAuthUpdatePayload.displayName : user.displayName,
        updatedAt: new Date().toISOString(), // Temporary, will be overwritten by Firestore fetch
      } as User;

      setUser(optimisticallyUpdatedUser); // Optimistic update for UI responsiveness
      setIsAdminUser(optimisticallyUpdatedUser.isAdmin === true);

      const updatedUserFromDb = await ensureFirestoreUserProfile(firebaseAuth.currentUser); // Re-fetch
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Set with server timestamps
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        // console.log("AuthContext (updateUserProfile): Profile successfully updated and re-fetched from Firestore:", updatedUserFromDb);
        toast({ title: "Success", description: "Your profile has been updated." });

        const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
          // console.log("AuthContext (updateUserProfile): Profile is now complete. Setting justCompletedProfile to true and redirecting.");
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            let redirectPath = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin');
            if (redirectPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectPath === `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`) {
                redirectPath = null;
            }
            const targetDashboard = updatedUserFromDb.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedUserFromDb.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            setJustCompletedProfile(true); // Signal to main useEffect to stand down
            router.push(redirectPath || targetDashboard);
          }
        }
        return updatedUserFromDb;
      } else {
        console.error("AuthContext (updateUserProfile): Failed to re-fetch profile after update.");
        throw new Error("Failed to re-fetch profile after update.");
      }
    } catch (error: any) {
      console.error("AuthContext (updateUserProfile): Error updating profile:", error);
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser)) {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
        <LoadingSpinner size={48} />
        <p className="ml-3">Initializing Application...</p>
      </div>
    );
  }
  
  if ((!firebaseAuth || !firestoreDb) && isMounted) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif', color: 'red', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <h1>Application Configuration Error</h1>
        <p>Firebase services (Auth or Firestore) are not available. Please ensure your Firebase environment variables (NEXT_PUBLIC_FIREBASE_...) are correctly set up in your <strong>.env.local</strong> file (for local development) AND in your <strong>Vercel project environment variables</strong> (for deployment), and that the server has been restarted.</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAdmin: isAdminUser,
      login, signup, logout,
      loginWithGoogle, loginWithGitHub,
      sendPasswordResetEmail, updateUserProfile,
      showLoginModal, setShowLoginModal,
      isSocialLoginInProgress: activeSocialLoginProvider !== null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

