"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction } from 'react';
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
  getIdToken,
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

const MOCK_ADMIN_EMAIL = 'admin@example.com';
const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const convertTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') { // Could already be an ISO string
    if (!isNaN(new Date(timestamp).getTime())) return timestamp;
  }
  if (timestamp._seconds && typeof timestamp._seconds === 'number') { // Handle Firestore-like timestamp object
    return new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1000000).toISOString();
  }
  return null; // Or throw an error, or return a default
};


const ensureFirestoreUserProfile = async (
  uid: string,
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> & { isSocialSignIn?: boolean }
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB instance is not available.");
    toast({ variant: "destructive", title: "Critical Error", description: "Database service not configured.", duration: 10000 });
    return null;
  }

  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdminEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL;
    const isMockAdminEmail = firebaseUser.email === MOCK_ADMIN_EMAIL;

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore data for UID ${uid}:`, existingData);

      dataToSave = {
        // Start with existing data
        ...existingData,
        // Update with fresh data from Firebase Auth that might change
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // For other fields, prioritize existing data unless it's part of an explicit signup/update
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        // isAdmin status should be carefully managed
        isAdmin: isCreatorAdminEmail || isMockAdminEmail || existingData.isAdmin === true, // Prioritize explicit emails, then existing data
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
        userId: uid, // Ensure userId field is present
      };
    } else {
      // New user document
      // console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore data for UID ${uid}. Creating new document.`);
      const defaultRole = (isCreatorAdminEmail || isMockAdminEmail) ? "Admin" : "Author";
      dataToSave = {
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || defaultRole,
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdminEmail || isMockAdminEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // Ensure no undefined fields are sent to Firestore, convert empty strings to null for optional fields
    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
      if (dataToSave[key] === undefined) {
        (dataToSave as any)[key] = null;
      }
      if (key !== 'isAdmin' && dataToSave[key] === "") { // isAdmin can be false
        if (['username', 'phoneNumber', 'institution', 'researcherId'].includes(key)) {
          (dataToSave as any)[key] = null;
        }
      }
    });
    
    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save to Firestore for UID ${uid}:`, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true });

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      // console.log(`AuthContext (ensureFirestoreUserProfile): Firestore data after save for UID ${uid}:`, finalData);
      const finalIsAdmin = finalData.isAdmin === true;

      return {
        id: userDocAfterSave.id,
        ...finalData,
        isAdmin: finalIsAdmin,
        createdAt: convertTimestampToISO(finalData.createdAt),
        updatedAt: convertTimestampToISO(finalData.updatedAt),
      } as User;
    }
    console.error("AuthContext (ensureFirestoreUserProfile): User document not found after save for UID:", uid);
    return null;

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error for UID ${uid}:`, error.message, error.code, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 15000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); 
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) {
      setLoading(false); 
      return;
    }
    if (!firestoreDb) {
        console.error("AuthContext: Firestore DB instance is not available. Firebase Auth will proceed, but profile features will be broken.");
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      // console.log("AuthContext (onAuthStateChanged): FirebaseUser UID:", firebaseUser?.uid || "null");

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });
        // console.log("AuthContext (onAuthStateChanged): appUser from ensureFirestoreUserProfile:", appUser);

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          // console.log(`AuthContext (onAuthStateChanged): User set. UID: ${appUser.id}, IsAdmin: ${determinedIsAdmin}`);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          // console.log(`AuthContext (onAuthStateChanged): Profile complete check: Username='${appUser.username}', Role='${appUser.role}', Phone='${appUser.phoneNumber}'. Result: ${isProfileComplete}`);
          
          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }
          
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;
          const completingProfileQueryFlag = searchParamsFromHook?.get('complete') === 'true';

          if (!isProfileComplete && pathname !== '/profile/settings') {
            // console.log("AuthContext (onAuthStateChanged): Profile incomplete, redirecting to /profile/settings?complete=true");
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else if (isProfileComplete && pathname === '/profile/settings' && (completingProfileQueryFlag || completingProfileStorageFlag === 'true')) {
            // console.log("AuthContext (onAuthStateChanged): Profile just completed, redirecting away from /profile/settings.");
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            }
            const targetPath = redirectAfterLoginPath || (determinedIsAdmin ? '/admin/dashboard' : '/');
            // console.log(`AuthContext (onAuthStateChanged): Profile complete & on settings page. Redirecting to: ${targetPath}`);
            if (pathname !== targetPath) router.push(targetPath);
          } else if (redirectAfterLoginPath) {
            // console.log(`AuthContext (onAuthStateChanged): Using redirectAfterLoginPath: ${redirectAfterLoginPath}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            if (pathname !== redirectAfterLoginPath) router.push(redirectAfterLoginPath);
          } else {
            const onNonAdminEntryPoint = ['/login', '/signup', '/forgot-password', '/'].includes(pathname);
            const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);

            if (determinedIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin')) {
              // console.log("AuthContext (onAuthStateChanged): Admin on non-admin entry point, redirecting to /admin/dashboard");
              if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
            } else if (!determinedIsAdmin && onAuthPages) {
               // console.log("AuthContext (onAuthStateChanged): Non-admin on auth page, redirecting to /");
               if (pathname !== '/') router.push('/');
            }
          }
        } else {
            console.error("AuthContext (onAuthStateChanged): Failed to fetch or create user profile in Firestore. Logging out Firebase user.");
            if (firebaseAuth) await signOut(firebaseAuth); 
            setUser(null);
            setIsAdminUser(false);
        }
      } else { 
        setUser(null);
        setIsAdminUser(false);
        // console.log("AuthContext (onAuthStateChanged): No Firebase user. User set to null.");
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
          } else {
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email.`;
            setLoading(false);
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
           // Username not found, proceed with identifier as email (will likely fail if it's not an email)
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and further redirects
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
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    try {
      // Username uniqueness check in Firestore
      if (data.username) {
        const usersRef = collection(firestoreDb, "users");
        const usernameQuery = query(usersRef, where("username", "==", data.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Phone number uniqueness check in Firestore
      if (data.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const phoneQuery = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }
    } catch (validationError: any) {
      setLoading(false);
      toast({ variant: "destructive", title: "Signup Failed", description: validationError.message });
      throw validationError;
    }

    let firebaseUser: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
    } catch (authError: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = authError.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUser) {
      try {
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, data);
        if (!appUser) {
          throw new Error("Failed to create Firestore profile after signup.");
        }
        // onAuthStateChanged handles post-signup actions
      } catch (profileError: any) {
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method.";
          break;
        case 'auth/operation-not-allowed':
            toastTitle = "Sign-In Method Disabled";
            toastMessage = `${providerName} sign-in is not enabled for this app.`;
            break;
        case 'auth/popup-blocked':
            toastTitle = "Popup Blocked";
            toastMessage = `Your browser blocked the ${providerName} sign-in popup. Please allow popups.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    setLoading(false); 
    setActiveSocialLoginProvider(null);
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    setLoading(true); 
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle Firestore profile creation/fetch.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable. Cannot update profile.";
      toast({ variant: "destructive", title: "Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    setLoading(true);

    try {
      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
        const q = query(usersRef, where("username", "==", updatedData.username));
        const querySnapshot = await getDocs(q);
         if (!querySnapshot.empty && querySnapshot.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const q = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
        const querySnapshot = await getDocs(q);
         if (!querySnapshot.empty && querySnapshot.docs.some(doc => doc.id !== user.id)) {
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: any = { updatedAt: serverTimestamp() };

      (Object.keys(updatedData) as Array<keyof typeof updatedData>).forEach(key => {
          if (updatedData[key] !== undefined && user[key as keyof User] !== updatedData[key]) {
              updatePayloadFS[key] = updatedData[key] === "" ? null : updatedData[key];
          }
      });
      
      if (Object.keys(updatePayloadFS).length > 1) {
        await updateDoc(userDocRef, updatePayloadFS);
      }
      
      const updatedUserSnap = await getDoc(userDocRef);
      if (!updatedUserSnap.exists()) throw new Error("Failed to refetch profile after update.");
      
      const updatedAppUser = {
          id: updatedUserSnap.id,
          ...updatedUserSnap.data(),
          isAdmin: updatedUserSnap.data().isAdmin === true,
          createdAt: convertTimestampToISO(updatedUserSnap.data().createdAt),
          updatedAt: convertTimestampToISO(updatedUserSnap.data().updatedAt),
      } as User;

      setUser(updatedAppUser); 
      setIsAdminUser(updatedAppUser.isAdmin === true);
      
      toast({ title: "Success", description: "Your profile has been updated." });

      const isProfileNowComplete = !!(updatedAppUser.username && updatedAppUser.role && updatedAppUser.phoneNumber);
      if (isProfileNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');
          const targetPath = redirectPath || (updatedAppUser.isAdmin ? '/admin/dashboard' : '/');
          // console.log(`AuthContext (updateUserProfile): Profile now complete after update. Redirecting to: ${targetPath}`);
          if (pathname !== targetPath) router.push(targetPath);
      }
      return updatedAppUser;

    } catch(error: any) {
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        throw error; 
    } finally {
        setLoading(false);
    }
  };

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
