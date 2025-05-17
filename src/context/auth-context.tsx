
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
const MOCK_ADMIN_EMAIL = 'admin@example.com';

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
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt' | 'userId'>>) => Promise<User | null >;
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

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdmin = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;
    let finalUserData: User;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as Partial<User>;
      const dataToUpdate: Partial<User> = {
        email: email || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || existingData.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? (profileDataFromSignup.role || existingData.role || (isCreatorAdmin ? "Admin" : "Author")) : (existingData.role || (isCreatorAdmin ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || existingData.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || existingData.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || existingData.researcherId || null) : (existingData.researcherId || null),
        isAdmin: isCreatorAdmin || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true, // Persist suspension
        updatedAt: serverTimestamp(),
        userId: uid,
      };
      
      // Ensure createdAt is not overwritten if it exists
      if (existingData.createdAt) {
        dataToUpdate.createdAt = existingData.createdAt; // Keep existing timestamp
      } else {
        dataToUpdate.createdAt = serverTimestamp();
      }

      await updateDoc(userDocRef, dataToUpdate);
      
      finalUserData = {
        id: uid,
        ...existingData, // Start with existing data
        ...dataToUpdate, // Override with new/updated values
        createdAt: convertTimestampToISO(dataToUpdate.createdAt instanceof Timestamp ? dataToUpdate.createdAt : existingData.createdAt),
        updatedAt: new Date().toISOString(), // Optimistic update for updatedAt
      } as User;

    } else {
      const dataToSave: Omit<User, 'id'> & { createdAt: any, updatedAt: any } = {
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isCreatorAdmin ? "Admin" : (profileDataFromSignup?.role || "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdmin,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userDocRef, dataToSave, { merge: true });
      const newSnap = await getDoc(userDocRef); // Re-fetch to get server timestamps
      if (!newSnap.exists()) throw new Error("Failed to create user document after setDoc.");
      const rawData = { id: uid, ...newSnap.data() } as any;
      finalUserData = {
        ...rawData,
        createdAt: convertTimestampToISO(rawData.createdAt),
        updatedAt: convertTimestampToISO(rawData.updatedAt),
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
  const [isSocialLoginProvider, setIsSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) {
      if (isMounted && !firebaseAuth) setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setIsSocialLoginProvider(null);
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
          
          console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${pathname}, IsAdmin: ${appUser.isAdmin}, ProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}`);

          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            console.log(`AuthContext: Profile incomplete for ${appUser.email}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            console.log(`AuthContext: Profile complete for ${appUser.email} and on settings page with flag. Clearing flags and redirecting.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH) { // Clear if it was the intended redirect
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null; 
              }
            }
            const targetDashboard = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath || targetDashboard);
          } else if (redirectAfterLoginPath) {
            console.log(`AuthContext: Handling redirectAfterLoginPath: ${redirectAfterLoginPath} for ${appUser.email}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            let correctedRedirectPath = redirectAfterLoginPath;
            if (correctedRedirectPath === '/user/profile/settings' || correctedRedirectPath === '/profile/settings') {
                correctedRedirectPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`; 
            } else if (correctedRedirectPath.startsWith('/user/')) {
                 correctedRedirectPath = correctedRedirectPath.replace('/user/', '/author/');
            }
            
            if (appUser.isAdmin && correctedRedirectPath.startsWith('/author/')) {
                router.push(ADMIN_DASHBOARD_PATH);
            } else {
                router.push(correctedRedirectPath);
            }
          } else {
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === HOME_PATH || pathname === AUTHOR_PROFILE_SETTINGS_PATH;

            if (appUser.isAdmin) {
              if (onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                if(pathname !== ADMIN_DASHBOARD_PATH) router.push(ADMIN_DASHBOARD_PATH);
              }
            } else if (onAuthPages) {
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(userDashboard);
            }
          }
        } else {
          console.error("AuthContext: ensureFirestoreUserProfile returned null. Logging out Firebase user.");
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, router, pathname, searchParamsFromHook]); // Added searchParamsFromHook


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
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
             throw new Error(`Profile incomplete for username '${identifier}'. Try login with email.`);
          }
        } else {
           // Let Firebase handle it as a potentially non-existent email
        }
      } catch (dbError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Login Error", description: `Error during username lookup: ${dbError.message}. Try login with email.` });
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle redirect and user state
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
      // setLoading(false); // Managed by onAuthStateChanged
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    
    try {
      // Uniqueness checks (username, phone) before Firebase Auth creation
      if (data.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", data.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) throw new Error("Username already taken. Please choose another one.");
      }
      if (data.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty) throw new Error("Phone number already in use. Please use a different one.");
      }

      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (data.fullName && data.fullName !== cred.user.displayName) {
          await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      // ensureFirestoreUserProfile will be called by onAuthStateChanged, which will create the Firestore doc
      // Pass signupData to ensure it's used for initial profile creation
      await ensureFirestoreUserProfile(cred.user, data); 
      toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
      // onAuthStateChanged will handle redirect
    } catch (error: any) {
      let errorMessage = "An unknown error occurred during signup.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false); // Ensure loading is false if signup errors out before onAuthStateChanged fully processes
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
      // setUser(null) and setIsAdminUser(false) handled by onAuthStateChanged
      toast({title: "Logged Out", description: "You have been successfully logged out."});
      router.push(HOME_PATH);
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
        setLoading(false);
    }
  };
  
  const handleSocialLoginError = (error: any, providerName: string) => {
    setIsSocialLoginProvider(null); // Reset specific provider loading state
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName} Login Error`;
    let toastMessage = `Could not sign in with ${providerName}. Please try again.`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing. Please ensure popups are allowed and try again. If the issue persists, you might try an alternative sign-in method or check your browser settings.`;
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
    setIsSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
       // setLoading(false); // Managed by onAuthStateChanged
       // setIsSocialLoginProvider(null); // Reset by onAuthStateChanged if successful, or by handleSocialLoginError if error
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) {
      throw new Error("Authentication service not available.");
    }
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
    } catch (error: any) {
        throw error;
    } finally {
        setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt' | 'userId'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable.";
      toast({variant: "destructive", title: "Update Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    setLoading(true);

    const updatePayloadFS: any = { updatedAt: serverTimestamp() };
    let firebaseAuthUpdatePayload: { displayName?: string } = {};

    // Explicitly handle each field, setting to null if empty string
    if (updatedData.displayName !== undefined) {
      const newDisplayName = updatedData.displayName || "";
      firebaseAuthUpdatePayload.displayName = newDisplayName;
      updatePayloadFS.displayName = newDisplayName;
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
        const rawData = { id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() } as any;
        finalUpdatedUser = {
          ...rawData,
          createdAt: convertTimestampToISO(rawData.createdAt),
          updatedAt: convertTimestampToISO(rawData.updatedAt),
        } as User;
        
        setUser(finalUpdatedUser); // Optimistically update local state
        setIsAdminUser(finalUpdatedUser.isAdmin === true); // Update admin state
      } else {
         throw new Error("Profile update succeeded but could not re-fetch profile.");
      }
      
      toast({ title: "Success", description: "Your profile has been updated." });

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      let completingProfileStorageFlag: string | null = null;
      let redirectPathAfterLoginStore: string | null = null;

      if (typeof window !== 'undefined') {
        completingProfileStorageFlag = localStorage.getItem('completingProfile');
        redirectPathAfterLoginStore = localStorage.getItem('redirectAfterLogin');
      }

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        console.log("AuthContext (updateUserProfile): Profile now complete and 'completingProfile' flag was set. Redirecting.");
        if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            if (redirectPathAfterLoginStore === AUTHOR_PROFILE_SETTINGS_PATH) {
                 localStorage.removeItem('redirectAfterLogin');
                 redirectPathAfterLoginStore = null;
            }
        }
        const targetDashboard = finalUpdatedUser.isAdmin 
            ? ADMIN_DASHBOARD_PATH 
            : (finalUpdatedUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
        router.push(redirectPathAfterLoginStore || targetDashboard);
      }
      return finalUpdatedUser;

    } catch(error: any) {
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        throw error;
    } finally {
        setLoading(false);
    }
  };


  if (!isMounted) {
    return (
        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
          <LoadingSpinner size={48} />
          <p className="ml-3">Initializing Application...</p>
        </div>
    );
  }
  
  if ((!firebaseAuth || !firestoreDb) && isMounted) {
     return (
        <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: '20px', textAlign: 'center', fontFamily: 'sans-serif'}}>
            <h1 style={{fontSize: '1.5rem', color: '#D32F2F', marginBottom: '1rem'}}>Application Configuration Error</h1>
            <p style={{maxWidth: '600px', color: '#555'}}>
                Firebase services (Authentication or Firestore) could not be initialized.
                This is likely due to missing or incorrect Firebase configuration variables (<code>NEXT_PUBLIC_FIREBASE_...</code>)
                in your environment setup.
            </p>
            <p style={{maxWidth: '600px', color: '#555', marginTop: '0.5rem'}}>
                Please ensure these are correctly set in your <code>.env.local</code> file (for local development)
                AND in your Vercel project environment variables (for deployment). Restart the application after verification.
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
        isSocialLoginInProgress: isSocialLoginProvider !== null,
    }}>
       {!isMounted || (loading && !user && !firebaseAuth?.currentUser) ? ( // Show global loading only if not mounted or truly in initial auth check
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
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
