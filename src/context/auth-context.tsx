
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

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com"; // Kept for easy admin testing

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdminUser: boolean;
  isProfileComplete: boolean; // Derived from user object
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
  if (typeof timestamp === 'string') { // If it's already an ISO string or similar
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    // Firestore Timestamp-like object from server (e.g., via serverTimestamp() then fetched)
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  // console.warn("AuthContext: Could not convert timestamp:", timestamp);
  return String(timestamp); // Fallback, should ideally not be hit
};


const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
    return null;
  }
  const uid = firebaseUser.uid;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Omit<User, 'id'> & { createdAt?: any, updatedAt?: any }; // Prepare for serverTimestamp
    const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

      // Prioritize existing Firestore data for core profile fields, update from Auth/signup if explicitly changed
      const newDisplayName = profileDataFromSignup?.displayName || firebaseUser.displayName || existingData.displayName || null;
      const newPhotoURL = firebaseUser.photoURL || existingData.photoURL || null;

      dataToSave = {
        userId: uid,
        email: firebaseUser.email || existingData.email, // Firebase Auth email is source of truth
        displayName: newDisplayName,
        photoURL: newPhotoURL,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        isAdmin: isCreatorAdminByEmail || existingData.isAdmin || false, // Prioritize creator admin, then existing, then false
        isSuspended: existingData.isSuspended || false,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(), // Preserve existing or set new
        updatedAt: serverTimestamp(),
      };
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave, { merge: true });

    } else {
      // New user document
      const determinedIsAdmin = isCreatorAdminByEmail;
      dataToSave = {
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.displayName || firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null, // Will be null after social login initially
        role: profileDataFromSignup?.role || (determinedIsAdmin ? "Admin" : "Author"), // Default role, or Admin if creator
        phoneNumber: profileDataFromSignup?.phoneNumber || null, // Will be null after social login initially
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: determinedIsAdmin,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data for new user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave);
    }

    const finalSnap = await getDoc(userDocRef); // Re-fetch to get server-generated timestamps
    if (finalSnap.exists()) {
      const rawData = { id: finalSnap.id, ...finalSnap.data() } as any;
      const hydratedUser: User = {
        ...rawData,
        createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
        updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
      };
      // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated user ${uid} with data:`, hydratedUser);
      return hydratedUser;
    }
    throw new Error(`User document ${uid} not found after create/update.`);

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}"`, error.code, error);
    toast({ variant: "destructive", title: "Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000});
    return null;
  }
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // True until initial auth check is complete
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [initialAuthCheckComplete, setInitialAuthCheckComplete] = useState(false);
  const [showIncompleteProfileToastShown, setShowIncompleteProfileToastShown] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level


  useEffect(() => {
    setIsMounted(true);
  }, []);


  useEffect(() => {
    // console.log(`AuthContext: Top of main useEffect. Pathname: ${pathname} IsMounted: ${isMounted}`);
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        setLoading(false);
        setInitialAuthCheckComplete(true);
      }
      return;
    }

    const unsubscribe: Unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log(`AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser:`, firebaseUser?.uid || null);
      let appUser: User | null = null;
      const currentWindowPathname = window.location.pathname; // Get freshest pathname
      const currentWindowSearchParams = new URLSearchParams(window.location.search);


      if (firebaseUser) {
        appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);
          const determinedProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(determinedProfileComplete);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${currentWindowPathname}, IsAdmin: ${appUser.isAdmin}, ProfileComplete: ${determinedProfileComplete}`);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);


          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;

          if (redirectAfterLoginPath && (redirectAfterLoginPath.startsWith('/user/profile/settings') || redirectAfterLoginPath === '/profile/settings')) {
            // console.log("AuthContext: Correcting stale redirectAfterLoginPath from", redirectAfterLoginPath);
            redirectAfterLoginPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
            if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', redirectAfterLoginPath);
          }

          // 1. Handle Profile Completion
          if (!determinedProfileComplete) {
            if (currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              // console.log(`AuthContext: Profile incomplete for ${appUser.email}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
              if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            } else if (!showIncompleteProfileToastShown && isMounted) { // Already on profile page, or just landed
              // console.log(`AuthContext: Profile incomplete, already on settings page or just landed. Toast flag: ${showIncompleteProfileToastShown}`);
              // Show toast only once per session if profile is incomplete and they land here or are here.
              if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShownThisSession')) {
                toast({
                    title: "Profile Incomplete",
                    description: "Please complete your username, role, and phone number.",
                    duration: 7000,
                });
                sessionStorage.setItem('incompleteProfileToastShownThisSession', 'true');
              }
            }
          } else { // Profile IS complete
            if (typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true' && (currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
              // console.log(`AuthContext: Profile complete for ${appUser.email}, was on settings page for completion. Clearing flags and redirecting.`);
              if (typeof window !== 'undefined') {
                localStorage.removeItem('completingProfile');
                localStorage.removeItem('redirectAfterLogin'); // Clear this too, as completion flow is done.
              }
              const targetDashboard = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              router.push(redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH ? redirectAfterLoginPath : targetDashboard);
            } else if (redirectAfterLoginPath) {
              // console.log(`AuthContext: Profile complete for ${appUser.email}. Handling redirectAfterLoginPath: ${redirectAfterLoginPath}`);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              router.push(redirectAfterLoginPath);
            } else {
              const onAuthPage = [LOGIN_PATH, SIGNUP_PATH].includes(currentWindowPathname);
              const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(currentWindowPathname) || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');

              if (appUser.isAdmin && onNonAdminEntryPoint && currentWindowPathname !== ADMIN_DASHBOARD_PATH) {
                // console.log(`AuthContext: Admin ${appUser.email} on non-admin entry point or just completed profile. Redirecting to admin dashboard.`);
                router.push(ADMIN_DASHBOARD_PATH);
              } else if (!appUser.isAdmin && onAuthPage) {
                // console.log(`AuthContext: User ${appUser.email} on auth page. Redirecting to user dashboard.`);
                router.push(appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              }
            }
          }
        } else { // appUser is null, ensureFirestoreUserProfile failed
          // console.error("AuthContext: ensureFirestoreUserProfile returned null. User state not set.");
          if (firebaseAuth) await signOut(firebaseAuth); // Log out from Firebase Auth if profile sync fails
          setUser(null);
          setIsAdminUser(false);
          setIsProfileComplete(false);
          if (typeof window !== 'undefined') { // Clear flags on error too
            localStorage.removeItem('redirectAfterLogin');
            localStorage.removeItem('completingProfile');
            sessionStorage.removeItem('incompleteProfileToastShownThisSession');
          }
        }
      } else { // No firebaseUser
        setUser(null);
        setIsAdminUser(false);
        setIsProfileComplete(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
          sessionStorage.removeItem('incompleteProfileToastShownThisSession');
        }
      }
      setInitialAuthCheckComplete(true);
      setLoading(false);
      // console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, pathname, searchParamsFromHook, router]); // router removed as it may cause loops. Pathname for re-eval on nav.


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();
    // console.log(`AuthContext (login): Attempting login with identifier: '${identifier}'`);

    try {
      if (!identifier.includes('@')) {
        // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) {
            emailToLogin = userData.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            // console.error(`AuthContext (login): User document for username '${identifier}' is missing an email.`);
            throw new Error("User record incomplete (missing email for username).");
          }
        } else {
          // console.log(`AuthContext (login): No user found with username '${identifier}'. Will attempt login with identifier as email.`);
          // Let Firebase handle it as an email if no username match
        }
      }
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user state and redirection
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession'); // Reset toast flag on login
    } catch (error: any) {
      let firebaseError = error;
      let errorMessage = "Login failed. Please check your credentials.";
       if (error.code === 'auth/invalid-credential' || error.message.includes("User record incomplete")) {
        errorMessage = "Invalid email/username or password.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      // setLoading(false); // onAuthStateChanged will set loading to false after processing
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Signup service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    // console.log("AuthContext (signup): Attempting signup for email:", data.email);

    try {
      // Uniqueness checks before Firebase Auth user creation
      const usersRef = collection(firestoreDb, "users");
      if (data.username && data.username.trim()) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          // console.warn("AuthContext (signup): Username already taken:", data.username);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (data.phoneNumber && data.phoneNumber.trim()) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
          // console.warn("AuthContext (signup): Phone number already in use:", data.phoneNumber);
          throw new Error("Phone number already in use by another account.");
        }
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.fullName });
        // ensureFirestoreUserProfile will be called by onAuthStateChanged, pass signup data to it
        // Forcing a call here to ensure Firestore doc is created with signup data immediately
        await ensureFirestoreUserProfile(userCredential.user, data);
      }
      // onAuthStateChanged will handle setting user state and redirection
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      toast({ title: "Signup Successful!", description: "Your account has been created." });
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "Email already registered.";
      }
      // console.error("AuthContext (signup): Signup error:", errorMessage, error);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw error; // Re-throw for the form to catch
    } finally {
      // setLoading(false); // onAuthStateChanged will set loading to false
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        toastMessage = `The ${providerName} sign-in popup was closed before completing. Please try again. If popups are blocked, please enable them for this site.`;
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
    setLoading(false); // Ensure loading is false on error
    setInitialAuthCheckComplete(true); // Also ensure this is true
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
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
    } catch (error: any) {
      handleSocialLoginError(error, providerName);
    } finally {
      setActiveSocialLoginProvider(null);
      // setLoading(false); // onAuthStateChanged will handle this after processing
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
      // Redirection to LOGIN_PATH is handled by onAuthStateChanged or ProtectedRoute
      router.push(LOGIN_PATH); // Explicit redirect after logout
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
    // console.log("AuthContext (updateUserProfile): Attempting to update profile for", user.id, "with data:", data);

    try {
      const usersRef = collection(firestoreDb, "users");
      // Uniqueness check for username if it's being changed
      if (data.username && data.username.trim() !== "" && data.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Uniqueness check for phone number if it's being changed
      if (data.phoneNumber && data.phoneNumber.trim() !== "" && data.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use by another account.");
        }
      }

      const updatePayloadFS: Partial<User> & { updatedAt: any } = { updatedAt: serverTimestamp() };
      if (data.displayName !== undefined) updatePayloadFS.displayName = data.displayName?.trim() || null;
      if (data.username !== undefined) updatePayloadFS.username = data.username?.trim() || null;
      if (data.phoneNumber !== undefined) updatePayloadFS.phoneNumber = data.phoneNumber?.trim() || null;
      if (data.institution !== undefined) updatePayloadFS.institution = data.institution?.trim() || null;
      if (data.researcherId !== undefined) updatePayloadFS.researcherId = data.researcherId?.trim() || null;
      if (data.role !== undefined) updatePayloadFS.role = data.role || "Author";

      const userDocRef = doc(firestoreDb, "users", user.id);
      // console.log("AuthContext (updateUserProfile): Updating Firestore with payload:", updatePayloadFS);
      await updateDoc(userDocRef, updatePayloadFS);

      if (data.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== data.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: data.displayName });
      }
      
      // Optimistically update local state and then re-fetch for consistency
      const updatedAppUser = await ensureFirestoreUserProfile(currentFirebaseUser, data); // Pass data to ensure merge logic works as intended

      if (updatedAppUser) {
        setUser(updatedAppUser);
        setIsAdminUser(updatedAppUser.isAdmin === true);
        const isNowComplete = !!(updatedAppUser.username && updatedAppUser.role && updatedAppUser.phoneNumber);
        setIsProfileComplete(isNowComplete);
        // console.log("AuthContext (updateUserProfile): Profile updated. IsNowComplete:", isNowComplete);

        success = true;
        toast({ title: "Success", description: "Your profile has been updated." });

        if (isNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
            // console.log("AuthContext (updateUserProfile): Profile now complete, redirecting from settings.");
            if (typeof window !== 'undefined') {
                localStorage.removeItem('completingProfile');
                const redirectPath = localStorage.getItem('redirectAfterLogin');
                localStorage.removeItem('redirectAfterLogin');
                const targetDashboard = updatedAppUser.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedAppUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
                router.push(redirectPath && redirectPath !== AUTHOR_PROFILE_SETTINGS_PATH && !redirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH+'?') ? redirectPath : targetDashboard);
            }
        }
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

    } catch (error: any) {
      // console.error("AuthContext (updateUserProfile): Error updating profile:", error.message, error);
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error; 
    } finally {
      setLoading(false);
    }
    return success;
  };

  // Initial loading screen logic
  if (!isMounted || (!initialAuthCheckComplete && loading)) {
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
        <p className="text-muted-foreground mb-1">Crucial Firebase services are not available.</p>
        <p className="text-sm text-muted-foreground">Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correctly set up.</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading, // Combined loading state
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
