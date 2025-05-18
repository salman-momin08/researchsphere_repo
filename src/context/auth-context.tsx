
"use client";

import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  updateProfile as firebaseUpdateProfileAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, updateDoc, query, where, getDocs, collection } from 'firebase/firestore';
import { auth as firebaseAuth, db as firestoreDb } from '@/lib/firebase';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import type { User } from '@/types';
import { useToast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com"; // For pre-existing admin logic if needed

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdminUser: boolean;
  isProfileComplete: boolean; // Will be derived from user object
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (emailForReset: string) => Promise<void>;
  updateUserProfile: (data: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => Promise<boolean>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const convertFirestoreTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string' && !isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  return String(timestamp);
};

// This function ensures a user profile exists in Firestore.
// If it exists, it fetches it. If not (e.g., first social login), it creates it.
const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> // Data from signup/profile form
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
    return null;
  }
  const uid = firebaseUser.uid;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Partial<User>;

    if (userSnap.exists()) {
      // User document exists, fetch and potentially update non-critical fields
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData, // Prioritize existing Firestore data for core profile fields
        id: uid,
        userId: uid,
        email: firebaseUser.email || existingData.email, // Update if Firebase Auth email changed
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // Only update these from profileDataFromSignup if provided during an explicit update
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username || null : existingData.username,
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : existingData.role,
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber || null : existingData.phoneNumber,
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution || null : existingData.institution,
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId || null : existingData.researcherId,
        isAdmin: existingData.isAdmin || firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL, // Preserve existing admin status
        updatedAt: serverTimestamp(),
      };
    } else {
      // New user document, create with defaults
      const isCreatorAdmin = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;
      dataToSave = {
        id: uid,
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: isCreatorAdmin ? "Admin" : profileDataFromSignup?.role || "Author",
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdmin,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    await setDoc(userDocRef, dataToSave, { merge: true });
    const finalSnap = await getDoc(userDocRef); // Re-fetch for server timestamps

    if (finalSnap.exists()) {
      const rawData = { id: finalSnap.id, ...finalSnap.data() } as any;
      return {
        ...rawData,
        createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
        updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
      } as User;
    }
    throw new Error(`User document ${uid} not found after create/update.`);

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}:`, error.message, error.code, error);
    // Do not toast here, let the calling function handle user-facing errors
    throw error; // Re-throw for onAuthStateChanged or calling function to handle
  }
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [initialAuthCheckComplete, setInitialAuthCheckComplete] = useState(false);
  const [showIncompleteProfileToast, setShowIncompleteProfileToast] = useState(false);


  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // For reading query params like ?complete=true
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);


  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        setLoading(false);
        setInitialAuthCheckComplete(true);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      let appUser: User | null = null;
      const currentWindowPathname = window.location.pathname; // Get freshest pathname

      if (firebaseUser) {
        try {
          appUser = await ensureFirestoreUserProfile(firebaseUser);
        } catch (firestoreError: any) {
          console.error("AuthContext: Critical Firestore error during profile sync, logging out:", firestoreError);
          toast({
            variant: "destructive",
            title: "Profile Sync Error",
            description: `Could not synchronize your profile with our database (${firestoreError.code || 'FS_ERR'}). You have been logged out. Please try again. If the issue persists, contact support. Details: ${firestoreError.message}`,
            duration: 10000
          });
          if (firebaseAuth) await signOut(firebaseAuth); // This will re-trigger onAuthStateChanged with null
          // appUser remains null
        }

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          const currentIsProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(currentIsProfileComplete);

          const redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;

          if (!currentIsProfileComplete) {
            // Show toast only once per session if profile is incomplete
            if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShown')) {
              setShowIncompleteProfileToast(true);
              sessionStorage.setItem('incompleteProfileToastShown', 'true');
            }
            // No automatic redirect, user stays on current page or goes to dashboard
          }

          if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            router.push(redirectAfterLoginPath);
          } else {
            // Default redirection after login if no specific path was targeted
            if (currentWindowPathname === LOGIN_PATH || currentWindowPathname === SIGNUP_PATH) {
              if (determinedIsAdmin) {
                router.push(ADMIN_DASHBOARD_PATH);
              } else {
                router.push(appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              }
            }
          }
        } else { // appUser is null due to Firestore error
          setUser(null);
          setIsAdminUser(false);
          setIsProfileComplete(false);
          // Logout already handled if firestoreError occurred
        }
      } else { // No firebaseUser
        setUser(null);
        setIsAdminUser(false);
        setIsProfileComplete(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          sessionStorage.removeItem('incompleteProfileToastShown'); // Clear toast flag on logout
        }
      }
      setLoading(false);
      setInitialAuthCheckComplete(true);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook]);


  useEffect(() => {
    if (showIncompleteProfileToast) {
      toast({
        title: "Profile Incomplete",
        description: "Some essential profile details (like username or phone number) seem to be missing. Please visit 'Profile Settings' to complete your profile for full functionality.",
        duration: 8000, // Longer duration
        action: (
          <button
            onClick={() => router.push(AUTHOR_PROFILE_SETTINGS_PATH)}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Go to Settings
          </button>
        ),
      });
      setShowIncompleteProfileToast(false); // Reset after showing
    }
  }, [showIncompleteProfileToast, toast, router]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();

    try {
      if (!identifier.includes('@')) { // Assume it's a username
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) {
            emailToLogin = userData.email;
          } else {
            throw new Error("User record incomplete (missing email for username).");
          }
        } else {
          // No user found with this username, will likely fail Firebase auth
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle success.
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShown'); // Allow toast on new login
    } catch (error: any) {
      let errorMessage = error.code === 'auth/invalid-credential' || error.message.includes("User record incomplete")
        ? "Invalid email/username or password."
        : (error.message || "Login failed.");
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      // Check username uniqueness
      if (data.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) throw new Error("Username already taken. Please choose another one.");
      }
      // Check phone number uniqueness
      if (data.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) throw new Error("Phone number already in use by another account.");
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.fullName });
        // ensureFirestoreUserProfile will be called by onAuthStateChanged, passing signup data
        await ensureFirestoreUserProfile(userCredential.user, data);
      }
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShown');
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') errorMessage = "Email already registered.";
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method. Please log in with the original method.`;
    } else if (error.code === 'auth/operation-not-allowed') {
      toastMessage = `${providerName} sign-in is not enabled for this project. Contact support.`;
    } else if (error.code === 'auth/popup-blocked') {
      toastMessage = `The ${providerName} sign-in popup was blocked. Please allow popups and try again.`;
    }

    toast({
      title: toastTitle,
      description: toastMessage,
      variant: "destructive",
      duration: 10000,
    });
    setLoading(false);
  };

  const processSocialLogin = async (providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    const providerInstance = providerName === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
    try {
      const result = await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user and profile creation.
      // ensureFirestoreUserProfile will be called by onAuthStateChanged
      await ensureFirestoreUserProfile(result.user);
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShown');
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      setActiveSocialLoginProvider(null);
      // setLoading(false) handled by onAuthStateChanged or error handler
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // User state cleared by onAuthStateChanged
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      // Redirection to LOGIN_PATH will be handled by ProtectedRoute or onAuthStateChanged if on protected page
    } catch (error: any) {
      toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (emailForReset: string) => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      await firebaseSendPasswordResetEmail(firebaseAuth, emailForReset);
    } catch (error: any) {
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (
    data: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>
  ): Promise<boolean> => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      toast({ variant: "destructive", title: "Authentication Error", description: "User not authenticated. Please log in again." });
      throw new Error("User not authenticated for profile update.");
    }
    setLoading(true);
    const currentFirebaseUser = firebaseAuth.currentUser;
    let success = false;

    try {
      const usersRef = collection(firestoreDb, "users");
      if (data.username && data.username.trim() !== "" && data.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (data.phoneNumber && data.phoneNumber.trim() !== "" && data.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const updatePayloadFS: any = { updatedAt: serverTimestamp() };
      if (data.displayName !== undefined) updatePayloadFS.displayName = data.displayName?.trim() || null;
      if (data.username !== undefined) updatePayloadFS.username = data.username?.trim() || null;
      if (data.phoneNumber !== undefined) updatePayloadFS.phoneNumber = data.phoneNumber?.trim() || null;
      if (data.institution !== undefined) updatePayloadFS.institution = data.institution?.trim() || null;
      if (data.researcherId !== undefined) updatePayloadFS.researcherId = data.researcherId?.trim() || null;
      if (data.role !== undefined) updatePayloadFS.role = data.role || "Author";

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (data.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== data.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: data.displayName });
      }
      
      // Re-fetch to ensure local state is perfectly in sync with DB, especially for timestamps
      const updatedUserFromDb = await ensureFirestoreUserProfile(currentFirebaseUser, data);
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Update global state
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        const isNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        setIsProfileComplete(isNowComplete);
        toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });
        success = true;
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

    } catch (error: any) {
      if (error.message !== "Username already taken. Please choose another one." && error.message !== "Phone number already in use. Please use a different one.") {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      }
      throw error;
    } finally {
      setLoading(false);
    }
    return success;
  };

  if (!isMounted || !initialAuthCheckComplete) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem' }}>
        <LoadingSpinner size={48} />
        <p className="ml-3">Initializing Application...</p>
      </div>
    );
  }

  if ((!firebaseAuth || !firestoreDb) && isMounted) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h1 className="text-2xl font-bold text-destructive mb-2">Application Configuration Error</h1>
        <p className="text-muted-foreground mb-1">Crucial Firebase services (Authentication or Firestore) are not available.</p>
        <p className="text-sm text-muted-foreground">Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correctly set in your <code>.env.local</code> file (for local development) or in your Vercel project environment variables (for deployment).</p>
        <p className="text-xs text-muted-foreground mt-2">The application cannot proceed without these services. Restart after verifying.</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdminUser,
        isProfileComplete, // This is derived from 'user' state
        login,
        signup,
        logout,
        loginWithGoogle,
        loginWithGitHub,
        sendPasswordResetEmail,
        updateUserProfile,
        showLoginModal,
        setShowLoginModal,
        isSocialLoginInProgress: !!activeSocialLoginProvider,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

    