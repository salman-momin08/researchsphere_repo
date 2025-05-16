
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import {
  auth as firebaseAuth, // This is now potentially null
  db as firestoreDb,     // This is now potentially null
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
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdminEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL;
    const isMockAdminEmail = firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    const baseProfileData = {
      email: firebaseUserObject.email || null,
      displayName: profileDataFromSignup?.fullName || firebaseUserObject.displayName || (profileDataFromSignup?.isSocialSignIn && firebaseUserObject.email ? firebaseUserObject.email.split('@')[0] : "User"),
      photoURL: firebaseUserObject.photoURL || null,
      username: profileDataFromSignup?.username || null,
      role: profileDataFromSignup?.role || (isCreatorAdminEmail || isMockAdminEmail ? "Admin" : "Author"),
      phoneNumber: profileDataFromSignup?.phoneNumber || null,
      institution: profileDataFromSignup?.institution || null,
      researcherId: profileDataFromSignup?.researcherId || null,
      isAdmin: isCreatorAdminEmail || isMockAdminEmail, // Default admin status
    };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData, // Spread existing first to preserve original fields like createdAt
        ...baseProfileData, // Then overwrite with new/updated data
        isAdmin: isCreatorAdminEmail || isMockAdminEmail || existingData.isAdmin || false, // Ensure isAdmin is preserved or set by special emails
        updatedAt: serverTimestamp(),
      };
      if (!dataToSave.createdAt && existingData.createdAt) { // Ensure createdAt isn't lost
        dataToSave.createdAt = existingData.createdAt;
      } else if (!dataToSave.createdAt) {
        dataToSave.createdAt = serverTimestamp();
      }
    } else {
      dataToSave = {
        userId: firebaseUid,
        ...baseProfileData,
        isAdmin: isCreatorAdminEmail || isMockAdminEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }
    
    // Explicitly set fields to null if they are undefined to avoid Firestore errors
    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
        if (dataToSave[key] === undefined) {
            (dataToSave as any)[key] = null;
        }
    });
    
    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for ${firebaseUid}:`, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true });
    
    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
        const finalData = userDocAfterSave.data();
        const finalIsAdmin = finalData.isAdmin === true; // Strict check
        return {
            id: userDocAfterSave.id,
            ...finalData,
            isAdmin: finalIsAdmin,
            createdAt: finalData.createdAt instanceof Timestamp ? finalData.createdAt.toDate().toISOString() : finalData.createdAt,
            updatedAt: finalData.updatedAt instanceof Timestamp ? finalData.updatedAt.toDate().toISOString() : finalData.updatedAt,
        } as User;
    }
    return null;

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error for UID ${firebaseUid}:`, error.message, error.code, error);
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
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
  const [isMounted, setIsMounted] = useState(false);

  // Critical check for Firebase services availability
  if (!firebaseAuth || !firestoreDb) {
    console.error("CRITICAL: Firebase Auth or Firestore DB instance is NOT available in AuthProvider. Application cannot function properly.");
    // Render a user-friendly error message if Firebase isn't initialized.
    // This helps prevent a white screen if firebase.ts fails to export auth/db.
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'red', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <h1>Application Configuration Error</h1>
        <p>Essential services (Firebase) could not be initialized.</p>
        <p>Please check the browser console for detailed error messages, and ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correctly set in your <code>.env.local</code> file (for local development) or in your hosting provider's environment variable settings (for deployment).</p>
      </div>
    );
  }

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true); // Set loading true at the start of auth state change
      if (firebaseUser) {
        let appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });

        if (appUser) {
          const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);
          
          appUser.isAdmin = finalIsAdmin;
          
          setUser(appUser);
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }

          const isProfileConsideredComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          
          if (!isProfileConsideredComplete && pathname !== '/profile/settings') {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else if (isProfileConsideredComplete && pathname === '/profile/settings' && ((typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') || searchParamsFromHook?.get('complete') === 'true')) {
            if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
            const targetPath = redirectAfterLoginPath || (finalIsAdmin ? '/admin/dashboard' : '/');
            if (pathname !== targetPath) router.push(targetPath);
            if (redirectAfterLoginPath && typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
          } else if (redirectAfterLoginPath) {
            if (pathname !== redirectAfterLoginPath) router.push(redirectAfterLoginPath);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
          } else {
            const onNonAdminEntryPoint = ['/login', '/signup', '/forgot-password', '/'].includes(pathname) || (pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true');
            if (finalIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/dashboard') && pathname !== '/admin/dashboard') {
               if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
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
      setActiveSocialLoginProvider(null);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook]);

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setIsSubmittingLogin(true); // Use local submitting state for login form
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
            setIsSubmittingLogin(false);
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email.`;
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setIsSubmittingLogin(false);
          toast({ variant: "destructive", title: "Login Failed", description: "Invalid email/username or password." });
          throw new Error("Invalid email/username or password.");
        }
      } catch (dbError: any) {
        setIsSubmittingLogin(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    try {
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({title: "Login Successful", description: "Welcome back!"});
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
    } finally {
      setIsSubmittingLogin(false);
    }
  };
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false); // For login form
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false); // For signup form

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setIsSubmittingSignup(true);
    setActiveSocialLoginProvider(null);

    let firebaseUser: FirebaseUser;
    try {
      // Username and phone uniqueness checks are now handled in updateUserProfile or profile completion flow
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
    } catch (authError: any) {
      setIsSubmittingSignup(false);
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
        toast({title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted."});
        // onAuthStateChanged will handle further actions and redirects
      } catch (profileError: any) {
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
      }
    }
    setIsSubmittingSignup(false);
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      toast({title: "Logged Out", description: "You have been successfully logged out."});
      // onAuthStateChanged will clear user state
      router.push('/'); // Explicit redirect to home on logout
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
      setLoading(false);
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Try logging in with that method.";
          break;
        case 'auth/operation-not-allowed':
            toastTitle = "Sign-In Method Disabled";
            toastMessage = `${providerName} sign-in is not enabled for this app.`;
            break;
        case 'auth/popup-blocked':
            toastTitle = "Popup Blocked";
            toastMessage = `Your browser blocked the ${providerName} sign-in popup. Please allow popups for this site and try again.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 7000 });
    setLoading(false); 
    setActiveSocialLoginProvider(null);
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    setLoading(true); // Global loading
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user and first-time profile creation.
      toast({title: `${providerName} Sign-In Successful!`, description: "Welcome!"});
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
       // setActiveSocialLoginProvider(null) handled by onAuthStateChanged or error handler
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
      // Uniqueness checks
      if (updatedData.username && updatedData.username !== user.username) {
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", updatedData.username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty && querySnapshot.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
        const querySnapshot = await getDocs(q);
         if (!querySnapshot.empty && querySnapshot.docs.some(doc => doc.id !== user.id)) {
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: any = { 
        displayName: updatedData.displayName !== undefined ? updatedData.displayName : user.displayName,
        username: updatedData.username !== undefined ? (updatedData.username || null) : user.username,
        role: updatedData.role !== undefined ? updatedData.role : user.role,
        phoneNumber: updatedData.phoneNumber !== undefined ? (updatedData.phoneNumber || null) : user.phoneNumber,
        institution: updatedData.institution !== undefined ? (updatedData.institution || null) : user.institution,
        researcherId: updatedData.researcherId !== undefined ? (updatedData.researcherId || null) : user.researcherId,
        updatedAt: serverTimestamp() 
      };
      
      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }

      await updateDoc(userDocRef, updatePayloadFS);
      
      const updatedUserFromDb = await getDoc(userDocRef).then(snap => {
        if (snap.exists()) {
            const data = snap.data();
            return {
                id: snap.id, ...data, isAdmin: data.isAdmin === true,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
            } as User;
        }
        return null;
      });

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb);
        setIsAdminUser(updatedUserFromDb.isAdmin === true);

        const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        if (isProfileNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
            localStorage.removeItem('completingProfile');
            const redirectPath = localStorage.getItem('redirectAfterLogin');
            const targetPath = redirectPath || (updatedUserFromDb.isAdmin ? '/admin/dashboard' : '/');
            if (pathname !== targetPath) router.push(targetPath);
            if (redirectPath) localStorage.removeItem('redirectAfterLogin');
        }
        return updatedUserFromDb;
      } else {
        throw new Error("Profile updated in Firestore, but failed to reload latest data into context.");
      }
    } catch(error: any) {
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."})
        throw error; 
    } finally {
        setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{
        user, 
        loading: loading || isSubmittingLogin || isSubmittingSignup, // Combine loading states
        login, signup, logout,
        loginWithGoogle, loginWithGitHub,
        sendPasswordResetEmail, updateUserProfile,
        showLoginModal, setShowLoginModal, 
        isAdmin: isAdminUser,
        isSocialLoginInProgress: activeSocialLoginProvider !== null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

