
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
  getIdToken,
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
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { SignupFormValues } from '@/components/auth/SignupForm';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com'; // Can be set in .env if preferred
const MOCK_ADMIN_EMAIL = 'admin@example.com';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper function to convert Firestore Timestamps or string dates to ISO strings
const convertTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') {
    if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
  }
  if (typeof timestamp === 'object' && timestamp._seconds && typeof timestamp._seconds === 'number') {
    return new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1000000).toISOString();
  }
  // Fallback for already converted string dates, or if it's an unexpected format, try to stringify
  return String(timestamp);
};


const ensureFirestoreUserProfile = async (
  uid: string,
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> & { isSocialSignIn?: boolean }
): Promise<User | null> => {
  if (!firestoreDb) {
    toast({ variant: "destructive", title: "Critical Error", description: "Database service not configured for profile management.", duration: 10000 });
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdminEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL;
    const isMockAdminEmail = firebaseUser.email === MOCK_ADMIN_EMAIL;

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; id?: string; userId?: string; };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // Prioritize existing Firestore data for core profile fields, update with fresh Firebase Auth data if changed
      dataToSave = {
        ...existingData, // Start with existing data
        userId: uid,
        id: uid,
        email: firebaseUser.email, // Always update email from Firebase Auth
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // For fields that might be completed later, only update if new data is provided, otherwise keep existing
        username: profileDataFromSignup?.isSocialSignIn && !existingData.username ? (profileDataFromSignup?.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.isSocialSignIn && !existingData.role ? (profileDataFromSignup?.role || (isCreatorAdminEmail || isMockAdminEmail ? "Admin" : "Author")) : (existingData.role || (isCreatorAdminEmail || isMockAdminEmail ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.isSocialSignIn && !existingData.phoneNumber ? (profileDataFromSignup?.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.isSocialSignIn && !existingData.institution ? (profileDataFromSignup?.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.isSocialSignIn && !existingData.researcherId ? (profileDataFromSignup?.researcherId || null) : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || isMockAdminEmail || existingData.isAdmin === true, // Default to existing or special emails
        updatedAt: serverTimestamp(),
        // createdAt should not change if document exists
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
      };
    } else {
      // New user document
      const defaultRole = (isCreatorAdminEmail || isMockAdminEmail) ? "Admin" : "Author";
      dataToSave = {
        userId: uid,
        id: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || defaultRole,
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdminEmail || isMockAdminEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // Ensure all optional fields that are empty strings from forms become null in Firestore
    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
      if (dataToSave[key] === undefined) {
        (dataToSave as any)[key] = null;
      }
      if (key !== 'isAdmin' && dataToSave[key] === "") {
        if (['username', 'phoneNumber', 'institution', 'researcherId', 'photoURL', 'displayName'].includes(key)) {
          (dataToSave as any)[key] = null;
        }
      }
    });
    
    await setDoc(userDocRef, dataToSave, { merge: true });

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      const finalIsAdmin = finalData.isAdmin === true;

      return {
        id: userDocAfterSave.id,
        ...finalData,
        isAdmin: finalIsAdmin,
        createdAt: convertTimestampToISO(finalData.createdAt),
        updatedAt: convertTimestampToISO(finalData.updatedAt),
      } as User;
    }
    return null;
  } catch (error: any) {
    console.error("AuthContext (ensureFirestoreUserProfile): Error for UID", uid, error.message, error.code, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 15000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return; // Only run if mounted

    if (!firebaseAuth || !firestoreDb) {
      // This console.error is critical for developers
      console.error("AuthContext: Firebase Auth or Firestore DB instance is not available. Client-side features will be limited.");
      toast({
        variant: "destructive",
        title: "Application Configuration Error",
        description: "Core authentication or database services are not available. Please contact support.",
        duration: 10000,
      });
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      setActiveSocialLoginProvider(null); // Reset social login state

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }
          const completingProfileQueryFlag = searchParamsFromHook?.get('complete') === 'true';

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);

          if (!isProfileComplete && pathname !== '/user/profile/settings') {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/user/profile/settings?complete=true');
          } else if (isProfileComplete && pathname === '/user/profile/settings' && (completingProfileQueryFlag || completingProfileStorageFlag === 'true')) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            }
            const targetPath = redirectAfterLoginPath || (appUser.isAdmin ? '/admin/dashboard' : '/user/dashboard');
            if (pathname !== targetPath) router.push(targetPath);
          } else if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            if (pathname !== redirectAfterLoginPath) router.push(redirectAfterLoginPath);
          } else {
            const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === '/' || pathname === '/user/profile/settings';

            if (appUser.isAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
              if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
            } else if (!appUser.isAdmin && onAuthPages) {
              if (pathname !== '/user/dashboard') router.push('/user/dashboard');
            }
          }
        } else {
          toast({
            variant: "destructive",
            title: "Profile Synchronization Failed",
            description: "There was an issue loading your profile. You have been logged out. Please try logging in again.",
            duration: 7000,
          });
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else {
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
          } else {
            setLoading(false);
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email for login.`;
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = `No user found with username '${identifier}'.`;
          toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
          throw new Error(errorMsg);
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and redirecting
      toast({ title: "Login Successful!", description: "Welcome back!" });
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
      setLoading(false);
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError); // Retained for dev debugging
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    let firebaseUserInstance: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUserInstance = cred.user;
    } catch (authError: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = authError.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUserInstance) {
      try {
        if (data.fullName && data.fullName !== firebaseUserInstance.displayName) {
            await updateFirebaseProfile(firebaseUserInstance, { displayName: data.fullName });
        }
        const appUser = await ensureFirestoreUserProfile(firebaseUserInstance.uid, firebaseUserInstance, data);
        if (!appUser) throw new Error("Failed to create Firestore profile after signup.");
        toast({ title: "Signup Successful!", description: "Welcome to ResearchSphere." });
        // onAuthStateChanged will handle setting user state and redirection
      } catch (profileError: any) {
        setLoading(false);
        // console.error("AuthContext (signup): Profile setup error:", profileError.message, profileError); // Retained for dev debugging
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
         throw profileError;
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      // onAuthStateChanged will set user to null and handle redirect
      router.push('/'); // Explicit redirect to home after logout
    } catch (error: any) {
      setLoading(false);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed. If this persists, please ensure popups are allowed for this site or try again.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method.";
          break;
        case 'auth/operation-not-allowed':
            toastTitle = "Sign-In Method Disabled";
            toastMessage = `${providerName} sign-in is not enabled for this app.`;
            break;
        case 'auth/popup-blocked':
            toastTitle = "Popup Blocked";
            toastMessage = `Your browser blocked the ${providerName} sign-in popup. Please allow popups for this site and try again.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    setLoading(false);
    setActiveSocialLoginProvider(null);
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user state and redirection
      toast({ title: `${providerName} Login Successful!`, description: "Welcome!" });
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable. Cannot update profile.";
      toast({ variant: "destructive", title: "Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    setLoading(true);
    let optimisticallyUpdatedUser: User = { ...user, ...updatedData, updatedAt: new Date().toISOString() } as User;

    try {
      // Uniqueness checks for username and phone
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", updatedData.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      // Update Firebase Auth profile (displayName only)
      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: any = { updatedAt: serverTimestamp() };

      (Object.keys(updatedData) as Array<keyof typeof updatedData>).forEach(key => {
          if (updatedData[key] !== undefined && user[key as keyof User] !== updatedData[key]) {
              updatePayloadFS[key] = updatedData[key] === "" ? null : updatedData[key];
          }
      });
      
      if (Object.keys(updatePayloadFS).length > 1) { // ensure there's more than just updatedAt
        await updateDoc(userDocRef, updatePayloadFS);
      }
      
      // Optimistically update local state with merged data
      optimisticallyUpdatedUser = {
        ...user, // Start with current user state
        ...updatePayloadFS, // Apply validated and prepared updates
        displayName: updatedData.displayName || user.displayName, // Ensure displayName is correctly prioritized
        updatedAt: new Date().toISOString(), // Simulate timestamp update
        isAdmin: user.isAdmin, // Preserve admin status from current state
      } as User;

      (Object.keys(optimisticallyUpdatedUser) as Array<keyof User>).forEach(key => {
        if (optimisticallyUpdatedUser[key] === "") {
          if (['username', 'phoneNumber', 'institution', 'researcherId', 'photoURL', 'displayName', 'role'].includes(key)) {
            (optimisticallyUpdatedUser as any)[key] = null;
          }
        }
      });

      setUser(optimisticallyUpdatedUser); // Update context immediately
      
      // Re-fetch from Firestore to get server-confirmed data (optional, but good for consistency)
      const updatedUserFromDb = await ensureFirestoreUserProfile(user.id, firebaseAuth.currentUser, {});
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Update with canonical data
        optimisticallyUpdatedUser = updatedUserFromDb;
      }
      
      toast({ title: "Success", description: "Your profile has been updated." });

      // Handle redirection after profile completion
      const isProfileNowComplete = !!(optimisticallyUpdatedUser.username && optimisticallyUpdatedUser.role && optimisticallyUpdatedUser.phoneNumber);
      if (isProfileNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');
          const targetPath = redirectPath || (optimisticallyUpdatedUser.isAdmin ? '/admin/dashboard' : '/user/dashboard');
          if (pathname !== targetPath) router.push(targetPath);
      }
      return optimisticallyUpdatedUser;

    } catch(error: any) {
        setLoading(false);
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        throw error;
    } finally {
        setLoading(false);
    }
  };

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
