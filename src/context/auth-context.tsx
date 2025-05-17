
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
  // getIdToken, // Not used in current frontend-only setup
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
  // writeBatch, // Not used
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Kept for consistency if tests rely on it

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
  if (typeof timestamp === 'object' && typeof timestamp.seconds === 'number' && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  return null;
};

const convertUserDocumentTimestamps = (userData: any): User => {
  return {
    ...userData,
    createdAt: convertTimestampToISO(userData.createdAt),
    updatedAt: convertTimestampToISO(userData.updatedAt),
  } as User;
};

// Fetches or creates a user profile in Firestore
const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB (firestoreDb) is not available. Cannot proceed.");
    return null;
  }
  const { uid, email, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Partial<User> & { id: string; userId: string; email: string | null; updatedAt: any; createdAt?: any; };
    const isCreatorAdminEmail = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        id: uid,
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    } else {
      dataToSave = {
        id: uid,
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isCreatorAdminEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdminEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }
    // Ensure all optional fields intended for profile completion are explicitly null if empty or not provided
    dataToSave.username = dataToSave.username || null;
    dataToSave.role = dataToSave.role || (isCreatorAdminEmail ? "Admin" : "Author");
    dataToSave.phoneNumber = dataToSave.phoneNumber || null;
    dataToSave.institution = dataToSave.institution || null;
    dataToSave.researcherId = dataToSave.researcherId || null;

    await setDoc(userDocRef, dataToSave, { merge: true });
    const userDocAfterSave = await getDoc(userDocRef);

    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      const appUser = convertUserDocumentTimestamps({ ...finalData, id: userDocAfterSave.id });
      return appUser;
    }
    console.error(`AuthContext (ensureFirestoreUserProfile): CRITICAL - Failed to fetch profile after save for ${uid}.`);
    return null;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}"`, error.code, error);
    if (error.code === 'permission-denied') {
        toast({ variant: "destructive", title: "Firestore Permission Error", description: "Could not save or access your profile data due to database permissions. Please contact support.", duration: 10000});
    }
    throw error;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true); // Start with loading true
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
  const router = useRouter();
  const pathname = usePathname();

  // Check for Firebase SDK availability ONCE
  const firebaseServicesAvailable = firebaseAuth && firestoreDb;

  useEffect(() => {
    setIsMounted(true);
    if (!firebaseServicesAvailable) {
      setLoading(false); // Stop loading if Firebase isn't even available
      return; // Don't proceed with onAuthStateChanged if SDKs are null
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth!, async (firebaseUser: FirebaseUser | null) => {
      setActiveSocialLoginProvider(null);
      if (firebaseUser) {
        let appUser: User | null = null;
        try {
          appUser = await ensureFirestoreUserProfile(firebaseUser);
        } catch (profileError: any) {
            // Error is logged in ensureFirestoreUserProfile
        }

        if (appUser) {
          const finalIsAdmin = appUser.isAdmin === true;
          setUser(appUser);
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }

          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null;
              }
            }
            const targetDashboard = finalIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath || targetDashboard);
          } else if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            if (redirectAfterLoginPath === '/user/profile/settings') redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH;
            router.push(redirectAfterLoginPath);
          } else {
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(pathname) || pathname.startsWith('/author/');

            if (finalIsAdmin) {
              if (onNonAdminEntryPoint && !pathname.startsWith('/admin/') && pathname !== ADMIN_DASHBOARD_PATH) {
                router.push(ADMIN_DASHBOARD_PATH);
              }
            } else if (onAuthPages) {
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(userDashboard);
            }
          }
        } else {
          toast({ variant: "destructive", title: "Critical Profile Sync Error", description: "Could not load or create your user profile in our database. Please try logging out and logging in again. If the problem persists, contact support.", duration: 10000 });
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else {
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook, firebaseServicesAvailable]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for login.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
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
            throw new Error(`User profile incomplete for username '${identifier}' (missing email).`);
          }
        } else {
            // Keep emailToLogin as the original identifier; Firebase will fail if it's not an email
        }
      } catch (dbError: any) {
        setLoading(false);
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged handles success
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
      setLoading(false);
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for signup.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (data.fullName && data.fullName !== cred.user.displayName) {
          await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      // Pass signup data to ensureFirestoreUserProfile, onAuthStateChanged will call it.
      // Forcing an immediate profile creation here for clarity.
      await ensureFirestoreUserProfile(cred.user, data);
      toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
      // onAuthStateChanged will handle redirect.
    } catch (error: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const logout = async () => {
    if (!firebaseAuth) {
        toast({variant: "destructive", title: "Service Error", description: "Authentication service not available."});
        return;
    }
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      toast({title: "Logged Out", description: "You have been successfully logged out."});
      // onAuthStateChanged will set user to null and loading to false.
      // Router push handled by onAuthStateChanged or ProtectedRoute based on null user.
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again.`;
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
      const msg = `${providerName} Sign-In service not available (Firebase Auth).`;
      toast({variant: "destructive", title: "Login Error", description: msg});
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) {
      throw new Error("Authentication service not available for password reset.");
    }
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

    if (updatedData.displayName !== undefined) {
      firebaseAuthUpdatePayload.displayName = String(updatedData.displayName || "");
      updatePayloadFS.displayName = String(updatedData.displayName || "");
    }
    if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username || null;
    if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || null;
    if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber || null;
    if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution || null;
    if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId || null;
    
    try {
      if (updatePayloadFS.username && updatePayloadFS.username !== user.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", updatePayloadFS.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatePayloadFS.phoneNumber && updatePayloadFS.phoneNumber !== user.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", updatePayloadFS.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (phoneSnap.docs.some(doc => doc.id !== user.id)) {
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      const updatedUserFromDbSnap = await getDoc(userDocRef);
      let finalUpdatedUser: User | null = null;

      if (updatedUserFromDbSnap.exists()) {
        finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        // Optimistic update of local state
        setUser(finalUpdatedUser);
        setIsAdminUser(finalUpdatedUser.isAdmin === true);
      } else {
         throw new Error("Profile update seemed to succeed but could not re-fetch profile.");
      }
      
      toast({ title: "Success", description: "Your profile has been updated." });

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            let redirectPathAfterLogin = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin');
            if (redirectPathAfterLogin === AUTHOR_PROFILE_SETTINGS_PATH) redirectPathAfterLogin = null;
            
            const targetDashboard = finalUpdatedUser.isAdmin 
                ? ADMIN_DASHBOARD_PATH 
                : (finalUpdatedUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectPathAfterLogin || targetDashboard);
        }
      }
      return finalUpdatedUser;

    } catch(error: any) {
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        throw error;
    } finally {
        setLoading(false);
    }
  };

  // Render a clear error message if Firebase services are not available
  if (isMounted && !firebaseServicesAvailable) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle text-destructive mb-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        <h1 className="text-2xl font-bold mb-2 text-destructive">Application Configuration Error</h1>
        <p className="text-muted-foreground max-w-md">
          Firebase services (Authentication or Firestore) are not available.
          Please ensure your Firebase project is correctly configured in your environment variables
          (e.g., <code>NEXT_PUBLIC_FIREBASE_API_KEY</code> in <code>.env.local</code>) and that these services are enabled in your Firebase console.
          Restart your development server after correcting the configuration.
        </p>
      </div>
    );
  }
  
  if (!isMounted || (loading && !user && (!firebaseAuth || firebaseAuth.currentUser === null))) {
       return ( 
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
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
