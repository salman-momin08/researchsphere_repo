
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction, useContext, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
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
const MOCK_ADMIN_EMAIL = 'admin@example.com';

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
    if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
  }
  if (typeof timestamp === 'object' && timestamp.seconds && typeof timestamp.seconds === 'number') {
    return new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000).toISOString();
  }
  return String(timestamp);
};

// Helper to convert Firestore Timestamps in user data
const convertUserDocumentTimestamps = (userData: any): User => {
  return {
    ...userData,
    createdAt: convertTimestampToISO(userData.createdAt),
    updatedAt: convertTimestampToISO(userData.updatedAt),
  } as User;
};

const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
): Promise<User | null> => {
  if (!firestoreDb) {
    toast({ variant: "destructive", title: "Critical Error", description: "Database service not configured for profile management.", duration: 10000 });
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Partial<User> & { id: string; userId: string; email: string | null; updatedAt: any; createdAt?: any; };
    const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData,
        id: firebaseUid,
        userId: firebaseUid,
        email: firebaseUser.email, // Always update with latest from Firebase Auth
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        username: existingData.username || profileDataFromSignup?.username || null,
        role: existingData.role || profileDataFromSignup?.role || (isAdminByEmail ? "Admin" : "Author"),
        phoneNumber: existingData.phoneNumber || profileDataFromSignup?.phoneNumber || null,
        institution: existingData.institution || profileDataFromSignup?.institution || null,
        researcherId: existingData.researcherId || profileDataFromSignup?.researcherId || null,
        isSuspended: existingData.isSuspended === true, // Ensure boolean
        isAdmin: isAdminByEmail || existingData.isAdmin === true,
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
      };
    } else {
      dataToSave = {
        id: firebaseUid,
        userId: firebaseUid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isSuspended: false,
        isAdmin: isAdminByEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // Ensure no 'undefined' values are sent to Firestore, replace with 'null'
    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
        if (dataToSave[key] === undefined) {
            (dataToSave as any)[key] = null;
        }
        if (key !== 'isAdmin' && key !== 'isSuspended' && dataToSave[key] === "") {
            if (['username', 'phoneNumber', 'institution', 'researcherId', 'photoURL', 'displayName'].includes(key)) {
                (dataToSave as any)[key] = null;
            }
        }
    });

    await setDoc(userDocRef, dataToSave, { merge: true });
    const userDocAfterSave = await getDoc(userDocRef);

    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      return convertUserDocumentTimestamps({
        ...finalData,
        id: userDocAfterSave.id,
        isAdmin: finalData.isAdmin === true,
      });
    }
    return null;
  } catch (error: any) {
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Details: ${error.message}`, duration: 15000 });
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

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useSearchParams(); // Called at top level

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) {
      if (isMounted && !firebaseAuth) { // Only set loading false if mounted and firebaseAuth is truly missing
         setLoading(false);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      setActiveSocialLoginProvider(null);

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser);

        if (appUser) {
          setUser(appUser);
          const currentIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(currentIsAdmin);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          const onProfileSettingsPage = pathname === '/author/profile/settings';
          const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;
          const redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;

          // Scenario 1: Profile is incomplete, and user is not on the profile settings page
          if (!isProfileComplete && !onProfileSettingsPage) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/author/profile/settings?complete=true');
            setLoading(false);
            return;
          }

          // Scenario 2: Profile is complete, and user was just completing it
          if (isProfileComplete && onProfileSettingsPage && (searchParamsFromHook?.get('complete') === 'true' || completingProfileStorageFlag === 'true')) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            }
            let targetPath = redirectAfterLoginPath;
            if (!targetPath) {
              targetPath = currentIsAdmin ? '/admin/dashboard' : (appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard');
            }
            if (pathname !== targetPath) router.push(targetPath);
            setLoading(false);
            return;
          }
          
          // Scenario 3: Handle redirectAfterLoginPath if it exists
          if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            let correctedRedirectPath = redirectAfterLoginPath;
            // Correct a potentially stale old profile path
            if (redirectAfterLoginPath === '/user/profile/settings') {
              correctedRedirectPath = '/author/profile/settings';
              if (searchParamsFromHook?.has('complete')) {
                correctedRedirectPath += '?complete=true';
              }
            }
            if (pathname !== correctedRedirectPath) router.push(correctedRedirectPath);
            setLoading(false);
            return;
          }

          // Scenario 4: Default redirection for admins if on non-admin entry points
          const nonAdminEntryPoints = ['/', '/login', '/signup', '/forgot-password', '/author/profile/settings'];
          if (currentIsAdmin && nonAdminEntryPoints.some(p => pathname.startsWith(p) && p !== '/author/profile/settings') && !pathname.startsWith('/admin/')) {
             if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
             setLoading(false);
             return;
          }
          
          // Scenario 5: Default redirection for non-admins if on auth pages
          if (!currentIsAdmin && onAuthPages) {
            const userDashboard = appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard';
            if (pathname !== userDashboard) router.push(userDashboard);
            setLoading(false);
            return;
          }

        } else { // appUser is null (Firestore sync failed)
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // No Firebase user
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
            setLoading(false);
            throw new Error(`User profile incomplete for username '${identifier}'.`);
          }
        } else {
          setLoading(false);
          throw new Error(`No user found with username '${identifier}'.`);
        }
      } catch (dbError: any) {
        setLoading(false);
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful!", description: "Welcome back!" });
      // onAuthStateChanged will handle setting user and redirecting
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
      setLoading(false);
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

    // Username and Phone number uniqueness checks (now against Firestore)
    if (data.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
            setLoading(false);
            const errMessage = "Username already taken. Please choose another one.";
            toast({ variant: "destructive", title: "Signup Failed", description: errMessage });
            throw new Error(errMessage);
        }
    }
    if (data.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            const errMessage = "Phone number already in use. Please use a different one.";
            toast({ variant: "destructive", title: "Signup Failed", description: errMessage });
            throw new Error(errMessage);
        }
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
        if (data.fullName && data.fullName !== firebaseUserInstance.displayName) {
            await updateFirebaseProfile(firebaseUserInstance, { displayName: data.fullName });
        }
        const appUser = await ensureFirestoreUserProfile(firebaseUserInstance.uid, firebaseUserInstance, data);
        if (!appUser) {
          throw new Error("Failed to create Firestore profile after signup.");
        }
        toast({ title: "Signup Successful!", description: "Welcome to ResearchSphere. Please complete your profile if prompted." });
        // onAuthStateChanged will handle profile completion check and redirection
      } catch (profileError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
         throw profileError;
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will set user to null and loading to false
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/');
    } catch (error: any) {
      setLoading(false);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName} Login Error`;
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;

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
      // onAuthStateChanged will handle profile creation and redirection
      // toast({ title: `${providerName} Sign-In Successful!`, description: "Welcome!" }); // Toast handled by onAuthStateChanged or its aftermath
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading and setActiveSocialLoginProvider handled by onAuthStateChanged or error handler
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
      toast({variant: "destructive", title: "Update Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    setLoading(true);
    
    const updatePayloadFS: any = { updatedAt: serverTimestamp() };
    let firebaseAuthUpdatePayload: { displayName?: string } = {};

    (Object.keys(updatedData) as Array<keyof typeof updatedData>).forEach(key => {
        const value = updatedData[key];
        if (key === 'displayName' && value !== user.displayName) {
          firebaseAuthUpdatePayload.displayName = String(value || "");
        }
        updatePayloadFS[key] = value === "" ? null : value; // Ensure empty strings become null
    });

    try {
      if (updatePayloadFS.username && updatePayloadFS.username !== user.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", updatePayloadFS.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatePayloadFS.phoneNumber && updatePayloadFS.phoneNumber !== user.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", updatePayloadFS.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }
      
      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);
      
      // Optimistic update then re-fetch
      const optimisticallyUpdatedUser = { ...user, ...updatedData, updatedAt: new Date().toISOString() };
      setUser(optimisticallyUpdatedUser as User); // Apply changes locally immediately
      
      const updatedUserFromDbSnap = await getDoc(userDocRef);
      if (updatedUserFromDbSnap.exists()) {
        const finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        setUser(finalUpdatedUser);
        setIsAdminUser(finalUpdatedUser.isAdmin === true);

        const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
        const completingProfileFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && completingProfileFlag === 'true') {
          if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              localStorage.removeItem('redirectAfterLogin');
              const targetPath = redirectPath || (finalUpdatedUser.isAdmin ? '/admin/dashboard' : '/author/dashboard');
              router.push(targetPath);
          }
        }
        toast({ title: "Success", description: "Your profile has been updated." });
        return finalUpdatedUser;
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

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
       {!isMounted || (loading && !user && !firebaseAuth?.currentUser && !showLoginModal) ? (
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
            </div>
        ) : (!firebaseAuth || !firestoreDb) && isMounted ? (
             <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle text-destructive mb-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                <h1 className="text-2xl font-bold mb-2">Application Configuration Error</h1>
                <p className="text-muted-foreground max-w-md">
                    Firebase services are not available. Please ensure your Firebase project is correctly configured (API keys, Project ID, etc.) in your environment variables.
                </p>
            </div>
        ) : children}
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

// Helper to safely get current search params, only on client side
const useClientSearchParams = () => {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setParams(new URLSearchParams(window.location.search));
    }
  }, [typeof window !== 'undefined' ? window.location.search : '']); // Re-run if search string changes
  return params;
};
