
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
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Admin for testing

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

const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
    return null;
  }
  const { uid, email, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Partial<User> & { id: string; email: string | null; userId: string; updatedAt: any; createdAt?: any; };
    const isCreatorAdminEmail = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        id: uid,
        userId: uid,
        email: email, // Always update with the latest from Firebase Auth
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true,
        // createdAt is preserved from existing if present, otherwise set for new profiles
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

    // Ensure optional fields are null if empty or not provided, rather than undefined
    dataToSave.username = dataToSave.username === "" ? null : dataToSave.username;
    dataToSave.phoneNumber = dataToSave.phoneNumber === "" ? null : dataToSave.phoneNumber;
    dataToSave.institution = dataToSave.institution === "" ? null : dataToSave.institution;
    dataToSave.researcherId = dataToSave.researcherId === "" ? null : dataToSave.researcherId;
    if (!dataToSave.role) dataToSave.role = isCreatorAdminEmail ? "Admin" : "Author"; // Default role

    await setDoc(userDocRef, dataToSave, { merge: true });
    const userDocAfterSave = await getDoc(userDocRef);

    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      const appUser = convertUserDocumentTimestamps({
        ...finalData,
        id: userDocAfterSave.id,
        isAdmin: finalData.isAdmin === true,
      });
      return appUser;
    }
    console.error(`AuthContext (ensureFirestoreUserProfile): Critical - Failed to fetch profile after save for ${uid}.`);
    return null;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}:`, error.message, error.code, error);
    toast({
      variant: "destructive",
      title: "Critical Profile Sync Error",
      description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`,
      duration: 10000
    });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true); // Start true until auth state is resolved
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
         setLoading(false);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setActiveSocialLoginProvider(null); // Reset social login progress on any auth change

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          const determinedIsAdmin = appUser.isAdmin === true;
          setUser(appUser);
          setIsAdminUser(determinedIsAdmin);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;
          
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }

          if (!isProfileComplete) {
            if (pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
              if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            }
          } else { // Profile IS complete
            // If we were in the 'completingProfile' flow and profile is now complete, clear the flag.
            // The primary redirect after saving the profile should be handled by updateUserProfile.
            // This block mainly handles initial login redirects or if user lands on settings with a complete profile.
            if (completingProfileStorageFlag === 'true') {
                if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
            }

            if (redirectAfterLoginPath) {
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              // Correct potentially stale /user/ path to /author/ path
              if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH;
              }
              // Avoid redirecting to profile settings if profile is now complete and that was the target
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH && isProfileComplete) {
                 // Do nothing, let default dashboard logic take over
              } else {
                router.push(redirectAfterLoginPath);
                setLoading(false); // Done with initial auth processing
                return; // Redirection handled
              }
            }
            
            // Default redirection logic if not handled by profile completion in updateUserProfile or redirectAfterLoginPath
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(pathname) || pathname.startsWith('/author/');

            if (determinedIsAdmin) {
              if (onNonAdminEntryPoint && pathname !== ADMIN_DASHBOARD_PATH && !pathname.startsWith("/admin/")) {
                router.push(ADMIN_DASHBOARD_PATH);
              }
            } else { // Not an admin
              if (onAuthPages) {
                router.push(appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              }
            }
          }
        } else { // appUser is null from ensureFirestoreUserProfile (critical Firestore error)
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // firebaseUser is null
        setUser(null);
        setIsAdminUser(false);
        // Don't clear redirectAfterLogin here, ProtectedRoute might need it
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
      }
      setLoading(false); // Auth processing complete
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook]);


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
          setLoading(false);
          throw new Error(`No user found with username '${identifier}'. Please check your username or try logging in with email.`);
        }
      } catch (dbError: any) {
        setLoading(false);
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and redirecting.
      // setLoading(false) will be handled by onAuthStateChanged
    } catch (error) {
      setLoading(false); // Set loading false on error
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
      const msg = "Authentication or Database service not available for signup.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // Username and phone number uniqueness should be checked server-side via rules or Cloud Functions for production.
    // For client-side check before signup (as currently implemented):
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
    } catch (validationError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Signup Validation Failed", description: validationError.message });
        throw validationError;
    }
    
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (data.fullName && data.fullName !== cred.user.displayName) {
          await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      // Call ensureFirestoreUserProfile with signup data. onAuthStateChanged will pick up the new user.
      // Passing data here helps initialize the Firestore doc correctly on first creation.
      await ensureFirestoreUserProfile(cred.user, data); 
      toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
      // setLoading(false) handled by onAuthStateChanged
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
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // setUser(null) and setIsAdminUser(false) will be handled by onAuthStateChanged
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      toast({title: "Logged Out", description: "You have been successfully logged out."});
      router.push(HOME_PATH); 
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
        setLoading(false);
    }
  };
  
  const handleSocialLoginError = (error: any, providerName: string) => {
    setLoading(false);
    setActiveSocialLoginProvider(null);
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName} Login Error`;
    let toastMessage = `Could not sign in with ${providerName}. Please try again.`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again. If issues persist, try a different browser or disable extensions that might interfere.`;
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
      // onAuthStateChanged will handle setting user, profile creation/fetching and redirecting.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) handled by onAuthStateChanged or error handler
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

    if (updatedData.displayName !== undefined && updatedData.displayName !== user.displayName) {
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

      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined) {
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      const updatedUserFromDbSnap = await getDoc(userDocRef);
      let finalUpdatedUser: User | null = null;

      if (updatedUserFromDbSnap.exists()) {
        finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        // Optimistically update local state immediately
        setUser(finalUpdatedUser);
        setIsAdminUser(finalUpdatedUser.isAdmin === true);
      } else {
         // Fallback or error if doc doesn't exist after update, though unlikely
         finalUpdatedUser = { ...user, ...updatePayloadFS, displayName: firebaseAuthUpdatePayload.displayName || user.displayName } as User;
         setUser(finalUpdatedUser);
      }
      
      toast({ title: "Success", description: "Your profile has been updated." });

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            const redirectPathAfterLogin = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin'); // Clear as it's used or default will apply

            let targetPath = redirectPathAfterLogin;
            if (targetPath === AUTHOR_PROFILE_SETTINGS_PATH) targetPath = null; // Avoid redirecting back to settings

            const defaultDashboard = finalUpdatedUser.isAdmin 
                ? ADMIN_DASHBOARD_PATH 
                : (finalUpdatedUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            
            router.push(targetPath || defaultDashboard);
        }
      }
      setLoading(false);
      return finalUpdatedUser;

    } catch(error: any) {
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        setLoading(false);
        throw error;
    }
  };

  // Initial loading screen logic
  if (!isMounted || (loading && !user && (!firebaseAuth?.currentUser || firebaseAuth?.currentUser === null))) {
       return (
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
            </div>
        );
  }
  // Error if Firebase services aren't available after mount
  if (isMounted && (!firebaseAuth || !firestoreDb)) {
     return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle text-destructive mb-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            <h1 className="text-2xl font-bold mb-2 text-destructive">Application Configuration Error</h1>
            <p className="text-muted-foreground max-w-md">
                Firebase services are not available. Please ensure your Firebase project is correctly configured (API keys, Project ID, etc.) in your environment variables and that Firestore is enabled. Check browser console for details.
            </p>
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
