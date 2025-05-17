
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
  writeBatch,
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // For easy admin testing

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

const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB is not available.");
    toast({ variant: "destructive", title: "Database Error", description: "User profile database is not available. Please try again later." });
    return null;
  }
  const { uid, email: firebaseEmail, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let finalUserData: User;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as Partial<User>;
      const isAdminByEmail = firebaseEmail === ADMIN_CREATOR_EMAIL || firebaseEmail === MOCK_ADMIN_EMAIL;

      const dataToUpdate: Partial<User> & { updatedAt?: any } = {
        userId: uid,
        email: firebaseEmail || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (firebaseEmail ? firebaseEmail.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        // Prioritize existing data for core profile fields unless new signup data is provided
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username !== undefined ? existingData.username : null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role !== undefined ? existingData.role : (isAdminByEmail ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber !== undefined ? existingData.phoneNumber : null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution !== undefined ? existingData.institution : null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId !== undefined ? existingData.researcherId : null),
        isAdmin: isAdminByEmail || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true,
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
      };
      
      await setDoc(userDocRef, dataToUpdate, { merge: true });
      const updatedSnap = await getDoc(userDocRef); // Re-fetch to get server timestamps
      if (!updatedSnap.exists()) throw new Error("Failed to re-fetch user document after update.");
      
      const rawUpdatedData = { id: uid, ...updatedSnap.data() } as any;
      finalUserData = {
        ...rawUpdatedData,
        createdAt: convertTimestampToISO(rawUpdatedData.createdAt),
        updatedAt: convertTimestampToISO(rawUpdatedData.updatedAt),
      } as User;

    } else { // User document doesn't exist, create it
      const isAdminByEmail = firebaseEmail === ADMIN_CREATOR_EMAIL || firebaseEmail === MOCK_ADMIN_EMAIL;
      const dataToSave: Omit<User, 'id'> & { createdAt: any, updatedAt: any } = {
        userId: uid,
        email: firebaseEmail,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (firebaseEmail ? firebaseEmail.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge:true to be safe
      const newSnap = await getDoc(userDocRef);
      if (!newSnap.exists()) throw new Error("Failed to create user document.");
      
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
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [justCompletedProfile, setJustCompletedProfile] = useState(false); // Semaphore flag

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); 

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) setLoading(false);
      return;
    }

    if (justCompletedProfile) {
      setJustCompletedProfile(false);
      return; // Let updateUserProfile's redirect take precedence
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      setActiveSocialLoginProvider(null);

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
            // Correct stale /user/profile/settings paths
            if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                redirectAfterLoginPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
                localStorage.setItem('redirectAfterLogin', redirectAfterLoginPath);
            }
             if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH && !redirectAfterLoginPath.includes('?complete=true')) {
                redirectAfterLoginPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
             }
          }
          
          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              localStorage.removeItem('redirectAfterLogin');
            }
            const targetDashboard = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath && redirectAfterLoginPath !== `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true` && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH ? redirectAfterLoginPath : targetDashboard);
          } else if (redirectAfterLoginPath && redirectAfterLoginPath !== pathname) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            let targetPath = redirectAfterLoginPath;
            if (appUser.isAdmin && !targetPath.startsWith('/admin/')) {
              targetPath = ADMIN_DASHBOARD_PATH;
            } else if (!appUser.isAdmin && targetPath.startsWith('/admin/')) {
              targetPath = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
            }
            router.push(targetPath);
          } else {
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === HOME_PATH || (pathname === AUTHOR_PROFILE_SETTINGS_PATH && searchParamsFromHook.get('complete') === 'true');

            if (appUser.isAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                if (pathname !== ADMIN_DASHBOARD_PATH) router.push(ADMIN_DASHBOARD_PATH);
            } else if (!appUser.isAdmin && onAuthPages && isProfileComplete) {
                const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
                if (pathname !== userDashboard) router.push(userDashboard);
            }
          }
        } else { // appUser is null from ensureFirestoreUserProfile
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // No firebaseUser
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [isMounted, router, pathname, searchParamsFromHook, user, justCompletedProfile]); // Added user, justCompletedProfile

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
           throw new Error("Invalid email/username or password.");
        }
      } catch (dbError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Login Error", description: dbError.message || "Error looking up username." });
        throw dbError;
      }
    }
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user state and redirection
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
      setLoading(false); // Ensure loading is false on error
      throw new Error(errorMessage);
    }
    // setLoading(false) handled by onAuthStateChanged after successful auth
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    try {
      if (data.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", data.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (data.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (data.fullName && data.fullName !== cred.user.displayName) {
        await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      await ensureFirestoreUserProfile(cred.user, data); // This will create the Firestore doc
      toast({ title: "Account Created!", description: "Welcome! Please complete your profile if prompted." });
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
      setLoading(false);
      throw new Error(errorMessage);
    }
    // setLoading(false) handled by onAuthStateChanged
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
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Please log in with that method.";
          break;
        case 'auth/operation-not-allowed':
            toastMessage = `Sign-in with ${providerName} is not enabled. Please contact support.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({
      variant: "destructive",
      title: toastTitle,
      description: toastMessage,
      duration: 7000,
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
    // setLoading(false) handled by onAuthStateChanged or error handler
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

    const fieldsToNullifyIfEmpty = ['username', 'phoneNumber', 'institution', 'researcherId'];

    if (updatedData.displayName !== undefined) {
      firebaseAuthUpdatePayload.displayName = updatedData.displayName || "";
      updatePayloadFS.displayName = updatedData.displayName || null;
    }
    for (const key of fieldsToNullifyIfEmpty) {
        if ((updatedData as any)[key] !== undefined) {
            updatePayloadFS[key] = (updatedData as any)[key] || null;
        }
    }
    if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || null;


    try {
      // Username uniqueness check (if changed)
      if (updatedData.username && updatedData.username !== user.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Phone number uniqueness check (if changed)
      if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", updatedData.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }
      const userDocRef = doc(firestoreDb, "users", user.id);
      if (Object.keys(updatePayloadFS).length > 1) { 
        await updateDoc(userDocRef, updatePayloadFS);
      }

      // Optimistically update local state, then re-fetch to confirm & get server timestamps
      const optimisticallyUpdatedUser = {
        ...user,
        ...updatePayloadFS, 
        displayName: firebaseAuthUpdatePayload.displayName !== undefined ? firebaseAuthUpdatePayload.displayName : user.displayName,
        updatedAt: new Date().toISOString(), // Temporary
      } as User;

      setUser(optimisticallyUpdatedUser); 
      setIsAdminUser(optimisticallyUpdatedUser.isAdmin === true);

      const updatedUserFromDb = await ensureFirestoreUserProfile(firebaseAuth.currentUser, updatedData);
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); 
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        
        const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
          setJustCompletedProfile(true); // Signal to onAuthStateChanged effect
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            let redirectPath = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin');

            if (redirectPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectPath === `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`) {
                redirectPath = null; // Don't redirect back to settings
            }
            const targetDashboard = updatedUserFromDb.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedUserFromDb.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectPath || targetDashboard);
          }
        }
        toast({ title: "Success", description: "Your profile has been updated." });
        return updatedUserFromDb;
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error; // Rethrow to be caught by form
    } finally {
      setLoading(false);
    }
  };

  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser && typeof window !== 'undefined' && !localStorage.getItem('completingProfile'))) { 
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
        <p>Firebase services (Auth or Firestore) are not available. Please ensure your Firebase environment variables (NEXT_PUBLIC_FIREBASE_...) are correctly set up in your <strong>.env.local</strong> file (for local development) AND in your <strong>Vercel project environment variables</strong> (for deployment), and that the server has been restarted.</p>
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
