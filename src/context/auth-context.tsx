
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
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, collection, updateDoc } from 'firebase/firestore';
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
const MOCK_ADMIN_EMAIL = "admin@example.com";

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
  showIncompleteProfileToast: () => void;
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
  return String(timestamp);
};

// This function now aims to be the single source of truth for getting/creating Firestore user profile
export const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignupOrUpdate?: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>,
  isUpdatingProfile: boolean = false // Flag to differentiate login/fetch from explicit update
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
    return null;
  }
  const uid = firebaseUser.uid;
  const userDocRef = doc(firestoreDb, "users", uid);
  const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Omit<User, 'id'> & { createdAt?: any, updatedAt?: any };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

      let determinedRole = existingData.role;
      if (isUpdatingProfile && profileDataFromSignupOrUpdate?.role !== undefined) {
        determinedRole = profileDataFromSignupOrUpdate.role;
      } else if (!existingData.role && !isUpdatingProfile) { // Existing doc but no role, set a default during login/fetch
        determinedRole = isAdminByEmail ? "Admin" : "Author";
      }
      // console.log(`AuthContext (ensureFirestoreUserProfile): Determined role for ${uid}: ${determinedRole} (from existing: ${existingData.role}, from update: ${profileDataFromSignupOrUpdate?.role}, isAdminByEmail: ${isAdminByEmail})`);


      let determinedIsAdmin = existingData.isAdmin || false;
      if (isAdminByEmail) {
        determinedIsAdmin = true;
      } else if (isUpdatingProfile && profileDataFromSignupOrUpdate && 'isAdmin' in profileDataFromSignupOrUpdate) {
        determinedIsAdmin = existingData.isAdmin || false; // Users cannot make themselves admin via profile update form
      }

      dataToSave = {
        userId: uid,
        email: firebaseUser.email || existingData.email, // Prioritize fresh email from Firebase Auth
        displayName: profileDataFromSignupOrUpdate?.displayName !== undefined ? profileDataFromSignupOrUpdate.displayName : (firebaseUser.displayName || existingData.displayName || null),
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        username: isUpdatingProfile && profileDataFromSignupOrUpdate?.username !== undefined ? (profileDataFromSignupOrUpdate.username || null) : (existingData.username || null),
        role: determinedRole,
        phoneNumber: isUpdatingProfile && profileDataFromSignupOrUpdate?.phoneNumber !== undefined ? (profileDataFromSignupOrUpdate.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: isUpdatingProfile && profileDataFromSignupOrUpdate?.institution !== undefined ? (profileDataFromSignupOrUpdate.institution || null) : (existingData.institution || null),
        researcherId: isUpdatingProfile && profileDataFromSignupOrUpdate?.researcherId !== undefined ? (profileDataFromSignupOrUpdate.researcherId || null) : (existingData.researcherId || null),
        isAdmin: determinedIsAdmin,
        isSuspended: existingData.isSuspended || false,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave, { merge: true });

    } else { // New user document
      const newRole = isAdminByEmail ? "Admin" : (profileDataFromSignupOrUpdate?.role || "Author");
      // console.log(`AuthContext (ensureFirestoreUserProfile): Creating new profile for ${uid}. Role from signup: ${profileDataFromSignupOrUpdate?.role}, isAdminByEmail: ${isAdminByEmail}, final role: ${newRole}`);
      dataToSave = {
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignupOrUpdate?.displayName || firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignupOrUpdate?.username || null, // From signup form
        role: newRole,
        phoneNumber: profileDataFromSignupOrUpdate?.phoneNumber || null, // From signup form
        institution: profileDataFromSignupOrUpdate?.institution || null,
        researcherId: profileDataFromSignupOrUpdate?.researcherId || null,
        isAdmin: isAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data to create for new user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave);
    }

    const finalSnap = await getDoc(userDocRef);
    if (finalSnap.exists()) {
      const rawData = { id: finalSnap.id, ...finalSnap.data() } as any;
      const hydratedUser: User = {
        ...rawData,
        createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
        updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
      };
      // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated user ${uid} with role: ${hydratedUser.role}`, hydratedUser);
      return hydratedUser;
    }
    throw new Error(`User document ${uid} not found after create/update.`);

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}"`, error.code, error);
    if (error.code === 'permission-denied') {
      toast({ variant: "destructive", title: "Firestore Permission Error", description: `Could not access your profile data. Please check Firestore rules or contact support. Details: ${error.message}`, duration: 10000 });
    } else {
      toast({ variant: "destructive", title: "Profile Sync Error", description: `Could not save or update your profile in our database. Details: ${error.message}`, duration: 10000 });
    }
    return null;
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
  const [hasShownIncompleteProfileToast, setHasShownIncompleteProfileToast] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const showIncompleteProfileToast = useCallback(() => {
    if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShownThisSession')) {
      toast({
        title: "Profile Incomplete",
        description: "Your profile is missing some details (like username or phone number). Please visit Profile Settings to update it.",
        duration: 7000,
      });
      sessionStorage.setItem('incompleteProfileToastShownThisSession', 'true');
      setHasShownIncompleteProfileToast(true);
    }
  }, [toast]);


  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        setLoading(false);
        setInitialAuthCheckComplete(true);
      }
      return;
    }
    // console.log("AuthContext: Top of main useEffect. Pathname:", pathname, "IsMounted:", isMounted);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser:", firebaseUser?.uid);
      setLoading(true); // Set loading true at the start of auth state processing

      const currentWindowPathname = window.location.pathname; // Get freshest pathname
      const currentWindowSearch = window.location.search;

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          const determinedProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(determinedProfileComplete);

          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${currentWindowPathname}, IsAdmin: ${determinedIsAdmin}, ProfileComplete: ${determinedProfileComplete}`);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);


          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          let completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

          if (redirectAfterLoginPath) {
            if (redirectAfterLoginPath.startsWith('/user/profile/settings') || redirectAfterLoginPath.startsWith('/profile/settings')) {
              redirectAfterLoginPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
              // console.log("AuthContext: Corrected redirectAfterLoginPath to:", redirectAfterLoginPath);
              if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', redirectAfterLoginPath);
            }
          }
          
          if (!determinedProfileComplete && currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            // console.log(`AuthContext: Profile incomplete for ${appUser.email}. Current path: ${currentWindowPathname}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (determinedProfileComplete && completingProfileStorageFlag && (currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
            // console.log(`AuthContext: Profile complete for ${appUser.email}, was on settings for completion. Redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath && (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectAfterLoginPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null; 
              }
            }
            const targetDashboard = determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath || targetDashboard);
          } else if (redirectAfterLoginPath) {
            // console.log(`AuthContext: Handling redirectAfterLoginPath: ${redirectAfterLoginPath} for ${appUser.email}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            router.push(redirectAfterLoginPath);
          } else {
            const onAuthPage = [LOGIN_PATH, SIGNUP_PATH].includes(currentWindowPathname);
            const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(currentWindowPathname) || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');

            if (determinedIsAdmin && onNonAdminEntryPoint && currentWindowPathname !== ADMIN_DASHBOARD_PATH && !currentWindowPathname.startsWith('/admin/')) {
              // console.log(`AuthContext: Admin ${appUser.email} on non-admin entry point. Redirecting to admin dashboard.`);
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!determinedIsAdmin && onAuthPage) {
              // console.log(`AuthContext: User ${appUser.email} on auth page. Redirecting to user dashboard.`);
              const targetDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(targetDashboard);
            }
            // If none of the above, user is logged in, profile complete, on a valid page, so no redirect.
          }
        } else { // appUser is null from ensureFirestoreUserProfile (Firestore error)
          // console.error("AuthContext: Failed to fetch or create user profile in Firestore. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); // Sign out from Firebase Auth
          setUser(null);
          setIsAdminUser(false);
          setIsProfileComplete(false);
          if (typeof window !== 'undefined') {
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
          // Keep redirectAfterLogin if user was trying to access a page and got logged out,
          // so they can be redirected after next login.
          // localStorage.removeItem('redirectAfterLogin'); // Only remove if actively logging out.
          localStorage.removeItem('completingProfile');
          sessionStorage.removeItem('incompleteProfileToastShownThisSession');
        }
      }
      setInitialAuthCheckComplete(true);
      setLoading(false);
      // console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
    });

    return () => unsubscribe();
  }, [isMounted, pathname, searchParamsFromHook, router, showIncompleteProfileToast]); // Added showIncompleteProfileToast

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();
    let firebaseError = null;
    let errorMessage = "Login failed. Please check your credentials.";

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
            errorMessage = "User record incomplete (missing email for username).";
            // console.warn(`AuthContext (login): User record for username '${identifier}' is incomplete (missing email).`);
            throw new Error(errorMessage);
          }
        } else {
          // console.log(`AuthContext (login): No email found for username '${identifier}'. Will attempt login with identifier as email.`);
          // Proceed to try identifier as email if no username match
        }
      }
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false);
      setHasShownIncompleteProfileToast(false); // Reset toast flag on successful login
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      // onAuthStateChanged will handle setting user and redirection
    } catch (error: any) {
      firebaseError = error;
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        errorMessage = "Invalid email/username or password.";
      } else if (error.message && error.message.includes("User record incomplete")) {
        // Already set
      } else if (error.message) {
        // Keep generic for other Firebase errors for now
      }
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Signup service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);

    try {
      // Check username uniqueness
      if (data.username && data.username.trim()) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          toast({ variant: "destructive", title: "Signup Failed", description: "Username already taken. Please choose another one." });
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Check phone number uniqueness
      if (data.phoneNumber && data.phoneNumber.trim()) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
          toast({ variant: "destructive", title: "Signup Failed", description: "Phone number already in use by another account." });
          throw new Error("Phone number already in use by another account.");
        }
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.fullName });
        await ensureFirestoreUserProfile(userCredential.user, data); // Pass signup data
      }
      setShowLoginModal(false);
      setHasShownIncompleteProfileToast(false); // Reset toast flag
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      // onAuthStateChanged will handle setting user and redirection based on profile completeness
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "Email already registered.";
        toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      } else if (error.message === "Username already taken. Please choose another one." || error.message === "Phone number already in use by another account.") {
        // Already handled by toast above
      } else {
        toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    // setLoading(false); // onAuthStateChanged might still be processing or will set it.
    // setInitialAuthCheckComplete(true); // Ensure app doesn't hang
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || `An unexpected error occurred during ${providerName} sign-in.`;

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        toastMessage = `The ${providerName} sign-in popup was closed. If popups are blocked, please allow them for this site and try again.`;
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
      setShowLoginModal(false);
      setHasShownIncompleteProfileToast(false); // Reset toast flag
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      // onAuthStateChanged will handle profile creation/fetch and redirection
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      setActiveSocialLoginProvider(null);
      // setLoading(false); // Managed by onAuthStateChanged
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    const redirectPath = LOGIN_PATH; // Always redirect to login after logout
    try {
      await signOut(firebaseAuth);
      setUser(null); // Explicitly clear user state immediately
      setIsAdminUser(false);
      setIsProfileComplete(false);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
        sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      }
      setHasShownIncompleteProfileToast(false);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push(redirectPath);
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
    updatedData: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>
  ): Promise<boolean> => {
    const currentFirebaseUser = firebaseAuth?.currentUser;
    if (!currentFirebaseUser || !user || !user.id || !firestoreDb) {
      toast({ variant: "destructive", title: "Authentication Error", description: "User not authenticated. Please log in again." });
      throw new Error("User not authenticated for profile update.");
    }
    setLoading(true);
    let success = false;

    try {
      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          toast({ variant: "destructive", title: "Update Failed", description: "Username already taken. Please choose another one."});
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          toast({ variant: "destructive", title: "Update Failed", description: "Phone number already in use. Please use a different one."});
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const updatePayloadFS: any = { updatedAt: serverTimestamp() };
      if (updatedData.displayName !== undefined) updatePayloadFS.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || "Author";
      // isAdmin cannot be updated by user from here

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: updatedData.displayName });
      }
      
      // Re-fetch profile from Firestore to ensure local state is identical to DB
      const updatedUserFromDb = await ensureFirestoreUserProfile(currentFirebaseUser, updatedData, true);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); 
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        const isNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        setIsProfileComplete(isNowComplete);
        
        success = true;
        toast({ title: "Success", description: "Your profile has been updated." });

        if (isNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
          // console.log("AuthContext (updateUserProfile): Profile now complete, was in completing flow. Redirecting.");
          let redirectPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            localStorage.removeItem('redirectAfterLogin');
          }
          if (redirectPath && (redirectPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
            redirectPath = null; 
          }
          const targetDashboard = updatedUserFromDb.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedUserFromDb.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
          router.push(redirectPath || targetDashboard);
        }
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

    } catch (error: any) {
       if (error.message !== "Username already taken. Please choose another one." && error.message !== "Phone number already in use. Please use a different one.") {
         // Specific errors already toasted
       }
      throw error; 
    } finally {
      setLoading(false);
    }
    return success;
  };

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
         <p className="text-muted-foreground mb-1">Firebase services (Auth or Firestore) are not available.</p>
         <p className="text-sm text-muted-foreground">Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correctly set up and the development server has been restarted.</p>
         <p className="text-xs text-muted-foreground mt-2">If this is a Vercel deployment, check your project's Environment Variables settings.</p>
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
        showIncompleteProfileToast
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

    