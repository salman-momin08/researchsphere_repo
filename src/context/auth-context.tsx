
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

const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Retained for existing logic
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

// This function ensures a user profile document exists in Firestore.
// It creates one with defaults if it's the user's first time or if crucial data is missing.
const ensureFirestoreUserProfile = async (
  uid: string,
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> & { isSocialSignIn?: boolean }
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB instance is not available. Cannot proceed.");
    toast({ variant: "destructive", title: "Critical Error", description: "Database service not configured. Please contact support.", duration: 10000 });
    return null;
  }

  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdminEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL;
    const isMockAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL; // For existing logic

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    const baseProfileData: Partial<User> = {
      email: firebaseUser.email,
      displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || (profileDataFromSignup?.isSocialSignIn && firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
      photoURL: firebaseUser.photoURL || null,
      // Initialize potentially incomplete fields to null for new profiles
      username: profileDataFromSignup?.username || null,
      role: profileDataFromSignup?.role || (isCreatorAdminEmail || isMockAdminByEmail ? "Admin" : "Author"),
      phoneNumber: profileDataFromSignup?.phoneNumber || null,
      institution: profileDataFromSignup?.institution || null,
      researcherId: profileDataFromSignup?.researcherId || null,
      isAdmin: isCreatorAdminEmail || isMockAdminByEmail, // Default based on email
    };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        // Start with existing data
        ...existingData,
        // Overlay with fresh data from Firebase Auth (email, displayName, photoURL might change)
        email: firebaseUser.email,
        displayName: baseProfileData.displayName, // Prefer fresh displayName
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // Only update these if they were explicitly part of a signup/update that reached this point
        // OR if they are currently null/undefined in existingData and baseProfileData has a default
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || baseProfileData.role), // Ensure role is set
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || isMockAdminByEmail || existingData.isAdmin || false, // Ensure isAdmin is boolean
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt || serverTimestamp(), // Preserve original createdAt
      };
    } else {
      // New user document
      dataToSave = {
        userId: uid,
        ...baseProfileData, // Defaults from above
        // Explicitly set defaults for required fields if not in baseProfileData (though they should be)
        username: baseProfileData.username || null,
        role: baseProfileData.role || "Author",
        phoneNumber: baseProfileData.phoneNumber || null,
        isAdmin: baseProfileData.isAdmin || false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // Ensure no undefined fields are sent to Firestore
    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
      if (dataToSave[key] === undefined) {
        (dataToSave as any)[key] = null;
      }
    });
    
    // console.log("AuthContext (ensureFirestoreUserProfile): Data to save for UID", uid, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge:true to be safe for both create and update scenarios

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      const finalIsAdmin = finalData.isAdmin === true; // Strict boolean check
      
      // Convert Timestamps to ISO strings for the User object in context
      const convertTimestamp = (ts: any) => ts instanceof Timestamp ? ts.toDate().toISOString() : (ts || null);

      return {
        id: userDocAfterSave.id,
        ...finalData,
        isAdmin: finalIsAdmin,
        createdAt: convertTimestamp(finalData.createdAt),
        updatedAt: convertTimestamp(finalData.updatedAt),
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
        // Allow auth to proceed but profile sync will fail; ensureFirestoreUserProfile handles this.
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      // console.log("AuthContext (onAuthStateChanged): FirebaseUser:", firebaseUser?.uid || "null");

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
          // console.log(`AuthContext (onAuthStateChanged): Profile complete: ${isProfileComplete}. Username: ${appUser.username}, Role: ${appUser.role}, Phone: ${appUser.phoneNumber}`);

          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }
          // console.log(`AuthContext (onAuthStateChanged): redirectAfterLoginPath from localStorage: ${redirectAfterLoginPath}`);
          
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
            if (pathname !== targetPath) router.push(targetPath);
          } else if (redirectAfterLoginPath) {
            // console.log(`AuthContext (onAuthStateChanged): Using redirectAfterLoginPath: ${redirectAfterLoginPath}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            if (pathname !== redirectAfterLoginPath) router.push(redirectAfterLoginPath);
          } else {
            const onNonAdminEntryPoint = ['/login', '/signup', '/forgot-password', '/'].includes(pathname);
            if (determinedIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin')) {
              // console.log("AuthContext (onAuthStateChanged): Admin on non-admin entry point, redirecting to /admin/dashboard");
              if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
            } else if (!determinedIsAdmin && (pathname === '/login' || pathname === '/signup')) {
               // console.log("AuthContext (onAuthStateChanged): Non-admin on auth page, redirecting to /");
               if (pathname !== '/') router.push('/');
            }
            // If none of the above, user stays on current page.
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
  }, [isMounted, pathname, router, searchParamsFromHook]); // searchParamsFromHook is now stable as it's from top-level


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      // Assume it's a username, try to find email in Firestore
      // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email.`;
            // console.error("AuthContext (login):", errorMsg);
            setLoading(false); // Added this
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
           // console.log(`AuthContext (login): No user found with username '${identifier}'. Proceeding with identifier as email.`);
           // If not found as username, proceed with original identifier (could be an email that simply lacks '@' for a moment)
           // Or, more strictly, throw "Invalid email/username or password."
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        console.error("AuthContext (login):", errorMsg);
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // toast({title: "Login Successful", description: "Welcome back!"}); // onAuthStateChanged will handle visual feedback if needed
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
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
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

    // Firestore uniqueness checks (moved here to happen before Firebase Auth user creation)
    try {
      const usersRef = collection(firestoreDb, "users");
      // Check username uniqueness
      if (data.username) {
        const usernameQuery = query(usersRef, where("username", "==", data.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Check phone number uniqueness
      if (data.phoneNumber) {
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
        // Pass signup data to ensureFirestoreUserProfile for Firestore document creation
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, data);
        if (!appUser) {
          // This is a critical failure, as user exists in Auth but not Firestore
          throw new Error("Failed to create Firestore profile after signup. Your account was created but profile data could not be saved.");
        }
        // toast({title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted."});
        // onAuthStateChanged will handle further actions and redirects
      } catch (profileError: any) {
        // If ensureFirestoreUserProfile itself throws or returns null and this catch is hit
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
        // User still exists in Firebase Auth, might be handled by onAuthStateChanged to prompt profile completion
      }
    }
     // setLoading(false) is handled by onAuthStateChanged
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // Toast and router.push handled by onAuthStateChanged when user becomes null
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      // setLoading, setUser, setIsAdminUser are handled by onAuthStateChanged
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again. This can sometimes happen if you switch browser tabs too quickly.`;
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
      // onAuthStateChanged will handle Firestore profile creation/fetch and further actions.
      // toast({title: `${providerName} Sign-In Successful!`, description: "Welcome!"});
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
      // Firestore uniqueness checks
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

      // Update Firebase Auth profile (only displayName if changed)
      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      
      // Prepare data for Firestore update
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: any = { updatedAt: serverTimestamp() };

      // Add only changed and defined fields to the payload
      (Object.keys(updatedData) as Array<keyof typeof updatedData>).forEach(key => {
          if (updatedData[key] !== undefined && user[key as keyof User] !== updatedData[key]) {
              updatePayloadFS[key] = updatedData[key] === "" ? null : updatedData[key]; // Convert empty strings to null
          }
      });
      // console.log("AuthContext (updateUserProfile): Update payload for Firestore:", updatePayloadFS);
      if (Object.keys(updatePayloadFS).length > 1) { // if more than just updatedAt
        await updateDoc(userDocRef, updatePayloadFS);
      }
      
      // Refetch the user from Firestore to get the most up-to-date data including converted timestamps
      const updatedUserFromDb = await ensureFirestoreUserProfile(user.id, firebaseAuth.currentUser, {});
      
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Update local auth context state immediately
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        
        toast({ title: "Success", description: "Your profile has been updated." });

        // Handle redirection if profile was just completed
        const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        if (isProfileNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
            // console.log("AuthContext (updateUserProfile): Profile now complete, handling redirect.");
            localStorage.removeItem('completingProfile');
            const redirectPath = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin');
            const targetPath = redirectPath || (updatedUserFromDb.isAdmin ? '/admin/dashboard' : '/');
            if (pathname !== targetPath) router.push(targetPath);
        }
        return updatedUserFromDb;
      } else {
        throw new Error("Failed to refetch profile from Firestore after update.");
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
      {children}
    </AuthContext.Provider>
  );
};
