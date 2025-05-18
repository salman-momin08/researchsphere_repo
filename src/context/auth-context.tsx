
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
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const convertFirestoreTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
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
  const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Omit<User, 'id'> & { createdAt?: any, updatedAt?: any };
    const isUpdatingProfile = !!profileDataFromSignup; // True if this function is called from updateUserProfile

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, JSON.parse(JSON.stringify(existingData)));
      console.log(`AuthContext (ensureFirestoreUserProfile): Raw existingData.role:`, existingData.role);

      let determinedRole: User['role'];
      if (isUpdatingProfile && profileDataFromSignup?.role !== undefined) {
        determinedRole = profileDataFromSignup.role;
        console.log(`AuthContext (ensureFirestoreUserProfile): Role from profileDataFromSignup (update):`, determinedRole);
      } else if (existingData.role) {
        determinedRole = existingData.role;
        console.log(`AuthContext (ensureFirestoreUserProfile): Role from existingData:`, determinedRole);
      } else {
        determinedRole = isAdminByEmail ? "Admin" : "Author"; // Fallback for existing doc with no role
        console.log(`AuthContext (ensureFirestoreUserProfile): Role defaulted for existing doc with no role (isAdminByEmail: ${isAdminByEmail}):`, determinedRole);
      }

      dataToSave = {
        userId: uid,
        email: firebaseUser.email || existingData.email,
        displayName: (isUpdatingProfile && profileDataFromSignup?.displayName !== undefined) ? profileDataFromSignup.displayName : (firebaseUser.displayName || existingData.displayName || null),
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        username: (isUpdatingProfile && profileDataFromSignup?.username !== undefined) ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: determinedRole,
        phoneNumber: (isUpdatingProfile && profileDataFromSignup?.phoneNumber !== undefined) ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: (isUpdatingProfile && profileDataFromSignup?.institution !== undefined) ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: (isUpdatingProfile && profileDataFromSignup?.researcherId !== undefined) ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        isAdmin: isAdminByEmail || existingData.isAdmin || false,
        isSuspended: existingData.isSuspended || false,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      console.log(`AuthContext (ensureFirestoreUserProfile): Data to merge/update for existing user ${uid}:`, JSON.parse(JSON.stringify(dataToSave)));
      await setDoc(userDocRef, dataToSave, { merge: true });
    } else {
      // New user document
      const determinedIsAdminForNewUser = isAdminByEmail;
      let newRole: User['role'];
      if (profileDataFromSignup?.role) {
        newRole = profileDataFromSignup.role;
         console.log(`AuthContext (ensureFirestoreUserProfile): Role from profileDataFromSignup (new user):`, newRole);
      } else {
        newRole = determinedIsAdminForNewUser ? "Admin" : "Author";
        console.log(`AuthContext (ensureFirestoreUserProfile): Role defaulted for new user (determinedIsAdmin: ${determinedIsAdminForNewUser}):`, newRole);
      }

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
        isAdmin: determinedIsAdminForNewUser,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      console.log(`AuthContext (ensureFirestoreUserProfile): Data for new user ${uid}:`, JSON.parse(JSON.stringify(dataToSave)));
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
      console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated user ${uid} with data (especially role: '${hydratedUser.role}'):`, JSON.parse(JSON.stringify(hydratedUser)));
      return hydratedUser;
    }
    throw new Error(`User document ${uid} not found after create/update.`);
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}:`, error.message, error.code, error);
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
  const [showIncompleteProfileToastShown, setShowIncompleteProfileToastShown] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
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
      setLoading(true); // Set loading true at the start of auth state change processing
      const currentWindowPathname = window.location.pathname;

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          const determinedProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(determinedProfileComplete);
          console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Path: ${currentWindowPathname}, Admin: ${determinedIsAdmin}, ProfileComplete: ${determinedProfileComplete}, UserRole: ${appUser.role}`);

          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;

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
              if (redirectAfterLoginPath === currentWindowPathname || (redirectAfterLoginPath && redirectAfterLoginPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH))) {
                localStorage.removeItem('redirectAfterLogin'); // Clear if it was pointing to profile settings
                redirectAfterLoginPath = null; // Prevent re-using it
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

            if (determinedIsAdmin && onNonAdminEntryPoint && currentWindowPathname !== ADMIN_DASHBOARD_PATH) {
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!determinedIsAdmin && onAuthPage) {
              router.push(appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            }
          }
          if (!determinedProfileComplete && !showIncompleteProfileToastShown && isMounted && currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH) {
             if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShownThisSession')) {
                toast({
                    title: "Profile Incomplete",
                    description: "Please complete your username, role, and phone number to continue.",
                    duration: 7000,
                });
                sessionStorage.setItem('incompleteProfileToastShownThisSession', 'true');
              }
          }

        } else { // appUser is null from ensureFirestoreUserProfile (Firestore error)
          if (firebaseAuth) await signOut(firebaseAuth);
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
  }, [isMounted, pathname, searchParamsFromHook, router, toast, showIncompleteProfileToastShown]);


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
          // Let Firebase handle it as an email if no username match
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
    } catch (error: any) {
      let firebaseError = error;
      let errorMessage = "Login failed. Please check your credentials.";
       if (error.code === 'auth/invalid-credential' || error.message.includes("User record incomplete")) {
        errorMessage = "Invalid email/username or password.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      // setLoading(false); // onAuthStateChanged will set loading to false
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Signup service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);

    try {
      const usersRef = collection(firestoreDb, "users");
      if (data.username && data.username.trim()) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (data.phoneNumber && data.phoneNumber.trim()) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
          throw new Error("Phone number already in use by another account.");
        }
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.fullName });
        // Pass signup data to ensureFirestoreUserProfile, which will be called by onAuthStateChanged
        // Forcing a call here to ensure Firestore doc is created with signup data immediately if onAuthStateChanged is slow
        await ensureFirestoreUserProfile(userCredential.user, data);
      }
      setShowLoginModal(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      toast({ title: "Signup Successful!", description: "Your account has been created." });
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "Email already registered.";
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw error;
    } finally {
       // setLoading(false); // onAuthStateChanged will set loading to false
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        toastMessage = `The ${providerName} sign-in popup was closed. Please try again. If popups are blocked, allow them for this site.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
        toastMessage = `An account already exists with this email using a different sign-in method. Please log in with the original method.`;
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
    setLoading(false);
    setInitialAuthCheckComplete(true);
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
      // setLoading(false); // onAuthStateChanged will handle this
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
      router.push(LOGIN_PATH);
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
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const updatedDataForFirestore: Partial<User> = {};
      if (updatedData.displayName !== undefined) updatedDataForFirestore.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatedDataForFirestore.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatedDataForFirestore.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatedDataForFirestore.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatedDataForFirestore.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatedDataForFirestore.role = updatedData.role || "Author"; // Default to Author if role becomes empty

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, { ...updatedDataForFirestore, updatedAt: serverTimestamp() });

      if (updatedData.displayName && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: updatedData.displayName });
      }
      
      // Re-fetch profile to get the absolute latest state including server timestamps
      const fetchedUpdatedUser = await ensureFirestoreUserProfile(currentFirebaseUser, updatedDataForFirestore);

      if (fetchedUpdatedUser) {
        setUser(fetchedUpdatedUser); // Optimistically update local state
        setIsAdminUser(fetchedUpdatedUser.isAdmin === true);
        const isNowComplete = !!(fetchedUpdatedUser.username && fetchedUpdatedUser.role && fetchedUpdatedUser.phoneNumber);
        setIsProfileComplete(isNowComplete);
        
        success = true;
        toast({ title: "Success", description: "Your profile has been updated." });

        if (isNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
          const redirectPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            localStorage.removeItem('redirectAfterLogin');
          }
          const targetDashboard = fetchedUpdatedUser.isAdmin ? ADMIN_DASHBOARD_PATH : (fetchedUpdatedUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
          router.push(redirectPath && redirectPath !== AUTHOR_PROFILE_SETTINGS_PATH && !redirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH+'?') ? redirectPath : targetDashboard);
        }
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
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

    