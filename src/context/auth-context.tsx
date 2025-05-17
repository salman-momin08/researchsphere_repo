
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction, useContext, useCallback } from 'react';
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
import LoadingSpinner from '@/components/shared/LoadingSpinner'; // Added import

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // For direct admin login simulation

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


const ensureFirestoreUserProfile = async (
  uid: string,
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
): Promise<User | null> => {
  if (!firestoreDb) {
    toast({ variant: "destructive", title: "Critical Error", description: "Database service not configured for profile management.", duration: 10000 });
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdminEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL;
    const isMockAdminEmail = firebaseUser.email === MOCK_ADMIN_EMAIL;

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; id?: string; };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log("AuthContext (ensureFirestoreUserProfile): Existing Firestore data for", uid, existingData);
      dataToSave = {
        ...existingData,
        id: uid, // Ensure ID is present
        email: firebaseUser.email, // Always update with latest from Firebase Auth
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // Prioritize existing Firestore data for these fields, only update if specifically from signup/update
        username: existingData.username || profileDataFromSignup?.username || null,
        role: existingData.role || profileDataFromSignup?.role || (isCreatorAdminEmail || isMockAdminEmail ? "Admin" : "Author"),
        phoneNumber: existingData.phoneNumber || profileDataFromSignup?.phoneNumber || null,
        institution: existingData.institution || profileDataFromSignup?.institution || null,
        researcherId: existingData.researcherId || profileDataFromSignup?.researcherId || null,
        isSuspended: existingData.isSuspended === true,
        isAdmin: isCreatorAdminEmail || isMockAdminEmail || existingData.isAdmin === true, // Prioritize creator/mock email for admin status
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
      };
    } else {
      // console.log("AuthContext (ensureFirestoreUserProfile): No existing Firestore doc for", uid, "Creating new one.");
      const defaultRole = (isCreatorAdminEmail || isMockAdminEmail) ? "Admin" : (profileDataFromSignup?.role || "Author");
      dataToSave = {
        id: uid,
        userId: uid, // Ensure userId is stored
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "User"),
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: defaultRole,
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isSuspended: false,
        isAdmin: isCreatorAdminEmail || isMockAdminEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }
    
    // Ensure no 'undefined' values are sent to Firestore, replace with 'null'
    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
        if (dataToSave[key] === undefined) {
            (dataToSave as any)[key] = null;
        }
        // Specifically for optional string fields, ensure empty strings from form become null in Firestore
        if (key !== 'isAdmin' && key !== 'isSuspended' && dataToSave[key] === "") {
            if (['username', 'phoneNumber', 'institution', 'researcherId', 'photoURL', 'displayName'].includes(key)) {
                (dataToSave as any)[key] = null;
            }
        }
    });
    // console.log("AuthContext (ensureFirestoreUserProfile): Data to save for", uid, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true });

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      const finalIsAdmin = finalData.isAdmin === true;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Fetched final data for ${uid}, isAdmin: ${finalIsAdmin}`);
      return {
        ...finalData,
        id: userDocAfterSave.id,
        isAdmin: finalIsAdmin, // Ensure this is derived correctly
        createdAt: convertTimestampToISO(finalData.createdAt),
        updatedAt: convertTimestampToISO(finalData.updatedAt),
      } as User;
    }
    // console.error("AuthContext (ensureFirestoreUserProfile): Document not found after save for", uid);
    return null;
  } catch (error: any) {
    // console.error(`AuthContext (ensureFirestoreUserProfile): Error for UID ${uid}:`, error.message, error.code, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Details: ${error.message}`, duration: 15000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true); // Start with loading true
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Call hook at top level

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    if (!firebaseAuth || !firestoreDb) {
      // console.warn("AuthContext: Firebase Auth or Firestore DB instance is not available. Client-side features may be limited.");
      setLoading(false); // Stop loading if Firebase isn't even available
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      setActiveSocialLoginProvider(null); // Reset active social provider on any auth state change

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser);

        if (appUser) {
          setUser(appUser);
          const currentIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(currentIsAdmin);
          setShowLoginModal(false); // Close login modal if it was open

          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }
          
          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.id}): isAdmin: ${currentIsAdmin}, isProfileComplete: ${isProfileComplete}, pathname: ${pathname}, redirectAfterLoginPath: ${redirectAfterLoginPath}, completingProfileStorageFlag: ${completingProfileStorageFlag}`);

          const onProfileSettingsPage = pathname === '/author/profile/settings';
          const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
          const nonAdminEntryPoints = ['/', '/login', '/signup', '/forgot-password', '/author/profile/settings'];


          if (!isProfileComplete && !onProfileSettingsPage) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            // console.log(`AuthContext: Profile incomplete for ${appUser.id}, redirecting to /author/profile/settings?complete=true`);
            router.push('/author/profile/settings?complete=true');
          } else if (isProfileComplete && onProfileSettingsPage && (searchParamsFromHook?.get('complete') === 'true' || completingProfileStorageFlag === 'true')) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            }
            let targetPath = redirectAfterLoginPath;
             if (!targetPath) {
                targetPath = currentIsAdmin ? '/admin/dashboard' : (appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard');
            }
            // console.log(`AuthContext: Profile just completed for ${appUser.id}, redirecting to ${targetPath}`);
            if (pathname !== targetPath) router.push(targetPath);
          } else if (redirectAfterLoginPath) {
             if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
             // console.log(`AuthContext: redirectAfterLoginPath found for ${appUser.id}: ${redirectAfterLoginPath}. Current pathname: ${pathname}`);
             if (pathname !== redirectAfterLoginPath) router.push(redirectAfterLoginPath);
          } else if (currentIsAdmin && nonAdminEntryPoints.some(p => pathname.startsWith(p)) && !pathname.startsWith('/admin/')) {
              // console.log(`AuthContext: Admin ${appUser.id} on non-admin entry point ${pathname}, redirecting to /admin/dashboard`);
              if (pathname !== '/admin/dashboard') router.push('/admin/dashboard');
          } else if (!currentIsAdmin && onAuthPages) {
              const userDashboard = appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard';
              // console.log(`AuthContext: Non-admin ${appUser.id} on auth page ${pathname}, redirecting to ${userDashboard}`);
              if (pathname !== userDashboard) router.push(userDashboard);
          }
          // If none of the above, user stays on current page.
        } else {
          // console.error("AuthContext: ensureFirestoreUserProfile returned null. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); // Critical failure to sync profile
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
      // console.error("AuthContext (login): Firebase Auth or Firestore DB not available.");
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
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
            setLoading(false);
            // console.error(`AuthContext (login): User profile incomplete (no email) for username '${identifier}'.`);
            throw new Error(`User profile incomplete for username '${identifier}'.`);
          }
        } else {
          setLoading(false);
          // console.warn(`AuthContext (login): No user found with username '${identifier}'.`);
          throw new Error(`No user found with username '${identifier}'.`);
        }
      } catch (dbError: any) {
        setLoading(false);
        // console.error(`AuthContext (login): Error during username lookup for '${identifier}':`, dbError);
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
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
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
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

    // Client-side check for username uniqueness before Firebase user creation
    if (data.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
            setLoading(false);
            toast({ variant: "destructive", title: "Signup Failed", description: "Username already taken. Please choose another one." });
            throw new Error("Username already taken. Please choose another one.");
        }
    }
    // Client-side check for phone number uniqueness
    if (data.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            toast({ variant: "destructive", title: "Signup Failed", description: "Phone number already in use. Please use a different one." });
            throw new Error("Phone number already in use. Please use a different one.");
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
        // ensureFirestoreUserProfile will be called by onAuthStateChanged
        // We pass profileDataFromSignup so it's available when the new profile is created
        const appUser = await ensureFirestoreUserProfile(firebaseUserInstance.uid, firebaseUserInstance, data);
        if (!appUser) {
          // console.error("AuthContext (signup): Failed to create Firestore profile after Firebase signup. User might be in an inconsistent state.");
          throw new Error("Failed to create Firestore profile after signup.");
        }
        toast({ title: "Signup Successful!", description: "Welcome to ResearchSphere." });
      } catch (profileError: any) {
        setLoading(false);
        // console.error("AuthContext (signup): Profile setup error after Firebase user creation:", profileError);
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
      // onAuthStateChanged will handle setting user to null
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/'); // Explicitly redirect to home on logout
    } catch (error: any) {
      setLoading(false); // Ensure loading is false on error
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
          toastMessage = `The ${providerName} sign-in popup was closed before completing. Please ensure popups are allowed and try again. If issues persist, you might consider using the 'Sign in with Redirect' option if available, or try a different browser/device.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Try logging in with that method.";
          break;
        case 'auth/operation-not-allowed':
            toastTitle = "Sign-In Method Disabled";
            toastMessage = `${providerName} sign-in is not enabled for this app. Contact support.`;
            break;
        case 'auth/popup-blocked':
            toastTitle = "Popup Blocked";
            toastMessage = `Your browser blocked the ${providerName} sign-in popup. Please allow popups for this site and try again.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({
      variant: "destructive",
      title: toastTitle,
      description: toastMessage,
      duration: 15000, 
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
      toast({ title: `${providerName} Sign-In Successful!`, description: "Welcome!" });
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading and setActiveSocialLoginProvider are handled by onAuthStateChanged or handleSocialLoginError
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

    // Prepare payloads, ensuring empty strings become null for Firestore
    (Object.keys(updatedData) as Array<keyof typeof updatedData>).forEach(key => {
        const value = updatedData[key];
        if (key === 'displayName' && value !== user.displayName) {
          firebaseAuthUpdatePayload.displayName = String(value || "");
        }
        // For Firestore, explicitly set empty strings to null for optional fields
        if (value === "") {
          updatePayloadFS[key] = null;
        } else {
          updatePayloadFS[key] = value;
        }
    });


    try {
      // Username uniqueness check (if username is being changed and is not empty)
      if (updatePayloadFS.username && updatePayloadFS.username !== user.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", updatePayloadFS.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Phone number uniqueness check (if phone number is being changed and is not empty)
      if (updatePayloadFS.phoneNumber && updatePayloadFS.phoneNumber !== user.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", updatePayloadFS.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      // Update Firebase Auth profile (only displayName is directly updatable this way)
      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }
      
      // Update Firestore document
      const userDocRef = doc(firestoreDb, "users", user.id);
      if (Object.keys(updatePayloadFS).filter(k => k !== 'updatedAt').length > 0) { 
        await updateDoc(userDocRef, updatePayloadFS);
      }
      
      // Optimistically update local user state, then re-fetch for canonical data
      const optimisticallyUpdatedUserFields = { ...user, ...updatedData };
      // Ensure all fields are at least null
      const sanitizedOptimisticUser = {
        ...optimisticallyUpdatedUserFields,
        username: optimisticallyUpdatedUserFields.username || null,
        role: optimisticallyUpdatedUserFields.role || null,
        phoneNumber: optimisticallyUpdatedUserFields.phoneNumber || null,
        institution: optimisticallyUpdatedUserFields.institution || null,
        researcherId: optimisticallyUpdatedUserFields.researcherId || null,
      };
      setUser(sanitizedOptimisticUser as User);
      
      // Re-fetch to get server timestamps and ensure consistency
      const updatedUserFromDb = await getDoc(userDocRef);
      if (updatedUserFromDb.exists()) {
        const finalUpdatedUser = convertUserTimestamps({ id: updatedUserFromDb.id, ...updatedUserFromDb.data() }) as User;
        setUser(finalUpdatedUser); // Set the canonical state
        setIsAdminUser(finalUpdatedUser.isAdmin === true); // Update admin state

        // Handle redirection if profile was just completed
        const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
        const completingProfileFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && completingProfileFlag === 'true') {
          if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              localStorage.removeItem('redirectAfterLogin');
              const targetPath = redirectPath || (finalUpdatedUser.isAdmin ? '/admin/dashboard' : (finalUpdatedUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
              // console.log("AuthContext (updateUserProfile): Profile now complete, redirecting to", targetPath);
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
        setLoading(false); // Reset loading on error
        throw error; // Re-throw for form to catch
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
       {!isMounted || (loading && !user && !firebaseAuth?.currentUser) ? ( // Show global loading only if not mounted or truly in initial auth check
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
            </div>
        ) : (!firebaseAuth || !firestoreDb) && isMounted ? (
             <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle text-destructive mb-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                <h1 className="text-2xl font-bold mb-2">Application Configuration Error</h1>
                <p className="text-muted-foreground max-w-md">
                    Firebase services are not available. Please ensure your Firebase project is correctly configured and all required environment variables (API keys, project ID, etc.) are correctly set in your deployment environment.
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

