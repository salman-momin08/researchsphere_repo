
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
  getIdToken,
  deleteUser as firebaseDeleteUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, updateDoc, collection, deleteDoc } from 'firebase/firestore';
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

const convertFirestoreTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000).toISOString();
  }
  return String(timestamp); // Fallback
};


interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdminUser: boolean;
  isProfileComplete: boolean;
  initialAuthCheckComplete: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<User | null>;
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

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // Start true until initial auth check completes
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [initialAuthCheckComplete, setInitialAuthCheckComplete] = useState(false);
  const [hasShownIncompleteProfileToast, setHasShownIncompleteProfileToast] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const ensureFirestoreUserProfile = useCallback(async (
    firebaseUser: FirebaseUser,
    profileDataFromSignupOrUpdate?: Partial<SignupFormValues & { displayName?: string }>,
    isUpdatingProfile: boolean = false
  ): Promise<User | null> => {
    if (!firestoreDb) {
      console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
      return null;
    }
    const uid = firebaseUser.uid;
    const userDocRef = doc(firestoreDb, "users", uid);

    try {
      const userSnap = await getDoc(userDocRef);
      let dataToSave: Omit<User, 'id'> & { createdAt?: any, updatedAt?: any };
      const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

      if (userSnap.exists()) {
        const existingData = userSnap.data() as User;
        let determinedRole = existingData.role;
        if (isUpdatingProfile && profileDataFromSignupOrUpdate?.role) {
          determinedRole = profileDataFromSignupOrUpdate.role;
        } else if (!existingData.role && !isUpdatingProfile) {
          determinedRole = isAdminByEmail ? "Admin" : "Author"; // Default for new social logins if no role
        }

        let determinedIsAdmin = existingData.isAdmin || false;
        if (isAdminByEmail) {
            determinedIsAdmin = true;
            if (!determinedRole || determinedRole !== "Admin") determinedRole = "Admin";
        } else if (isUpdatingProfile && profileDataFromSignupOrUpdate && 'isAdmin' in profileDataFromSignupOrUpdate) {
            determinedIsAdmin = existingData.isAdmin || false; // Users cannot make themselves admin via profile form
        }

        dataToSave = {
          userId: uid,
          email: firebaseUser.email || existingData.email,
          displayName: profileDataFromSignupOrUpdate?.displayName || firebaseUser.displayName || existingData.displayName || firebaseUser.email || "User",
          photoURL: firebaseUser.photoURL || existingData.photoURL || null,
          username: isUpdatingProfile && profileDataFromSignupOrUpdate?.username !== undefined ? (profileDataFromSignupOrUpdate.username || null) : (existingData.username || null),
          role: determinedRole,
          phoneNumber: isUpdatingProfile && profileDataFromSignupOrUpdate?.phoneNumber !== undefined ? (profileDataFromSignupOrUpdate.phoneNumber || null) : (existingData.phoneNumber || null),
          institution: isUpdatingProfile && profileDataFromSignupOrUpdate?.institution !== undefined ? (profileDataFromSignupOrUpdate.institution || null) : (existingData.institution || null),
          researcherId: isUpdatingProfile && profileDataFromSignupOrUpdate?.researcherId !== undefined ? (profileDataFromSignupOrUpdate.researcherId || null) : (existingData.researcherId || null),
          isAdmin: determinedIsAdmin,
          isSuspended: existingData.isSuspended || false,
          createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : serverTimestamp()) : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(userDocRef, dataToSave, { merge: true });

      } else { // New user document
        const defaultRole = isAdminByEmail ? "Admin" : (profileDataFromSignupOrUpdate?.role || "Author");
        dataToSave = {
          userId: uid,
          email: firebaseUser.email,
          displayName: profileDataFromSignupOrUpdate?.displayName || firebaseUser.displayName || firebaseUser.email || "User",
          photoURL: firebaseUser.photoURL || null,
          username: profileDataFromSignupOrUpdate?.username || null,
          role: defaultRole,
          phoneNumber: profileDataFromSignupOrUpdate?.phoneNumber || null,
          institution: profileDataFromSignupOrUpdate?.institution || null,
          researcherId: profileDataFromSignupOrUpdate?.researcherId || null,
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
      if (error.code === 'permission-denied') {
        toast({ variant: "destructive", title: "Firestore Permission Error", description: `Could not access your profile data. Please check Firestore rules or contact support. Details: ${error.message}`, duration: 10000 });
      } else {
        toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
      }
      return null;
    }
  }, [toast]);


  const showIncompleteProfileToast = useCallback(() => {
    if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShownThisSession')) {
      toast({
        title: "Profile Incomplete",
        description: "Your profile is missing some details (like username, role, or phone number). Please visit Profile Settings to update it.",
        duration: 7000,
        variant: "default"
      });
      sessionStorage.setItem('incompleteProfileToastShownThisSession', 'true');
      setHasShownIncompleteProfileToast(true); // For current session state
    }
  }, [toast]);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) {
      if (isMounted && !firebaseAuth) {
        setLoading(false);
        setInitialAuthCheckComplete(true);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentFirebaseUser: FirebaseUser | null) => {
      setLoading(true);
      const currentWindowPathname = typeof window !== 'undefined' ? window.location.pathname : "";
      const currentWindowSearch = typeof window !== 'undefined' ? window.location.search : "";

      if (currentFirebaseUser) {
        const appUser = await ensureFirestoreUserProfile(currentFirebaseUser);

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          const determinedProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(determinedProfileComplete);

          let completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;

          // Correct redirectAfterLoginPath if it's an old profile settings path
          if (redirectAfterLoginPath && (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings')) {
            redirectAfterLoginPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
            if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', redirectAfterLoginPath);
          }

          if (!determinedProfileComplete && currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (determinedProfileComplete && completingProfileStorageFlag && (currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              localStorage.removeItem('redirectAfterLogin');
            }
            const targetDashboard = determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH && !redirectAfterLoginPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?') ? redirectAfterLoginPath : targetDashboard);
          } else if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            router.push(redirectAfterLoginPath);
          } else {
            const onAuthPage = [LOGIN_PATH, SIGNUP_PATH].includes(currentWindowPathname);
            const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(currentWindowPathname) || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');

            if (determinedIsAdmin && onNonAdminEntryPoint && currentWindowPathname !== ADMIN_DASHBOARD_PATH && !currentWindowPathname.startsWith('/admin/')) {
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!determinedIsAdmin && onAuthPage) {
              const targetDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(targetDashboard);
            }
          }
        } else { // appUser is null (Firestore error)
          if (firebaseAuth) await signOut(firebaseAuth); // Ensure Firebase Auth session is also cleared
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
          // Don't clear redirectAfterLogin if user was trying to access a page and got logged out before reaching it.
          localStorage.removeItem('completingProfile');
          sessionStorage.removeItem('incompleteProfileToastShownThisSession');
        }
      }
      setInitialAuthCheckComplete(true);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, searchParamsFromHook, router, ensureFirestoreUserProfile, showIncompleteProfileToast]);


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
        // Assume it's a username, try to find the email in Firestore
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) {
            emailToLogin = userData.email;
          } else {
            errorMessage = "User record incomplete (missing email for username).";
            throw new Error(errorMessage);
          }
        } else {
          // Let Firebase handle "user-not-found" if identifier was a username not in DB
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false); // Close modal on successful Firebase auth
      setHasShownIncompleteProfileToast(false); // Reset for next session
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      // onAuthStateChanged will handle setting user and redirection
    } catch (error: any) {
      firebaseError = error;
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        errorMessage = "Invalid email/username or password.";
      } else if (error.message && error.message.includes("User record incomplete")) {
        // Already set
      } else if (error.message) {
        // Use generic for other Firebase errors
      }
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues): Promise<User | null> => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Signup service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);

    try {
      // Uniqueness checks are now primarily handled during profile update for simplicity,
      // Firebase handles email uniqueness.
      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.fullName });
        // Pass role from signup data to ensureFirestoreUserProfile
        const appUser = await ensureFirestoreUserProfile(userCredential.user, { ...data, displayName: data.fullName });
        if (appUser) {
          toast({ title: "Signup Successful!", description: "Your account has been created." });
          setShowLoginModal(false);
          setHasShownIncompleteProfileToast(false);
          if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
          // onAuthStateChanged will handle redirection based on profile completeness
          return appUser;
        } else {
          throw new Error("Failed to create Firestore profile after signup.");
        }
      }
      return null; // Should not happen if createUserWithEmailAndPassword succeeds
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "Email already registered.";
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw error; // Re-throw to be caught by form
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null); // Reset provider specific loading
    setLoading(false); // Reset global loading

    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || `An unexpected error occurred during ${providerName} sign-in.`;

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      toastMessage = `The ${providerName} sign-in popup was closed. If popups are blocked, please allow them for this site and try again.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method.`;
    } else if (error.code === 'auth/operation-not-allowed') {
      toastMessage = `${providerName} sign-in is not enabled. Contact support.`;
    } else if (error.code === 'auth/popup-blocked') {
      toastMessage = `The ${providerName} sign-in popup was blocked by your browser. Please allow popups for this site and try again.`;
    }
    
    toast({
      title: toastTitle,
      description: toastMessage,
      variant: "destructive",
      duration: 7000,
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

    if (providerName === 'google') {
        providerInstance.setCustomParameters({ prompt: 'select_account' });
    }

    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting
      setShowLoginModal(false);
      setHasShownIncompleteProfileToast(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
    } catch (error: any) {
      handleSocialLoginError(error, providerName);
    } finally {
      // setActiveSocialLoginProvider(null); // Reset in handleSocialLoginError or on success via onAuthStateChanged setting user
      // setLoading(false); // Reset in handleSocialLoginError or on success
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    const redirectPath = HOME_PATH;
    try {
      await signOut(firebaseAuth);
      // User state will be cleared by onAuthStateChanged
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
        sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      }
      setHasShownIncompleteProfileToast(false); // Reset for future logins
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
      if (updatedData.username && updatedData.username.trim() && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() && updatedData.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
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

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: updatedData.displayName });
      }
      
      const reFetchedUser = await ensureFirestoreUserProfile(currentFirebaseUser, updatedData, true);

      if (reFetchedUser) {
        setUser(reFetchedUser); // Optimistically update user state
        setIsAdminUser(reFetchedUser.isAdmin === true);
        const isNowComplete = !!(reFetchedUser.username && reFetchedUser.role && reFetchedUser.phoneNumber);
        setIsProfileComplete(isNowComplete);
        
        success = true;
        toast({ title: "Success", description: "Your profile has been updated." });

        if (isNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            localStorage.removeItem('redirectAfterLogin');
          }
          const targetDashboard = reFetchedUser.isAdmin ? ADMIN_DASHBOARD_PATH : (reFetchedUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
          router.push(redirectPath && redirectPath !== AUTHOR_PROFILE_SETTINGS_PATH && !redirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?') ? redirectPath : targetDashboard);
        }
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update profile." });
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
         <h1 className="text-xl md:text-2xl font-bold text-destructive mb-2">Application Configuration Error</h1>
         <p className="text-muted-foreground mb-1">Firebase services (Authentication or Firestore) are not available.</p>
         <p className="text-sm text-muted-foreground">Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correctly set up in your <code>.env.local</code> file and your Vercel project settings, and that the development server has been restarted.</p>
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
        isSocialLoginInProgress: !!activeSocialLoginProvider && loading, // More precise loading state for social
        showIncompleteProfileToast
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
