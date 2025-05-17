
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
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Kept for potential testing, though ADMIN_CREATOR_EMAIL is primary for dynamic admin creation

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const HOME_PATH = '/';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (emailAddress: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt' | 'userId'>>) => Promise<User | null>;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const convertTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof timestamp === 'object' && typeof timestamp.seconds === 'number' && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  return String(timestamp);
};

// This function ensures a user profile exists in Firestore after Firebase Auth success.
// It fetches an existing profile or creates a new one, especially for social logins or first-time email signups.
const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> // Data from signup form, if applicable
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB is not available.");
    return null;
  }
  const { uid, email, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let finalUserData: User;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as Partial<User>;
      const isCreatorOrMockAdmin = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;

      const dataToUpdate: Partial<User> & { updatedAt: any, createdAt?: any } = {
        userId: uid,
        email: email || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        // Prioritize existing data for core profile fields, update if signup data is explicitly provided
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || (isCreatorOrMockAdmin ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorOrMockAdmin || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true,
        updatedAt: serverTimestamp(),
      };

      if (existingData.createdAt) {
        dataToUpdate.createdAt = existingData.createdAt; // Preserve original creation timestamp
      } else {
        dataToUpdate.createdAt = serverTimestamp(); // Set if somehow missing
      }
      
      await setDoc(userDocRef, dataToUpdate, { merge: true });
      const updatedSnap = await getDoc(userDocRef); // Re-fetch to get server-generated timestamps
      if (!updatedSnap.exists()) throw new Error("Failed to re-fetch user document after update.");
      
      const rawUpdatedData = { id: uid, ...updatedSnap.data() } as any;
      finalUserData = {
        ...rawUpdatedData,
        createdAt: convertTimestampToISO(rawUpdatedData.createdAt),
        updatedAt: convertTimestampToISO(rawUpdatedData.updatedAt),
      } as User;

    } else { // User document doesn't exist, create it
      const isCreatorAdmin = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;
      const dataToSave: Omit<User, 'id'> & { createdAt: any, updatedAt: any } = {
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null, // Initialize to null if not from signup form
        role: profileDataFromSignup?.role || (isCreatorAdmin ? "Admin" : "Author"), // Default to Author or Admin
        phoneNumber: profileDataFromSignup?.phoneNumber || null, // Initialize to null
        institution: profileDataFromSignup?.institution || null, // Initialize to null
        researcherId: profileDataFromSignup?.researcherId || null, // Initialize to null
        isAdmin: isCreatorAdmin,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      await setDoc(userDocRef, dataToSave);
      const newSnap = await getDoc(userDocRef); // Re-fetch to get server-generated timestamps
      if (!newSnap.exists()) throw new Error("Failed to create user document after setDoc.");
      
      const rawNewData = { id: uid, ...newSnap.data() } as any;
      finalUserData = {
        ...rawNewData,
        createdAt: convertTimestampToISO(rawNewData.createdAt),
        updatedAt: convertTimestampToISO(rawNewData.updatedAt),
      } as User;
    }
    return finalUserData;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}" "${error.code}"`, error);
    if (error.code === 'permission-denied') {
        toast({ variant: "destructive", title: "Permission Error", description: `Could not access or create your profile in our database due to permission issues. Please check Firestore rules. Details: ${error.message}`, duration: 10000 });
    } else {
        toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
    }
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true); // Start true until auth state is determined
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [justCompletedProfile, setJustCompletedProfile] = useState(false); // Semaphore flag

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

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

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true); // Set loading true while processing auth state change
      setActiveSocialLoginProvider(null);

      if (justCompletedProfile) {
        setJustCompletedProfile(false); // Reset flag
        setLoading(false);
        return; // Let the redirect from updateUserProfile handle navigation
      }

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }
          
          // Scenario 1: Profile is incomplete, send to complete it.
          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          }
          // Scenario 2: Profile is complete, but user is on profile settings page due to 'completingProfile' flow.
          else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectAfterLoginPath === `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true` ) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null;
              }
            }
            const defaultDashboard = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath || defaultDashboard);
          }
          // Scenario 3: Handle redirectAfterLoginPath if set and profile completion is not the active flow
          else if (redirectAfterLoginPath && completingProfileStorageFlag !== 'true') {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            let targetPath = redirectAfterLoginPath;
            // Correct stale paths
            if (targetPath === '/user/profile/settings' || targetPath === '/profile/settings') targetPath = AUTHOR_PROFILE_SETTINGS_PATH;
            
            // Ensure admins are not redirected away from admin area by a non-admin redirectAfterLoginPath
            if (appUser.isAdmin && !targetPath.startsWith('/admin/')) {
              targetPath = ADMIN_DASHBOARD_PATH;
            } else if (!appUser.isAdmin && targetPath.startsWith('/admin/')) {
              targetPath = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
            }
            router.push(targetPath);
          }
          // Scenario 4: Default redirects from auth pages or for admins to their dashboard (if not covered above)
          else if (completingProfileStorageFlag !== 'true') {
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === HOME_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH); // Consider AUTHOR_PROFILE_SETTINGS_PATH an entry point if not completing profile

            if (appUser.isAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                if (pathname !== ADMIN_DASHBOARD_PATH) router.push(ADMIN_DASHBOARD_PATH);
            } else if (!appUser.isAdmin && onAuthPages && isProfileComplete) {
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(userDashboard);
            }
          }
        } else { // ensureFirestoreUserProfile returned null
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // No firebaseUser
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile'); // Clear if user explicitly logs out
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [isMounted, router, pathname, searchParamsFromHook, justCompletedProfile]); // Added justCompletedProfile

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDocData = querySnapshot.docs[0].data();
          if (userDocData.email) {
            emailToLogin = userDocData.email;
          } else {
            throw new Error("Username found but no associated email. Please try logging in with email.");
          }
        } else {
           throw new Error("Username not found. Please check your username or try logging in with email.");
        }
      } catch (dbError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Login Error", description: dbError.message || "Error looking up username." });
        throw dbError;
      }
    }
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle redirection and user state
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
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      // setLoading(false) handled by onAuthStateChanged
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (data.fullName && data.fullName !== cred.user.displayName) {
        await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      // Pass signup data to ensureFirestoreUserProfile to create the Firestore doc with username, role, etc.
      await ensureFirestoreUserProfile(cred.user, data);
      // onAuthStateChanged will handle setting user state and redirecting.
    } catch (error: any) {
      let errorMessage = "An unknown error occurred during signup.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'The email address is not valid.';
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMessage = 'Email/password accounts are not enabled.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'The password is too weak.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      // setLoading(false) handled by onAuthStateChanged
    }
  };

  const logout = async () => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      return;
    }
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      // setUser and setIsAdminUser are handled by onAuthStateChanged
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push(HOME_PATH);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out." });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    setLoading(false); 
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName} Login Error`;
    let toastMessage = `Could not sign in with ${providerName}. Please try again.`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again. If issues persist, try an alternative sign-in method or a different browser.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Please log in with that method.";
          break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({
      variant: "destructive",
      title: toastTitle,
      description: toastMessage,
      duration: 10000,
    });
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available (Firebase Auth).` });
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle profile creation/fetch and redirection.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) is handled by onAuthStateChanged
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    try {
      await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
    } catch (error: any) {
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt' | 'userId'>>): Promise<User | null> => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      toast({ variant: "destructive", title: "Update Error", description: "User not logged in or database service unavailable." });
      throw new Error("User not logged in or database service unavailable.");
    }
    setLoading(true);
    const updatePayloadFS: any = { updatedAt: serverTimestamp() };
    let firebaseAuthUpdatePayload: { displayName?: string } = {};

    // Prepare Firestore payload, ensuring empty strings become null
    if (updatedData.displayName !== undefined) {
      firebaseAuthUpdatePayload.displayName = updatedData.displayName || "";
      updatePayloadFS.displayName = updatedData.displayName || null;
    }
    if (updatedData.username !== undefined) {
      if(updatedData.username && updatedData.username !== user.username){
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
            setLoading(false);
            throw new Error("Username already taken. Please choose another one.");
        }
      }
      updatePayloadFS.username = updatedData.username || null;
    }
    if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || null;
    if (updatedData.phoneNumber !== undefined) {
      if(updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber){
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", updatedData.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
            setLoading(false);
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }
      updatePayloadFS.phoneNumber = updatedData.phoneNumber || null;
    }
    if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution || null;
    if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId || null;

    try {
      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined) {
        await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }
      const userDocRef = doc(firestoreDb, "users", user.id);
      if (Object.keys(updatePayloadFS).length > 1) { // more than just updatedAt
        await updateDoc(userDocRef, updatePayloadFS);
      }

      // Optimistically update local state and then re-fetch for server timestamps
      const locallyUpdatedUser = {
        ...user,
        ...updatePayloadFS, // Apply changes, serverTimestamp will be pending locally
        displayName: firebaseAuthUpdatePayload.displayName !== undefined ? firebaseAuthUpdatePayload.displayName : user.displayName,
      } as User; // Cast as User, serverTimestamp will be different type locally

      setUser(locallyUpdatedUser);
      setIsAdminUser(locallyUpdatedUser.isAdmin === true);

      const updatedUserFromDb = await ensureFirestoreUserProfile(firebaseAuth.currentUser); // Re-fetch
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Set with server timestamps
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        toast({ title: "Success", description: "Your profile has been updated." });

        const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
          setJustCompletedProfile(true); // Signal to onAuthStateChanged
          if (typeof window !== 'undefined') {
            let redirectPathAfterLoginStore = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('completingProfile');
            localStorage.removeItem('redirectAfterLogin');
            if (redirectPathAfterLoginStore === AUTHOR_PROFILE_SETTINGS_PATH || redirectPathAfterLoginStore === `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`) {
                redirectPathAfterLoginStore = null;
            }
            const defaultDashboard = updatedUserFromDb.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedUserFromDb.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectPathAfterLoginStore || defaultDashboard);
          }
        }
        setLoading(false);
        return updatedUserFromDb;
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      setLoading(false);
      throw error;
    }
  };

  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser)) { 
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
        <LoadingSpinner size={48} />
        <p className="ml-3">Initializing Application...</p>
      </div>
    );
  }
  
  if ((!firebaseAuth || !firestoreDb) && isMounted) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif', color: 'red', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <h1>Application Configuration Error</h1>
        <p>Firebase services are not available. Please ensure your Firebase environment variables (NEXT_PUBLIC_FIREBASE_...) are correctly set up in your <strong>.env.local</strong> file (for local development) AND in your <strong>Vercel project environment variables</strong> (for deployment), and that the server has been restarted.</p>
      </div>
    );
  }

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
