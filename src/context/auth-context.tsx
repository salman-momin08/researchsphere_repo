
"use client";

import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation'; // useSearchParams aliased
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
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, updateDoc, collection, runTransaction } from 'firebase/firestore';
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
const FORGOT_PASSWORD_PATH = '/forgot-password'; // Added for consistency

const PUBLIC_PATHS_PATTERNS = [
  HOME_PATH, LOGIN_PATH, SIGNUP_PATH, FORGOT_PASSWORD_PATH,
  /^\/registration$/, /^\/key-committee$/, /^\/sample-templates$/,
  /^\/contact-us$/, /^\/search-papers$/, /^\/terms$/, /^\/privacy$/
];

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com"; // Kept for existing logic, can be phased out

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdminUser: boolean; // Renamed for clarity from just 'isAdmin'
  isProfileComplete: boolean;
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
  // console.warn("AuthContext (convertFirestoreTimestampToISO): Could not convert timestamp, returning as string:", timestamp);
  return String(timestamp);
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
    let dataToSave: Partial<User> = {};
    const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

      dataToSave = {
        ...existingData, // Start with existing data
        id: uid, // Ensure these are always present
        userId: uid,
        email: firebaseUser.email || existingData.email, // Update if Firebase Auth email changed
        displayName: profileDataFromSignup?.displayName || firebaseUser.displayName || existingData.displayName || null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        updatedAt: serverTimestamp(),
        // Only update these if profileDataFromSignup provides them (during profile completion)
        // Otherwise, preserve existing values from Firestore
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? (profileDataFromSignup.role || "Author") : (existingData.role || "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        // isAdmin status is critical. Prioritize existing Firestore value unless it's an admin-creator email.
        isAdmin: isCreatorAdminByEmail || (existingData.isAdmin === true),
      };
    } else { // New user document
      // console.log(`AuthContext (ensureFirestoreUserProfile): Creating new Firestore profile for ${uid}. Signup data:`, profileDataFromSignup);
      dataToSave = {
        id: uid,
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.displayName || firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: isCreatorAdminByEmail ? "Admin" : (profileDataFromSignup?.role || "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for ${uid}:`, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true });
    const finalSnap = await getDoc(userDocRef); // Re-fetch for server timestamps

    if (finalSnap.exists()) {
      const rawData = { id: finalSnap.id, ...finalSnap.data() } as any;
      const hydratedUser = {
        ...rawData,
        createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
        updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
      } as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated user ${uid} with data:`, hydratedUser);
      return hydratedUser;
    }
    throw new Error(`User document ${uid} not found after create/update.`);

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}:`, error.message, error.code, error);
    toast({
      variant: "destructive",
      title: `Profile Sync Error (${error.code})`,
      description: `Could not save or update your profile in our database. Please try logging out and in again. If the problem persists, contact support. Details: ${error.message}`,
      duration: 10000
    });
    return null;
  }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // Start true
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // From Next.js
  const { toast } = useToast();


  useEffect(() => {
    setIsMounted(true);
  }, []);


  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
        if (isMounted && (!firebaseAuth || !firestoreDb)) {
            setLoading(false); // Stop loading if Firebase isn't available
        }
        return;
    }
    // console.log("AuthContext: Main useEffect triggered. Pathname:", pathname);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
        // console.log("AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser:", firebaseUser ? firebaseUser.uid : 'null');
        setLoading(true); // Set loading true at the start of auth state processing
        const currentPathname = window.location.pathname; // Get freshest pathname
        const currentSearchParams = new URLSearchParams(window.location.search);

        if (firebaseUser) {
            const appUser = await ensureFirestoreUserProfile(firebaseUser);

            if (appUser) {
                setUser(appUser);
                const determinedIsAdmin = appUser.isAdmin === true;
                setIsAdminUser(determinedIsAdmin);
                const currentIsProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
                setIsProfileComplete(currentIsProfileComplete);

                // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${currentPathname}, IsAdmin: ${determinedIsAdmin}, ProfileComplete: ${currentIsProfileComplete}`);
                // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);

                let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
                const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

                if (!currentIsProfileComplete) {
                    if (currentPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                        // console.log(`AuthContext: Profile incomplete for ${appUser.email}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
                        if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
                        router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
                        setLoading(false);
                        return;
                    }
                } else { // Profile IS complete
                    if (completingProfileStorageFlag && (currentPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
                        // console.log(`AuthContext: Profile complete for ${appUser.email}, was on settings page. Clearing flags and redirecting.`);
                        if (typeof window !== 'undefined') {
                            localStorage.removeItem('completingProfile');
                            localStorage.removeItem('redirectAfterLogin'); // Clear this too, as the "completion" redirect takes precedence
                        }
                        const targetDashboard = determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
                        router.push(redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH && !redirectAfterLoginPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH+'?') ? redirectAfterLoginPath : targetDashboard);
                        setLoading(false);
                        return;
                    }
                    if (redirectAfterLoginPath) {
                        if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
                        // Correct old /user/ paths if found, especially for profile settings
                        if ((redirectAfterLoginPath.startsWith('/user/profile/settings') || redirectAfterLoginPath.startsWith('/profile/settings')) && !currentIsProfileComplete) {
                             router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
                        } else if (redirectAfterLoginPath.startsWith('/user/profile/settings') || redirectAfterLoginPath.startsWith('/profile/settings')){
                             router.push(determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
                        } else {
                             router.push(redirectAfterLoginPath);
                        }
                        setLoading(false);
                        return;
                    }
                    // Default redirection for already logged-in and complete profile users
                    if (determinedIsAdmin && (currentPathname === HOME_PATH || currentPathname === LOGIN_PATH || currentPathname === SIGNUP_PATH || currentPathname === AUTHOR_PROFILE_SETTINGS_PATH) && currentPathname !== ADMIN_DASHBOARD_PATH) {
                        // console.log(`AuthContext: Admin ${appUser.email} on entry page, redirecting to admin dashboard.`);
                        router.push(ADMIN_DASHBOARD_PATH);
                        setLoading(false);
                        return;
                    } else if (!determinedIsAdmin && (currentPathname === LOGIN_PATH || currentPathname === SIGNUP_PATH)) {
                        // console.log(`AuthContext: User ${appUser.email} on auth page, redirecting to their dashboard.`);
                        router.push(appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
                        setLoading(false);
                        return;
                    }
                }
            } else { // ensureFirestoreUserProfile returned null
                console.error("AuthContext: Failed to fetch or create user profile in Firestore after Firebase Auth. Logging out Firebase user.");
                if (firebaseAuth) await signOut(firebaseAuth);
                setUser(null);
                setIsAdminUser(false);
                setIsProfileComplete(false);
                if (typeof window !== 'undefined') {
                  localStorage.removeItem('completingProfile');
                  localStorage.removeItem('redirectAfterLogin');
                }
            }
        } else { // No firebaseUser
            setUser(null);
            setIsAdminUser(false);
            setIsProfileComplete(false);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              // Do not remove redirectAfterLogin here if user is not logged in yet
            }
        }
        setLoading(false);
        // console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
    });

    return () => unsubscribe();
  }, [isMounted, firebaseAuth, firestoreDb, router, pathname, searchParamsFromHook]); // Added searchParamsFromHook here


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();
    let firebaseError = null;

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
            throw new Error("User record incomplete (missing email for username).");
          }
        } else {
          // console.log(`AuthContext (login): No email found for username '${identifier}'. Proceeding with identifier as email.`);
        }
      }
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle success: fetching profile, setting state, and redirecting.
      setShowLoginModal(false);
    } catch (error: any) {
      firebaseError = error;
      let errorMessage = error.code === 'auth/invalid-credential' || error.message.includes("User record incomplete") ? "Invalid email/username or password." : (error.message || "Login failed.");
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available."});
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      // Client-side uniqueness checks before Firebase user creation
      if (data.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) throw new Error("Username already taken. Please choose another one.");
      }
      if (data.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) throw new Error("Phone number already in use by another account.");
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        // Pass signup data to create initial Firestore profile correctly
        // ensureFirestoreUserProfile will be called by onAuthStateChanged, but we pass data to it
        // No, we must create it here, then onAuthStateChanged will fetch it.
        await ensureFirestoreUserProfile(userCredential.user, data); // This will create the Firestore doc
        if (data.displayName) {
          await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.displayName });
        }
      }
      // onAuthStateChanged will handle fetching profile, setting state, and redirecting (likely to profile completion).
      setShowLoginModal(false);
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') errorMessage = "Email already registered.";
      // console.error("AuthContext (signup): Signup error:", errorMessage, error);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null); // Reset the specific provider loading state
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        toastMessage = `The ${providerName} sign-in popup was closed before completing. Please ensure popups are allowed for this site and try again. If the issue persists, you might try a different browser or check your browser's popup blocker settings.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
        toastMessage = `An account already exists with this email using a different sign-in method. Please log in with the original method.`;
    } else if (error.code === 'auth/operation-not-allowed') {
        toastMessage = `${providerName} sign-in is not enabled for this project. Please contact support.`;
    } else if (error.code === 'auth/popup-blocked') {
        toastMessage = `The ${providerName} sign-in popup was blocked by your browser. Please allow popups for this site and try again.`;
    }

    // console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, error.code, error.message, error);
    toast({
        title: toastTitle,
        description: toastMessage,
        variant: "destructive",
        duration: 10000,
    });
    setLoading(false); // Ensure global loading is also reset
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
      // onAuthStateChanged will handle setting user, profile creation/fetching, and redirecting.
      setShowLoginModal(false);
    } catch (error: any) { // Added type annotation
      handleSocialLoginError(error, providerName);
    } finally {
      setActiveSocialLoginProvider(null); // This will be reset here and also after onAuthStateChanged
      // setLoading(false); // setLoading(false) will be handled by onAuthStateChanged
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    const currentPath = window.location.pathname;
    try {
      await signOut(firebaseAuth);
      // User state (user, isAdminUser, isProfileComplete) is cleared by onAuthStateChanged
      if (typeof window !== "undefined") {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      // Only redirect if not already on a public page to avoid unnecessary redirects
      const isPublicPage = PUBLIC_PATHS_PATTERNS.some(pattern =>
        typeof pattern === 'string' ? pattern === currentPath : pattern.test(currentPath)
      );
      if (!isPublicPage) {
        router.push(LOGIN_PATH);
      }
    } catch (error: any) {
      // console.error("AuthContext (logout): Logout error:", error.message, error);
      toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (emailForReset: string) => {
    if (!firebaseAuth) {
        toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available."});
        throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      await firebaseSendPasswordResetEmail(firebaseAuth, emailForReset);
    } catch (error: any) {
      // console.error("AuthContext (sendPasswordResetEmail): Error:", error.message, error);
      throw error; // Re-throw to be caught by the form
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (
    data: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>
  ): Promise<boolean> => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      toast({variant: "destructive", title: "Authentication Error", description: "User not authenticated. Please log in again."});
      throw new Error("User not authenticated for profile update.");
    }
    setLoading(true);
    const currentFirebaseUser = firebaseAuth.currentUser;
    let success = false;

    try {
      const usersRef = collection(firestoreDb, "users");
      // Check username uniqueness if username is being changed to a new, non-empty value
      if (data.username && data.username.trim() !== "" && data.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Check phone number uniqueness if phone number is being changed to a new, non-empty value
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
      if (data.role !== undefined) updatePayloadFS.role = data.role || "Author"; // Default to Author if role is being set to empty

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (data.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== data.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: data.displayName });
      }

      // Crucially, re-fetch profile from Firestore to get the absolute source of truth after update
      const updatedAppUser = await ensureFirestoreUserProfile(currentFirebaseUser, data as SignupFormValues); // Use currentFirebaseUser as it won't have changed

      if (updatedAppUser) {
        setUser(updatedAppUser); // Optimistically update local state
        setIsAdminUser(updatedAppUser.isAdmin === true);
        const isNowComplete = !!(updatedAppUser.username && updatedAppUser.role && updatedAppUser.phoneNumber);
        setIsProfileComplete(isNowComplete); // Update global profile complete state

        toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });

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
        success = true;
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }
    } catch (error: any) {
      // console.error("AuthContext (updateUserProfile): Error updating profile:", error.message, error);
      // Error message already handled by specific uniqueness checks or general error
      if (error.message !== "Username already taken. Please choose another one." && error.message !== "Phone number already in use. Please use a different one.") {
        toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      }
      throw error; // Re-throw for the form to catch
    } finally {
      setLoading(false);
    }
    return success;
  };


  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser)) { // Show global loading only if not mounted or truly in initial auth check
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
        isProfileComplete,
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
