
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

const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    // This case is handled in AuthProvider before calling this
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
      username: profileDataFromSignup?.username || null, // Will be null for social, unless mapped
      role: profileDataFromSignup?.role || (isCreatorAdminEmail || isMockAdminEmail ? "Admin" : "Author"), // Default role
      phoneNumber: profileDataFromSignup?.phoneNumber || null, // Will be null for social
      institution: profileDataFromSignup?.institution || null,
      researcherId: profileDataFromSignup?.researcherId || null,
      isAdmin: isCreatorAdminEmail || isMockAdminEmail,
    };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData,
        ...baseProfileData, // Overwrite with new data if available
        // Ensure these specific fields are only overwritten if explicitly provided by signup or profile update,
        // or fall back to existing, then to null for safety if still undefined.
        username: baseProfileData.username !== undefined ? baseProfileData.username : (existingData.username || null),
        role: baseProfileData.role !== undefined ? baseProfileData.role : (existingData.role || "Author"),
        phoneNumber: baseProfileData.phoneNumber !== undefined ? baseProfileData.phoneNumber : (existingData.phoneNumber || null),
        institution: baseProfileData.institution !== undefined ? baseProfileData.institution : (existingData.institution || null),
        researcherId: baseProfileData.researcherId !== undefined ? baseProfileData.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || isMockAdminEmail || existingData.isAdmin || false,
        updatedAt: serverTimestamp(),
      };
       if (!dataToSave.createdAt && existingData.createdAt) {
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

    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
      if (dataToSave[key] === undefined) {
          (dataToSave as any)[key] = null;
      }
    });
    
    await setDoc(userDocRef, dataToSave, { merge: true });
    
    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
        const finalData = userDocAfterSave.data();
        const finalIsAdmin = finalData.isAdmin === true;
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
  const searchParamsFromHook = useNextSearchParams(); 
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });

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

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);

          if (!isProfileComplete && pathname !== '/profile/settings') {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else if (isProfileComplete && pathname === '/profile/settings' && ((typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') || searchParamsFromHook?.get('complete') === 'true')) {
            if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
            let targetPath = redirectAfterLoginPath;
            if (!targetPath) {
              targetPath = finalIsAdmin ? '/admin/dashboard' : '/';
            }
            if (pathname !== targetPath) router.push(targetPath);
            if (redirectAfterLoginPath && typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
          } else if (redirectAfterLoginPath) {
            if (pathname !== redirectAfterLoginPath) router.push(redirectAfterLoginPath);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
          } else {
            const onNonAdminEntryPoint = ['/login', '/signup', '/forgot-password', '/'].includes(pathname) || (pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true');
            if (finalIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin')) {
               if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
            }
          }
        } else {
          // Error ensuring Firestore profile, sign out Firebase Auth
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
            throw new Error(errorMsg);
          }
        } else {
          throw new Error("Invalid email/username or password.");
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
        // setLoading(false) is handled by onAuthStateChanged
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // Firebase Auth handles email uniqueness.
    // Username/phone uniqueness checks are deferred to profile update if stricter controls are needed beyond initial setup.

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
        toast({title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted."});
        // onAuthStateChanged will handle further actions and redirects
      } catch (profileError: any) {
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
      }
    }
     // setLoading(false) is handled by onAuthStateChanged
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      toast({title: "Logged Out", description: "You have been successfully logged out."});
      router.push('/'); 
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      setLoading(false); // Explicitly set loading false here as onAuthStateChanged will also run
      setUser(null); // Ensure user state is cleared immediately
      setIsAdminUser(false);
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
    setLoading(true); 
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user and first-time profile creation.
      toast({title: `${providerName} Sign-In Successful!`, description: "Welcome!"});
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
       // setLoading and activeSocialLoginProvider handled by onAuthStateChanged or error handler
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
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
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
      
      const updatedUserDocSnap = await getDoc(userDocRef);
      if (!updatedUserDocSnap.exists()) {
        throw new Error("Failed to fetch profile from Firestore after update.");
      }
      const updatedUserFromDb = {
          id: updatedUserDocSnap.id, ...updatedUserDocSnap.data(), 
          isAdmin: updatedUserDocSnap.data().isAdmin === true,
          createdAt: updatedUserDocSnap.data().createdAt instanceof Timestamp ? updatedUserDocSnap.data().createdAt.toDate().toISOString() : updatedUserDocSnap.data().createdAt,
          updatedAt: updatedUserDocSnap.data().updatedAt instanceof Timestamp ? updatedUserDocSnap.data().updatedAt.toDate().toISOString() : updatedUserDocSnap.data().updatedAt,
      } as User;
      
      setUser(updatedUserFromDb); // Update local auth context state immediately
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
