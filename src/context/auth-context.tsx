
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction, useContext } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import {
  auth as firebaseAuth,
  db as firestoreDb,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider,
} from '@/lib/firebase'; // Ensure firebase.ts uses NEXT_PUBLIC_ variables
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

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com'; // For dynamic admin creation on signup
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // For hardcoded admin email check

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

const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB (firestoreDb) is not available.");
    return null;
  }
  const { uid, email, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  let finalUserToSet: User | null = null;

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdminEmail = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as Partial<User>; // Use Partial<User> for flexibility
      // Prioritize existing Firestore data for core profile fields, update with new auth data or signup data if provided
      const dataToUpdate: Partial<User> = {
        email: email, // Always update email from auth
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        // Keep existing core profile fields unless explicitly being updated by profileDataFromSignup
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || (isCreatorAdminEmail ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || existingData.isAdmin === true, // Ensure admin status persists or is set for creator
        isSuspended: existingData.isSuspended === true,
        updatedAt: serverTimestamp(),
        // Ensure createdAt is only set if it's a new document conceptually (though merge=true handles this)
        ...(existingData.createdAt ? {} : { createdAt: serverTimestamp() }),
        userId: uid, // Ensure userId field matches UID
      };
      
      // Clean undefined values to avoid Firestore errors, set to null instead for fields that allow it
      for (const key in dataToUpdate) {
        if (dataToUpdate[key as keyof typeof dataToUpdate] === undefined) {
           dataToUpdate[key as keyof typeof dataToUpdate] = null as any;
        }
      }
      // Remove createdAt if we are only merging updates and it exists
      if (existingData.createdAt) {
        delete dataToUpdate.createdAt;
      }


      await setDoc(userDocRef, dataToUpdate, { merge: true });
      const updatedSnap = await getDoc(userDocRef); // Re-fetch to get server timestamps
      if (updatedSnap.exists()) {
        finalUserToSet = { id: uid, ...updatedSnap.data() } as User;
      }
    } else {
      // New user document
      const dataToSave: Omit<User, 'id'> & { createdAt: any, updatedAt: any } = {
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
      await setDoc(userDocRef, dataToSave);
      const newSnap = await getDoc(userDocRef); // Re-fetch to get server timestamps
      if (newSnap.exists()) {
        finalUserToSet = { id: uid, ...newSnap.data() } as User;
      }
    }

    if (finalUserToSet) {
      // Convert Firestore Timestamps to ISO strings for client-side state
      return {
        ...finalUserToSet,
        createdAt: convertTimestampToISO(finalUserToSet.createdAt),
        updatedAt: convertTimestampToISO(finalUserToSet.updatedAt),
      };
    }
    console.error(`AuthContext (ensureFirestoreUserProfile): Failed to get user document for ${uid} after save/update.`);
    return null;

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}"`, error.code, error);
    if (error.code === 'permission-denied') {
        toast({ variant: "destructive", title: "Firestore Permission Error", description: "Could not save or access your profile data due to database permissions. Please check your Firestore rules.", duration: 10000});
    }
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isSocialLoginInProgress, setIsSocialLoginInProgress] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return; // Don't run auth logic until component is mounted

    if (!firebaseAuth || !firestoreDb) {
      // This case should be handled by the early return below if Firebase SDK failed to initialize
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setIsSocialLoginInProgress(null); // Reset social login flag on any auth state change
      if (firebaseUser) {
        let appUser: User | null = null;
        try {
          // Pass form data only if it's a signup context (not implemented this way currently, relies on update after)
          appUser = await ensureFirestoreUserProfile(firebaseUser);
        } catch (profileError: any) {
           // Error already logged in ensureFirestoreUserProfile
        }

        if (appUser) {
          setUser(appUser);
          const finalIsAdmin = appUser.isAdmin === true || appUser.email === MOCK_ADMIN_EMAIL || appUser.email === ADMIN_CREATOR_EMAIL;
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false);

          // --- Redirection Logic ---
          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }
          
          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);

          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            // User just completed their profile
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectAfterLoginPath === '/user/profile/settings') {
                localStorage.removeItem('redirectAfterLogin'); // Clear it if it was pointing to profile settings
                redirectAfterLoginPath = null;
              }
            }
            const targetDashboard = finalIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath || targetDashboard);
          } else if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            // Correct old /user/ paths if stored
            if (redirectAfterLoginPath.startsWith('/user/')) {
                redirectAfterLoginPath = redirectAfterLoginPath.replace('/user/', '/author/');
            }
            if (redirectAfterLoginPath === '/profile/settings') redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH;
            router.push(redirectAfterLoginPath);
          } else {
            // Default redirection if no specific path or profile completion pending
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(pathname) || pathname.startsWith('/author/');

            if (finalIsAdmin) {
              if ((onNonAdminEntryPoint && !pathname.startsWith('/admin/')) || onAuthPages) {
                if(pathname !== ADMIN_DASHBOARD_PATH) router.push(ADMIN_DASHBOARD_PATH);
              }
            } else if (onAuthPages) {
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(userDashboard);
            }
          }
        } else {
          // Failed to fetch/create Firestore profile
          toast({ variant: "destructive", title: "Critical Profile Sync Error", description: "Could not load or create your user profile in our database. Please try logging out and logging in again. If the problem persists, contact support.", duration: 10000 });
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else {
        // No Firebase user
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, pathname, router, searchParamsFromHook]); // searchParamsFromHook is from useNextSearchParams


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for login.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      // Assume it's a username, try to find email in Firestore
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
          } else {
             throw new Error(`User profile incomplete for username '${identifier}' (missing email). Login with email instead.`);
          }
        } else {
           // No user found with this username, proceed to Firebase with original identifier
           // Firebase will return 'auth/user-not-found' or 'auth/invalid-credential' if it's not an email
        }
      } catch (dbError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Login Error", description: `Error during username lookup: ${dbError.message}. Try logging in with email.` });
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged handles success and setting user/admin state
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
      throw new Error(errorMessage); // Re-throw to be caught by form
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for signup.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    
    // Client-side uniqueness checks before Firebase account creation
    try {
      const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", data.username));
      const usernameSnap = await getDocs(usernameQuery);
      if (!usernameSnap.empty) {
        throw new Error("Username already taken. Please choose another one.");
      }

      if (data.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }
    } catch(validationError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Signup Validation Failed", description: validationError.message });
        throw validationError; // Re-throw for form to catch
    }
    
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (data.fullName && data.fullName !== cred.user.displayName) {
          await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      // Pass signup data to ensureFirestoreUserProfile, onAuthStateChanged will call it when Firebase user is set
      // Forcing an immediate profile creation here to ensure data is available for first redirect
      await ensureFirestoreUserProfile(cred.user, data);
      toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
      // onAuthStateChanged will handle redirect and setting user/admin states
    } catch (error: any) {
      let errorMessage = "An unknown error occurred during signup.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage); // Re-throw for form to catch
    } finally {
      setLoading(false);
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
      setUser(null); // Explicitly set user to null
      setIsAdminUser(false);
      router.push(HOME_PATH); // Redirect to home after logout
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
        setLoading(false);
    }
  };
  
  const handleSocialLoginError = (error: any, providerName: string) => {
    setIsSocialLoginInProgress(null); // Reset this specific flag
    // setLoading(false); // This is handled by onAuthStateChanged or the calling function's finally block
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
            duration: 7000,
          });
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      const msg = `${providerName} Sign-In service not available (Firebase Auth).`;
      toast({variant: "destructive", title: "Login Error", description: msg});
      return;
    }
    setLoading(true);
    setIsSocialLoginInProgress(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
       // setLoading(false); // Managed by onAuthStateChanged now
       // setIsSocialLoginInProgress(null); // Reset by onAuthStateChanged
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) {
      throw new Error("Authentication service not available for password reset.");
    }
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
    } catch (error: any) {
        throw error; // Re-throw for form to handle
    } finally {
        setLoading(false);
    }
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
      firebaseAuthUpdatePayload.displayName = String(updatedData.displayName || user.displayName || "");
      updatePayloadFS.displayName = String(updatedData.displayName || user.displayName || "");
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

      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      const updatedUserFromDbSnap = await getDoc(userDocRef);
      let finalUpdatedUser: User | null = null;

      if (updatedUserFromDbSnap.exists()) {
        const rawData = { id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() };
        finalUpdatedUser = {
          ...rawData,
          createdAt: convertTimestampToISO(rawData.createdAt),
          updatedAt: convertTimestampToISO(rawData.updatedAt),
        } as User;
        
        setUser(finalUpdatedUser); // Optimistic update of local state
        setIsAdminUser(finalUpdatedUser.isAdmin === true); // Update admin state
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

            if (redirectPathAfterLogin === AUTHOR_PROFILE_SETTINGS_PATH || redirectPathAfterLogin === '/user/profile/settings') {
              redirectPathAfterLogin = null; // Don't redirect back to settings
            }
            
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

  // Initial check to see if Firebase SDKs are even available
  if (!firebaseAuth || !firestoreDb) {
    if (isMounted) { // Only show error if mounted to avoid SSR issues with this direct render
        return (
            <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: '20px', textAlign: 'center', fontFamily: 'sans-serif'}}>
                <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
                <h1 className="text-2xl font-bold mb-2 text-destructive">Application Configuration Error</h1>
                <p className="text-muted-foreground max-w-md">
                    Firebase services (Authentication or Firestore) are not properly configured or available.
                    Please ensure your Firebase project setup and environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) are correct.
                    Restart your application after verifying the configuration.
                </p>
            </div>
        );
    }
    // During SSR or if not mounted, return minimal loader or null to prevent further errors
    return <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh'}}><LoadingSpinner size={48}/></div>;
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
        isSocialLoginInProgress: isSocialLoginInProgress !== null,
    }}>
       {!isMounted || (loading && !user && !firebaseAuth?.currentUser) ? ( // Show global loading only if not mounted or truly in initial auth check
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
            </div>
        ) : (!firebaseAuth || !firestoreDb) && isMounted ? ( // This check is now at the top, this part might be redundant but kept for safety
             <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: '20px', textAlign: 'center', fontFamily: 'sans-serif'}}>
                <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
                <h1 className="text-2xl font-bold mb-2 text-destructive">Application Configuration Error</h1>
                <p className="text-muted-foreground max-w-md">
                    Firebase services could not be initialized. Please check your setup.
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
