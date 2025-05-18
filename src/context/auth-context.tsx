
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
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, updateDoc, query, where, getDocs, collection, Unsubscribe } from 'firebase/firestore';
import { auth as firebaseAuth, db as firestoreDb } from '@/lib/firebase';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import type { User } from '@/types';
import { useToast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const PUBLIC_PATHS_PATTERNS = [
  HOME_PATH, LOGIN_PATH, SIGNUP_PATH,
  /^\/registration$/, /^\/key-committee$/, /^\/sample-templates$/,
  /^\/contact-us$/, /^\/search-papers$/, /^\/terms$/, /^\/privacy$/,
  /^\/forgot-password$/
];

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com"; // Kept for potential existing admin logic

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdminUser: boolean;
  isProfileComplete: boolean;
  initialAuthCheckComplete: boolean;
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
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  return String(timestamp); // Fallback
};

const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
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
    const isCreatorAdmin = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData,
        id: uid,
        userId: uid,
        email: firebaseUser.email || existingData.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : existingData.username,
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : existingData.role,
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : existingData.phoneNumber,
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : existingData.institution,
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : existingData.researcherId,
        isAdmin: isCreatorAdmin || existingData.isAdmin || false, // Prioritize creator admin status or existing admin status
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
      };
    } else {
      dataToSave = {
        id: uid,
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: isCreatorAdmin ? "Admin" : (profileDataFromSignup?.role || "Author"),
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
    const finalSnap = await getDoc(userDocRef);

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
    throw error;
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
  const pathname = usePathname(); // Hook for current path
  const searchParamsFromHook = useNextSearchParams(); // Hook for search params

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

    const unsubscribe: Unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      let appUser: User | null = null;
      const currentWindowPathname = window.location.pathname; // Get freshest pathname for redirection decisions

      if (firebaseUser) {
        try {
          appUser = await ensureFirestoreUserProfile(firebaseUser);
        } catch (firestoreError: any) {
          toast({
            variant: "destructive",
            title: "Critical Profile Sync Error",
            description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${firestoreError.message}`,
            duration: 10000
          });
          if (firebaseAuth) await signOut(firebaseAuth);
        }

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          const currentIsProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(currentIsProfileComplete);

          const redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

          if (!currentIsProfileComplete) {
            if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShown')) {
                if (currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                    setShowIncompleteProfileToast(true); // This will trigger the toast effect
                }
                sessionStorage.setItem('incompleteProfileToastShown', 'true');
            }
            if (currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              localStorage.setItem('completingProfile', 'true');
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            }
          } else { // Profile is complete
            if (completingProfileStorageFlag && (currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
              localStorage.removeItem('completingProfile');
              localStorage.removeItem('redirectAfterLogin'); // Clear this as its purpose was likely to get to profile settings
              router.push(determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
            } else if (redirectAfterLoginPath) {
              localStorage.removeItem('redirectAfterLogin');
              let correctedRedirectPath = redirectAfterLoginPath;
              if (redirectAfterLoginPath.startsWith('/user/profile/settings') || redirectAfterLoginPath.startsWith('/profile/settings')) {
                  correctedRedirectPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`; // Ensure correct path
              }
              router.push(correctedRedirectPath);
            } else if (determinedIsAdmin && [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(currentWindowPathname) && currentWindowPathname !== ADMIN_DASHBOARD_PATH) {
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!determinedIsAdmin && [LOGIN_PATH, SIGNUP_PATH].includes(currentWindowPathname)) {
              router.push(appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            }
          }
        } else {
          setUser(null);
          setIsAdminUser(false);
          setIsProfileComplete(false);
        }
      } else { // No firebaseUser
        setUser(null);
        setIsAdminUser(false);
        setIsProfileComplete(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
          sessionStorage.removeItem('incompleteProfileToastShown');
        }
      }
      setInitialAuthCheckComplete(true);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, searchParamsFromHook, router]); // router and pathname are for re-evaluating on navigation


  useEffect(() => {
    if (showIncompleteProfileToast) {
      toast({
        title: "Profile Incomplete",
        description: "Some essential profile details (like username, role, or phone number) seem to be missing. Please visit 'Profile Settings' to complete your profile for full functionality.",
        duration: 8000,
        action: (
          <button
            onClick={() => {
                localStorage.setItem('completingProfile', 'true'); // Ensure flag is set if user clicks this
                router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Go to Settings
          </button>
        ),
      });
      setShowIncompleteProfileToast(false);
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
      if (!identifier.includes('@')) {
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
          // Will likely fail Firebase auth
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShown');
    } catch (error: any) {
      let firebaseError = error;
      let errorMessage = error.code === 'auth/invalid-credential' || error.message.includes("User record incomplete")
        ? "Invalid email/username or password."
        : (error.message || "Login failed.");
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      // setLoading(false); // onAuthStateChanged will handle this
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      // Uniqueness checks before Firebase Auth user creation
      const usersRef = collection(firestoreDb, "users");
      if (data.username) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) throw new Error("Username already taken. Please choose another one.");
      }
      if (data.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) throw new Error("Phone number already in use by another account.");
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.fullName });
        // ensureFirestoreUserProfile will be called by onAuthStateChanged, pass signup data to it
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
      // setLoading(false); // onAuthStateChanged will handle this
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        toastMessage = `The ${providerName} sign-in popup was closed before completing. Please ensure popups are allowed and try again. If you continue to experience issues, using an incognito window or a different browser might help.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
        toastMessage = `An account already exists with this email using a different sign-in method. Please log in with the original method.`;
    } else if (error.code === 'auth/operation-not-allowed') {
        toastMessage = `${providerName} sign-in is not enabled for this project. Contact support.`;
    } else if (error.code === 'auth/popup-blocked') {
        toastMessage = `The ${providerName} sign-in popup was blocked by your browser. Please allow popups for this site and try again.`;
    }
    
    toast({
        title: toastTitle,
        description: toastMessage,
        variant: "destructive",
        duration: 10000,
    });
    setLoading(false); // Explicitly set loading false here
    setInitialAuthCheckComplete(true); // Ensure this is also true if auth fails
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
      // onAuthStateChanged will handle setting user, profile creation and redirecting
      // Ensure Firestore profile is created/updated immediately after social login is confirmed by Firebase Auth
      await ensureFirestoreUserProfile(result.user);
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShown');
    } catch (error: any) {
      handleSocialLoginError(error, providerName);
    } finally {
      setActiveSocialLoginProvider(null);
      // setLoading(false) is handled by onAuthStateChanged or error handler
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
      router.push(LOGIN_PATH); // Explicit redirect to login after logout
    } catch (error: any) {
      toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally {
      // setLoading(false); // onAuthStateChanged will handle this
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
      throw error; // Let the form handle specific error display
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
      if (data.role !== undefined) updatePayloadFS.role = data.role || "Author"; // Default to Author if role somehow cleared

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (data.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== data.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: data.displayName });
      }
      
      // Crucial: Re-fetch from Firestore to get the absolute latest state
      const updatedUserFromDb = await ensureFirestoreUserProfile(currentFirebaseUser, data);
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Update global state
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        const isNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        setIsProfileComplete(isNowComplete);
        
        toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });
        success = true;

        if (isNowComplete && localStorage.getItem('completingProfile') === 'true') {
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin') || (updatedUserFromDb.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedUserFromDb.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
          localStorage.removeItem('redirectAfterLogin');
          router.push(redirectPath);
        }
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

    } catch (error: any) {
      if (error.message !== "Username already taken. Please choose another one." && error.message !== "Phone number already in use. Please use a different one.") {
         // Already handled by form if specific, else a general toast
      }
      throw error; // Re-throw for the form to catch and display
    } finally {
      setLoading(false);
    }
    return success;
  };

  if (!isMounted) { // Show basic loading if not mounted yet
    return (
        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
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
        <p className="text-sm text-muted-foreground">Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correctly set up and the server has been restarted.</p>
      </div>
    );
  }


  return (
    <AuthContext.Provider
      value={{
        user,
        loading: loading || !initialAuthCheckComplete, // Global loading state
        isAdminUser,
        isProfileComplete,
        initialAuthCheckComplete,
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
