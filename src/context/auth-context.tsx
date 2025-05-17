
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
  updateProfile as firebaseUpdateProfile,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, collection, updateDoc } from 'firebase/firestore';
import { auth as firebaseAuth, db as firestoreDb } from '@/lib/firebase'; // Corrected import path
import type { SignupFormValues } from '@/components/auth/SignupForm';
import type { User } from '@/types';
import { useToast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/shared/LoadingSpinner'; // Added missing import

export const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com"; // For direct admin login testing

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
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
    if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  return String(timestamp);
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [justCompletedProfile, setJustCompletedProfile] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Call hook at top level
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const ensureFirestoreUserProfile = useCallback(async (
    firebaseUser: FirebaseUser,
    profileDataFromSignup?: Partial<SignupFormValues> & { isSocial?: boolean }
  ): Promise<User | null> => {
    if (!firestoreDb) {
      console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
      toast({ variant: "destructive", title: "Database Error", description: "User profile database is not accessible." });
      return null;
    }

    const uid = firebaseUser.uid;
    const userDocRef = doc(firestoreDb, "users", uid);

    try {
      const userSnap = await getDoc(userDocRef);
      let dataToSave: Partial<User>; // Use Partial<User> for flexibility
      let finalUserData: User;

      const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

      if (userSnap.exists()) {
        const existingData = userSnap.data() as User; // Assume User type for existing data
        // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

        dataToSave = {
          userId: uid,
          email: firebaseUser.email || existingData.email || null,
          displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
          photoURL: firebaseUser.photoURL || existingData.photoURL || null,
          // Prioritize existing data for these fields unless actively being updated by profileDataFromSignup
          username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
          role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author")),
          phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
          institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
          researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
          isAdmin: isCreatorAdminByEmail || existingData.isAdmin === true, // isCreatorAdminByEmail takes precedence
          isSuspended: existingData.isSuspended || false,
          createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt))) : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        // console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToSave);
        await setDoc(userDocRef, dataToSave, { merge: true });
      } else {
        // console.log(`AuthContext (ensureFirestoreUserProfile): No existing profile for ${uid}. Creating new one.`);
        dataToSave = {
          userId: uid,
          email: firebaseUser.email,
          displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || null,
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
        // console.log(`AuthContext (ensureFirestoreUserProfile): Data for new user ${uid}:`, dataToSave);
        await setDoc(userDocRef, dataToSave);
      }

      const finalSnap = await getDoc(userDocRef);
      if (finalSnap.exists()) {
        const rawData = { id: finalSnap.id, ...finalSnap.data() };
        finalUserData = {
          ...rawData,
          createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
          updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
        } as User;
        // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated user ${uid} with data:`, finalUserData);
        return finalUserData;
      } else {
        throw new Error("User document not found after create/update operation.");
      }
    } catch (error: any) {
      console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}:`, error.message, error.code, error);
      toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
      return null;
    }
  }, [toast]);


  useEffect(() => {
    // console.log(`AuthContext: Top of main useEffect. Pathname: ${pathname} IsMounted: ${isMounted}`);
    if (!isMounted || !firebaseAuth) {
      if (!firebaseAuth && isMounted) setLoading(false);
      return;
    }

    if (justCompletedProfile) {
      // console.log("AuthContext: justCompletedProfile is true, resetting and returning early from main useEffect.");
      setJustCompletedProfile(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log(`AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser: ${firebaseUser?.uid}`);
      setLoading(true);

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          // console.log(`AuthContext (onAuthStateChanged for ${firebaseUser.email}): appUser hydrated:`, appUser);
          // console.log(`AuthContext (onAuthStateChanged for ${firebaseUser.email}): Determined isAdmin: ${determinedIsAdmin}`);


          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

          // console.log(`AuthContext (onAuthStateChanged for ${firebaseUser.email}): Pathname: ${pathname}, IsAdmin: ${determinedIsAdmin}, ProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}`);
          // console.log(`AuthContext (onAuthStateChanged for ${firebaseUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);


          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            // console.log(`AuthContext: Profile incomplete for ${firebaseUser.email}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            // console.log(`AuthContext: Profile complete for ${firebaseUser.email} and on settings page for completion. Redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin'); // Re-check after removing completingProfile
              localStorage.removeItem('redirectAfterLogin');
            }
            const target = redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH
              ? redirectAfterLoginPath
              : (determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
            // console.log(`AuthContext: Redirecting to ${target} after profile completion.`);
            router.push(target);
          } else if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            // Correct stale paths from /user/ to /author/
            if (redirectAfterLoginPath.startsWith('/user/')) {
              redirectAfterLoginPath = redirectAfterLoginPath.replace('/user/', '/author/');
            }
            // console.log(`AuthContext: Using redirectAfterLoginPath: ${redirectAfterLoginPath} for ${firebaseUser.email}.`);
            router.push(redirectAfterLoginPath);
          } else {
            const onAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH;
            const onNonAdminEntryPoint = onAuthPage || pathname === HOME_PATH || pathname === AUTHOR_PROFILE_SETTINGS_PATH;

            if (determinedIsAdmin && onNonAdminEntryPoint && pathname !== ADMIN_DASHBOARD_PATH) {
              // console.log(`AuthContext: Admin ${firebaseUser.email} on entry point, redirecting to admin dashboard.`);
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!determinedIsAdmin && onAuthPage) {
              const userDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              // console.log(`AuthContext: Non-admin ${firebaseUser.email} on auth page, redirecting to ${userDashboard}.`);
              router.push(userDashboard);
            }
          }
        } else { // appUser is null - ensureFirestoreUserProfile failed
          console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Firebase Auth user exists but profile sync failed. Logging out.");
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('redirectAfterLogin');
            localStorage.removeItem('completingProfile');
          }
        }
      } else { // firebaseUser is null
        // console.log("AuthContext (onAuthStateChanged): No Firebase user. Clearing state.");
        setUser(null);
        setIsAdminUser(false);
        const isProtectedRoute = pathname.startsWith('/author/') || pathname.startsWith('/reviewer/') || pathname.startsWith('/admin/');
        const isAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH || pathname === '/forgot-password';
        if (isProtectedRoute && !isAuthPage && typeof window !== 'undefined') {
          localStorage.setItem('redirectAfterLogin', pathname);
          setShowLoginModal(true);
        }
         if (typeof window !== 'undefined') {
          // Keep completingProfile flag if they were in the middle of it and got signed out somehow
          // localStorage.removeItem('completingProfile'); 
         }
      }
      // console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook, ensureFirestoreUserProfile, toast, justCompletedProfile]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Auth service not available.");
    setLoading(true);
    let emailToLogin = identifier.trim();
    let firebaseError = null;

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
            // console.error(`AuthContext (login): Username '${identifier}' found but no associated email.`);
            throw new Error("Invalid email/username or password.");
          }
        } else {
          // console.warn(`AuthContext (login): Username '${identifier}' not found in Firestore.`);
          throw new Error("Invalid email/username or password.");
        }
      }
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful", description: "Welcome back!" });
      setShowLoginModal(false); // Close modal on success
      // onAuthStateChanged will handle profile fetching and redirection
    } catch (error: any) {
      firebaseError = error;
      const errorMessage = error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'
        ? "Invalid email/username or password."
        : (error.message || "Login failed. Please try again.");
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Auth service not available.");
    setLoading(true);
    // console.log("AuthContext (signup): Attempting signup with data:", data);
    try {
      // Username uniqueness check (client-side before Firebase Auth creation)
      const usersRef = collection(firestoreDb, "users");
      if (data.username && data.username.trim() !== "") {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          // console.warn("AuthContext (signup): Username already taken:", data.username);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Phone number uniqueness check
      if (data.phoneNumber && data.phoneNumber.trim() !== "") {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
          // console.warn("AuthContext (signup): Phone number already in use:", data.phoneNumber);
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      // console.log("AuthContext (signup): Firebase user created:", userCredential.user.uid);
      if (userCredential.user && data.fullName) {
        await firebaseUpdateProfile(userCredential.user, { displayName: data.fullName });
      }
      // ensureFirestoreUserProfile will be called by onAuthStateChanged,
      // but call it explicitly here to pass signup form data for new profile.
      await ensureFirestoreUserProfile(userCredential.user, data);
      toast({ title: "Account Created!", description: "Welcome! Please complete your profile if prompted." });
      // onAuthStateChanged will handle redirection
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed. Please try again.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "This email is already registered. Please try logging in.";
      }
      // console.error("AuthContext (signup): Signup error:", errorMessage, error);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user') {
      toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again. If the issue persists, another browser extension might be interfering.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method. Please sign in with the original method.`;
    } else if (error.code === 'auth/cancelled-popup-request') {
      toastMessage = `The sign-in popup request was cancelled. If you have multiple popups open, please close them and try again.`;
    }
    // console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, toastMessage, error);
    toast({
      title: toastTitle,
      description: toastMessage,
      variant: "destructive",
      duration: 10000,
    });
    setActiveSocialLoginProvider(null);
    setLoading(false); // Ensure loading is reset on social login error
  };

  const processSocialLogin = async (providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Error", description: "Authentication service is not available." });
      setLoading(false);
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    const providerInstance = providerName === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting
      setShowLoginModal(false); // Close modal on successful initiation
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      // setLoading(false) and setActiveSocialLoginProvider(null) are handled by onAuthStateChanged or error handler
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    // console.log("AuthContext (logout): Attempting logout.");
    try {
      await signOut(firebaseAuth);
      setUser(null);
      setIsAdminUser(false);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      router.push(LOGIN_PATH);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error: any) {
      // console.error("AuthContext (logout): Logout error:", error.message, error);
      toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (emailForReset: string) => {
    if (!firebaseAuth) throw new Error("Auth service not available.");
    setLoading(true);
    try {
      await firebaseSendPasswordResetEmail(firebaseAuth, emailForReset);
      toast({ title: "Password Reset Email Sent", description: "If an account exists for this email, a reset link has been sent." });
    } catch (error: any) {
      // console.error("AuthContext (sendPasswordResetEmail): Error:", error.message, error);
      toast({ variant: "destructive", title: "Error Sending Reset Email", description: error.message || "Could not send password reset email." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      throw new Error("User not authenticated or database service unavailable.");
    }
    setLoading(true);
    // console.log("AuthContext (updateUserProfile): Attempting update for user:", user.id, "with data:", updatedData);

    try {
      const currentFirebaseUser = firebaseAuth.currentUser;
      const userDocRef = doc(firestoreDb, "users", user.id);

      // Uniqueness checks before attempting update
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", updatedData.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const updatePayloadFS: Partial<User> = {};
      if (updatedData.displayName !== undefined) updatePayloadFS.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || "Author";
      updatePayloadFS.updatedAt = serverTimestamp();

      // console.log("AuthContext (updateUserProfile): Firestore update payload:", updatePayloadFS);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfile(currentFirebaseUser, { displayName: updatedData.displayName });
      }

      const updatedUserFromDb = await getDoc(userDocRef);
      let finalUpdatedUser: User;
      if (updatedUserFromDb.exists()) {
        const rawData = { id: updatedUserFromDb.id, ...updatedUserFromDb.data() };
        finalUpdatedUser = {
            ...rawData,
            createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
            updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
        } as User;
      } else {
        finalUpdatedUser = { ...user, ...updatePayloadFS, updatedAt: new Date().toISOString() } as User; // Fallback
      }

      // Optimistically update local state
      setUser(finalUpdatedUser);
      setIsAdminUser(finalUpdatedUser.isAdmin === true);
      // console.log("AuthContext (updateUserProfile): User state updated locally:", finalUpdatedUser);
      toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

      if (isProfileNowComplete && completingProfileStorageFlag) {
        // console.log("AuthContext (updateUserProfile): Profile now complete. Redirecting away from settings.");
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');
          setJustCompletedProfile(true); // Signal to onAuthStateChanged effect
          const target = redirectPath && redirectPath !== AUTHOR_PROFILE_SETTINGS_PATH
            ? redirectPath
            : (finalUpdatedUser.isAdmin ? ADMIN_DASHBOARD_PATH : (finalUpdatedUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
          router.push(target);
        }
      }
      return true;

    } catch (error: any) {
      // console.error("AuthContext (updateUserProfile): Update error:", error.message, error);
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  if (!isMounted || (loading && !user && (!firebaseAuth || !firebaseAuth.currentUser))) {
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
        <p className="text-muted-foreground mb-1">Firebase services are not available.</p>
        <p className="text-sm text-muted-foreground">
          Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>)
          are correctly set up in your <code>.env.local</code> file (for local development)
          AND in your Vercel project settings (for deployment).
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Check the browser console and server logs for more specific error messages from Firebase SDK initialization.
        </p>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: isAdminUser,
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
