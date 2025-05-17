

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

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Kept for direct admin login testing

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
  if (typeof timestamp === 'string') {
    if (!isNaN(new Date(timestamp).getTime())) return timestamp;
  }
  if (timestamp._seconds && typeof timestamp._seconds === 'number') {
    return new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1000000).toISOString();
  }
  return null;
};

// This function is critical for creating/fetching the user's profile from Firestore
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
    const isMockAdminEmail = firebaseUser.email === MOCK_ADMIN_EMAIL; // For direct login test

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User; // Assume User type, but fields might be missing

      dataToSave = {
        // Prioritize existing Firestore data for core profile fields
        username: existingData.username !== undefined ? existingData.username : (profileDataFromSignup?.username || null),
        role: existingData.role !== undefined ? existingData.role : (profileDataFromSignup?.role || (isCreatorAdminEmail || isMockAdminEmail ? "Admin" : "Author")),
        phoneNumber: existingData.phoneNumber !== undefined ? existingData.phoneNumber : (profileDataFromSignup?.phoneNumber || null),
        institution: existingData.institution !== undefined ? existingData.institution : (profileDataFromSignup?.institution || null),
        researcherId: existingData.researcherId !== undefined ? existingData.researcherId : (profileDataFromSignup?.researcherId || null),
        
        // Update with fresh data from Firebase Auth that might change
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        
        // Admin status: Prioritize explicit emails, then existing data
        isAdmin: isCreatorAdminEmail || isMockAdminEmail || existingData.isAdmin === true,
        
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
        userId: uid, // Ensure userId field is present
        id: uid, // Ensure id field is present
      };
    } else {
      // New user document
      const defaultRole = (isCreatorAdminEmail || isMockAdminEmail) ? "Admin" : "Author";
      dataToSave = {
        userId: uid,
        id: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null, // Default to null if not provided
        role: profileDataFromSignup?.role || defaultRole,  // Default to "Author" or "Admin"
        phoneNumber: profileDataFromSignup?.phoneNumber || null, // Default to null
        institution: profileDataFromSignup?.institution || null, // Default to null
        researcherId: profileDataFromSignup?.researcherId || null, // Default to null
        isAdmin: isCreatorAdminEmail || isMockAdminEmail, // Set admin status based on special emails
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // Ensure no undefined fields are accidentally sent, default to null for optional string fields if empty
    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
      if (dataToSave[key] === undefined) {
        (dataToSave as any)[key] = null;
      }
      if (key !== 'isAdmin' && dataToSave[key] === "") {
        if (['username', 'phoneNumber', 'institution', 'researcherId', 'photoURL', 'displayName'].includes(key)) {
          (dataToSave as any)[key] = null;
        }
      }
    });
    
    console.log(`AuthContext (ensureFirestoreUserProfile): Data to save to Firestore for UID ${uid}:`, JSON.parse(JSON.stringify(dataToSave))); // Log a clone
    await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge:true to be safe

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
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
        // console.warn("AuthContext: Firestore DB instance is not available. Firebase Auth will proceed, but profile features will be broken.");
        setLoading(false);
        return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      setActiveSocialLoginProvider(null);

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });
        
        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          setShowLoginModal(false); // Close login modal if it was open

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;
          const completingProfileQueryFlag = searchParamsFromHook?.get('complete') === 'true';

          if (!isProfileComplete && pathname !== '/profile/settings') {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else if (isProfileComplete && pathname === '/profile/settings' && (completingProfileQueryFlag || completingProfileStorageFlag === 'true')) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            }
            const targetPath = redirectAfterLoginPath || (determinedIsAdmin ? '/admin/dashboard' : '/');
            if (pathname !== targetPath) router.push(targetPath);
          } else if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            if (pathname !== redirectAfterLoginPath) router.push(redirectAfterLoginPath);
          } else {
            const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === '/';

            if (determinedIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin')) {
              if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
            } else if (!determinedIsAdmin && onAuthPages) {
               if (pathname !== '/') router.push('/');
            }
          }
        } else {
            console.error("AuthContext: Failed to fetch or create user profile in Firestore. Logging out Firebase user.");
            if (firebaseAuth) await signOut(firebaseAuth); 
            setUser(null);
            setIsAdminUser(false);
        }
      } else { 
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false);
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
            throw new Error(`User profile incomplete for username '${identifier}'. Cannot resolve email.`);
          }
        } else {
          // If username not found, try logging in with the identifier as if it were an email
          // This will likely fail if it's not an email, leading to "invalid-credential"
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
      // onAuthStateChanged will handle Firestore sync and redirects
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
      setLoading(false); // Ensure loading is reset on error
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
      const usersRef = collection(firestoreDb, "users");
      if (data.username) {
        const usernameQuery = query(usersRef, where("username", "==", data.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) throw new Error("Username already taken. Please choose another one.");
      }
      if (data.phoneNumber) {
        const phoneQuery = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty) throw new Error("Phone number already in use. Please use a different one.");
      }
    } catch (validationError: any) {
      setLoading(false);
      toast({ variant: "destructive", title: "Signup Failed", description: validationError.message });
      throw validationError;
    }

    let firebaseUserInstance: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUserInstance = cred.user;
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

    if (firebaseUserInstance) {
      try {
        await updateFirebaseProfile(firebaseUserInstance, { displayName: data.fullName });
        const appUser = await ensureFirestoreUserProfile(firebaseUserInstance.uid, firebaseUserInstance, data);
        if (!appUser) throw new Error("Failed to create Firestore profile after signup.");
        // onAuthStateChanged handles post-signup actions (setting user, redirects)
      } catch (profileError: any) {
        setLoading(false); // Ensure loading is reset
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
        // Don't throw here, let onAuthStateChanged pick up the Firebase user
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will clear user state and redirect
    } catch (error: any) {
      setLoading(false);
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
          toastMessage = `The ${providerName} sign-in popup was closed. If this persists, ensure popups are allowed for this site.`;
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
            toastMessage = `Your browser blocked the ${providerName} sign-in popup. Please allow popups for this site.`;
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
      
      if (Object.keys(updatePayloadFS).length > 1) { // Only update if there's more than just updatedAt
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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};


    