
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
const MOCK_ADMIN_EMAIL = "admin@example.com"; // For easy admin testing

interface AuthContextType {
  user: User | null;
  loading: boolean; // Global loading for auth state changes
  isAdminUser: boolean;
  isProfileComplete: boolean;
  initialAuthCheckComplete: boolean; // True after the first onAuthStateChanged pass
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
  return String(timestamp);
};

// This function now aims to be the single source of truth for getting/creating Firestore user profile
export const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
    return null;
  }
  const uid = firebaseUser.uid;
  const userDocRef = doc(firestoreDb, "users", uid);
  const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;
  const isProfileUpdateOperation = !!profileDataFromSignup; // True if this function is called with explicit data to set/update

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Omit<User, 'id'> & { createdAt?: any, updatedAt?: any };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // Prioritize existing Firestore data for core profile fields unless explicitly updating them
      let determinedRole = existingData.role;
      if (isProfileUpdateOperation && profileDataFromSignup?.role !== undefined) {
        determinedRole = profileDataFromSignup.role;
      } else if (!existingData.role) { // Existing doc but no role, set a default
        determinedRole = isAdminByEmail ? "Admin" : "Author";
      }

      let determinedIsAdmin = existingData.isAdmin || false;
      if (isAdminByEmail) { // Email check always enforces admin status if true
        determinedIsAdmin = true;
      } else if (isProfileUpdateOperation && profileDataFromSignup && 'isAdmin' in profileDataFromSignup) {
        // This case should ideally be handled by specific admin functions, not general profile update
        // For now, ensure user cannot make themselves admin via normal profile update
        determinedIsAdmin = existingData.isAdmin || false;
      }


      dataToSave = {
        userId: uid,
        email: firebaseUser.email || existingData.email,
        displayName: profileDataFromSignup?.displayName || firebaseUser.displayName || existingData.displayName || null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        username: isProfileUpdateOperation && profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: determinedRole,
        phoneNumber: isProfileUpdateOperation && profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: isProfileUpdateOperation && profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: isProfileUpdateOperation && profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        isAdmin: determinedIsAdmin,
        isSuspended: existingData.isSuspended || false,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userDocRef, dataToSave, { merge: true });
    } else {
      // New user document
      const newRole = isAdminByEmail ? "Admin" : (profileDataFromSignup?.role || "Author");
      dataToSave = {
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.displayName || firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: newRole,
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
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
      return hydratedUser;
    }
    throw new Error(`User document ${uid} not found after create/update.`);
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}"`, error.code, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
    return null;
  }
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // True until initial auth check AND profile fetch/create is complete
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [initialAuthCheckComplete, setInitialAuthCheckComplete] = useState(false);
  const [showIncompleteProfileToastShownSession, setShowIncompleteProfileToastShownSession] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    if (!firebaseAuth || !firestoreDb) {
      setLoading(false);
      setInitialAuthCheckComplete(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      const currentWindowPathname = window.location.pathname;
      const currentWindowSearch = window.location.search;

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          const determinedProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(determinedProfileComplete);

          let completingProfileStorageFlag = false;
          if (typeof window !== 'undefined') {
            completingProfileStorageFlag = localStorage.getItem('completingProfile') === 'true';
          }
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;

          // Correct old profile settings path if stored
          if (redirectAfterLoginPath && (redirectAfterLoginPath.includes('/user/profile/settings') || redirectAfterLoginPath.includes('/profile/settings'))) {
            redirectAfterLoginPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
            if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', redirectAfterLoginPath);
          }

          if (!determinedProfileComplete) {
            if (currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            } else if (!showIncompleteProfileToastShownSession && currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH) {
               if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShownThisSession')) {
                toast({
                    title: "Profile Incomplete",
                    description: "Please complete your username, role, and phone number to continue.",
                    duration: 7000,
                });
                sessionStorage.setItem('incompleteProfileToastShownThisSession', 'true');
              }
              setShowIncompleteProfileToastShownSession(true);
            }
          } else { // Profile is complete
            if (completingProfileStorageFlag && (currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
              // Just completed profile, or landed on settings page with flag set
              if (typeof window !== 'undefined') {
                localStorage.removeItem('completingProfile');
                // Don't remove redirectAfterLoginPath yet if it's not the profile settings page
                if (redirectAfterLoginPath && redirectAfterLoginPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH)) {
                    localStorage.removeItem('redirectAfterLogin');
                    redirectAfterLoginPath = null; // It was for profile settings, now complete
                }
              }
              const targetDashboard = determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              router.push(redirectAfterLoginPath || targetDashboard);
            } else if (redirectAfterLoginPath) {
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              router.push(redirectAfterLoginPath);
            } else {
              const onAuthPage = [LOGIN_PATH, SIGNUP_PATH].includes(currentWindowPathname);
              const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(currentWindowPathname) || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');

              if (determinedIsAdmin && onNonAdminEntryPoint && currentWindowPathname !== ADMIN_DASHBOARD_PATH && !currentWindowPathname.startsWith('/admin/')) {
                router.push(ADMIN_DASHBOARD_PATH);
              } else if (!determinedIsAdmin && onAuthPage) {
                router.push(appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              }
            }
          }
        } else { // appUser is null from ensureFirestoreUserProfile (Firestore error)
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
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
           sessionStorage.removeItem('incompleteProfileToastShownThisSession');
        }
      }
      setInitialAuthCheckComplete(true);
      setLoading(false);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, pathname, searchParamsFromHook, router]); // User is intentionally omitted to avoid loops on its own update


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();

    try {
      if (!identifier.includes('@')) {
        // Assume it's a username, try to find email in Firestore
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
          // No user found with this username, proceed to try identifier as email
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      // onAuthStateChanged will handle setting user and redirection
    } catch (error: any) {
      let firebaseError = error;
      let errorMessage = "Login failed. Please check your credentials.";
      if (error.code === 'auth/invalid-credential' || error.message.includes("User record incomplete")) {
        errorMessage = "Invalid email/username or password.";
      } else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        errorMessage = "Invalid email/username or password.";
      } else if (error.message) {
        // errorMessage = error.message; // Can be too technical
      }
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage); // Re-throw for form to handle
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
      // Check username uniqueness in Firestore
      if (data.username && data.username.trim()) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          toast({ variant: "destructive", title: "Signup Failed", description: "Username already taken. Please choose another one." });
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Check phone number uniqueness in Firestore
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
        // Pass signup data to ensureFirestoreUserProfile, which will be called by onAuthStateChanged
        // OR call it here explicitly if onAuthStateChanged might be too slow / unreliable for immediate profile creation
        await ensureFirestoreUserProfile(userCredential.user, data);
      }
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      toast({ title: "Signup Successful!", description: "Your account has been created." });
      // onAuthStateChanged will handle redirection based on profile completeness
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "Email already registered.";
      } else if (error.message === "Username already taken. Please choose another one." || error.message === "Phone number already in use by another account.") {
        // Already handled by toast above
      } else {
        toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      }
      throw error; // Re-throw for form
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    setLoading(false);
    setInitialAuthCheckComplete(true); // Ensure app doesn't hang on loading screen
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred during social sign-in.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        toastMessage = `The ${providerName} sign-in popup was closed. If popups are blocked, please allow them for this site and try again.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
        toastMessage = `An account already exists with this email using a different sign-in method. Please log in with the original method or link accounts if supported.`;
    } else if (error.code === 'auth/operation-not-allowed') {
        toastMessage = `${providerName} sign-in is not enabled for this project. Contact support.`;
    } else if (error.code === 'auth/popup-blocked') {
        toastMessage = `The ${providerName} sign-in popup was blocked. Please allow popups for this site and try again.`;
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
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      // onAuthStateChanged will handle profile creation/fetch and redirection
    } catch (error: any) {
      handleSocialLoginError(error, providerName);
    } finally {
      setActiveSocialLoginProvider(null);
      // setLoading(false); // onAuthStateChanged will handle setting loading to false
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
      // router.push(LOGIN_PATH); // onAuthStateChanged handles redirect to login if on protected page
    } catch (error: any) {
      toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally {
      // setLoading(false); // onAuthStateChanged handles this
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
      throw error; // Let the calling component handle toast
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

      const updatePayloadFS: Partial<Omit<User, 'id' | 'createdAt'>> = { updatedAt: serverTimestamp() };
      if (updatedData.displayName !== undefined) updatePayloadFS.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || "Author";

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: updatedData.displayName });
      }
      
      const updatedUserFromDb = await ensureFirestoreUserProfile(currentFirebaseUser, updatedData);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); 
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        const isNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        setIsProfileComplete(isNowComplete);
        
        success = true;
        toast({ title: "Success", description: "Your profile has been updated." });

        if (isNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
          let redirectPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            localStorage.removeItem('redirectAfterLogin');
          }
          if (redirectPath && (redirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH) || redirectPath.startsWith('/user/profile/settings'))) {
            redirectPath = null; // Don't redirect back to settings
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
         toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
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
         <p className="text-muted-foreground mb-1">Crucial Firebase services (Auth or Firestore) are not available.</p>
         <p className="text-sm text-muted-foreground">Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correctly set up and the development server has been restarted.</p>
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
