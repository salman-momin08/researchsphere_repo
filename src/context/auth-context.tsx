
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction, useContext } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import {
  auth as firebaseAuth, // Renamed for clarity
  db as firestoreDb,   // Renamed for clarity
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
  writeBatch,
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import LoadingSpinner from '@/components/shared/LoadingSpinner'; // Keep for initial loading

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


// This function is crucial for both new signups and fetching existing user data
const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> // Data from signup form or profile completion
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB (firestoreDb) is not available. Cannot proceed.");
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
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore data for ${uid}:`, existingData);
      dataToSave = {
        // Prioritize existing data for core profile fields, update with new auth/signup data if applicable
        id: uid,
        userId: uid,
        email: email, // Always use the latest from Firebase Auth
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || existingData.isAdmin === true, // Retain admin status if already admin or matches creator email
        isSuspended: existingData.isSuspended === true,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(), // Preserve original createdAt
        updatedAt: serverTimestamp(),
      };
    } else {
      // New user document
      // console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore doc for ${uid}. Creating new. Signup data:`, profileDataFromSignup);
      dataToSave = {
        id: uid,
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null, // Initialize to null if not from signup form
        role: profileDataFromSignup?.role || (isCreatorAdminEmail ? "Admin" : "Author"), // Default to Author or Admin if creator
        phoneNumber: profileDataFromSignup?.phoneNumber || null, // Initialize to null
        institution: profileDataFromSignup?.institution || null, // Initialize to null
        researcherId: profileDataFromSignup?.researcherId || null, // Initialize to null
        isAdmin: isCreatorAdminEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // Ensure all optional fields are explicitly null if they are empty strings or weren't provided
    dataToSave.username = dataToSave.username === "" ? null : dataToSave.username;
    dataToSave.phoneNumber = dataToSave.phoneNumber === "" ? null : dataToSave.phoneNumber;
    dataToSave.institution = dataToSave.institution === "" ? null : dataToSave.institution;
    dataToSave.researcherId = dataToSave.researcherId === "" ? null : dataToSave.researcherId;
    if (!dataToSave.role) dataToSave.role = isCreatorAdminEmail ? "Admin" : "Author"; // Final default role check


    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for ${uid}:`, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge:true for safety
    const userDocAfterSave = await getDoc(userDocRef);

    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      const appUser = convertUserDocumentTimestamps({
        ...finalData,
        id: userDocAfterSave.id,
        // isAdmin: finalData.isAdmin === true, // Already handled in dataToSave
      });
      // console.log(`AuthContext (ensureFirestoreUserProfile): Successfully fetched/created profile for ${uid}:`, appUser);
      return appUser;
    }
    console.error(`AuthContext (ensureFirestoreUserProfile): CRITICAL - Failed to fetch profile after save for ${uid}.`);
    return null;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}"`, error.code, error);
    // Do not toast here directly, let the calling function (onAuthStateChanged) handle UI for critical failures.
    throw error; // Re-throw to be caught by onAuthStateChanged
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
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) { // Wait for mount and for firebaseAuth to be non-null
      if(isMounted && !firebaseAuth) setLoading(false); // If mounted but no Firebase, stop loading
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext (onAuthStateChanged): Auth state changed. Firebase user:", firebaseUser?.uid);
      setActiveSocialLoginProvider(null);

      if (firebaseUser) {
        let appUser: User | null = null;
        try {
          appUser = await ensureFirestoreUserProfile(firebaseUser);
        } catch (profileError) {
          // Error already logged in ensureFirestoreUserProfile
          // This catch block is to prevent unhandled promise rejection here
          // The function will have thrown, so appUser will remain null if it fails before returning.
        }

        if (appUser) {
          const rawIsAdminFromProfile = appUser.isAdmin;
          // console.log(`AuthContext (onAuthStateChanged): Raw isAdmin from appUser for ${firebaseUser.uid}:`, rawIsAdminFromProfile, `(type: ${typeof rawIsAdminFromProfile})`);
          const finalIsAdmin = rawIsAdminFromProfile === true;
          // console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);
          
          setUser(appUser);
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          // console.log(`AuthContext (onAuthStateChanged): Profile for ${appUser.id} - Username: ${appUser.username}, Role: ${appUser.role}, Phone: ${appUser.phoneNumber}. Complete: ${isProfileComplete}`);

          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }

          // console.log(`AuthContext (onAuthStateChanged): Pathname: ${pathname}, RedirectAfterLogin: ${redirectAfterLoginPath}, CompletingProfileFlag: ${completingProfileStorageFlag}`);


          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            // console.log(`AuthContext (onAuthStateChanged): Profile incomplete. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            // console.log(`AuthContext (onAuthStateChanged): Profile complete and on settings page. Redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH) { // Avoid redirecting back to settings if it was the original target
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null;
              }
            }
            const targetDashboard = finalIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(redirectAfterLoginPath || targetDashboard);
          } else if (redirectAfterLoginPath) {
            // console.log(`AuthContext (onAuthStateChanged): Handling redirectAfterLoginPath: ${redirectAfterLoginPath}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            if (redirectAfterLoginPath === '/user/profile/settings') redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH; // Correct old path
            router.push(redirectAfterLoginPath);
          } else {
            // Default redirection if no specific flow is active
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH].includes(pathname) || pathname.startsWith('/author/');

            if (finalIsAdmin) {
              if (onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                // console.log(`AuthContext (onAuthStateChanged): Admin on non-admin entry point. Redirecting to ${ADMIN_DASHBOARD_PATH}`);
                router.push(ADMIN_DASHBOARD_PATH);
              }
            } else if (onAuthPages) { // Non-admin on an auth page, redirect to their dashboard
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              // console.log(`AuthContext (onAuthStateChanged): Non-admin on auth page. Redirecting to ${userDashboard}`);
              router.push(userDashboard);
            }
          }
        } else {
          console.error("AuthContext (onAuthStateChanged): Failed to fetch or create user profile in Firestore for UID:", firebaseUser.uid, ". Logging out Firebase user.");
          toast({ variant: "destructive", title: "Critical Profile Error", description: "Could not load or create your user profile. Please try again. If the problem persists, contact support.", duration: 10000 });
          if (firebaseAuth) await signOut(firebaseAuth); // Sign out Firebase Auth session
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // firebaseUser is null
        // console.log("AuthContext (onAuthStateChanged): No Firebase user. Clearing local state.");
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook]); // Added searchParamsFromHook as it's used in effect logic

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for login.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    // console.log(`AuthContext (login): Attempting login with identifier: '${identifier}'`);

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
            throw new Error(`User profile incomplete for username '${identifier}' (missing email).`);
          }
        } else {
          setLoading(false);
          // console.log(`AuthContext (login): No email found for username '${identifier}'. Proceeding with identifier as email.`);
          // Keep emailToLogin as the original identifier, Firebase will fail if it's not an email
        }
      } catch (dbError: any) {
        setLoading(false);
        console.error("AuthContext (login): Firestore error during username lookup:", dbError);
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    
    try {
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and redirecting.
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
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      setLoading(false);
      throw new Error(errorMessage);
    }
    // setLoading(false) is handled by onAuthStateChanged or error catch
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
      // Username uniqueness check (client-side before Firebase user creation)
      if (data.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", data.username));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Phone number uniqueness check (client-side)
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
      // ensureFirestoreUserProfile will be called by onAuthStateChanged.
      // Pass signup data to ensureFirestoreUserProfile via a mechanism if needed, or ensure it has all info.
      // For now, onAuthStateChanged will call ensureFirestoreUserProfile which will create the doc.
      // We can enhance ensureFirestoreUserProfile to take initial signup data.
      // Let's call it directly here to pass signup data, onAuthStateChanged will still run.
      await ensureFirestoreUserProfile(cred.user, data); 
      toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
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
    // setLoading(false) handled by onAuthStateChanged or error catch
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
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
      // onAuthStateChanged will handle setting user, profile creation and redirecting.
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

    // Prepare Firestore payload, ensuring empty strings become null
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
      // Uniqueness checks for username and phone number if they are being changed
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

      // Update Firebase Auth profile (only displayName can be updated this way client-side)
      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      // Update Firestore document
      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      const updatedUserFromDbSnap = await getDoc(userDocRef);
      let finalUpdatedUser: User | null = null;

      if (updatedUserFromDbSnap.exists()) {
        finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        setUser(finalUpdatedUser); // Optimistic update of local state
        setIsAdminUser(finalUpdatedUser.isAdmin === true); // Also update isAdminUser state
      } else {
         console.error("AuthContext (updateUserProfile): User document not found after update for UID:", user.id);
         throw new Error("Profile update seemed to succeed but could not re-fetch profile.");
      }
      
      toast({ title: "Success", description: "Your profile has been updated." });

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        // console.log("AuthContext (updateUserProfile): Profile completion detected. Redirecting away from settings.");
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
        throw error; // Re-throw for the form to catch
    } finally {
        setLoading(false);
    }
  };

  // Initial loading screen logic
  if (!isMounted || (loading && !user && (!firebaseAuth?.currentUser || firebaseAuth?.currentUser === null))) {
       return ( // Display a global loading indicator until auth state is resolved or if Firebase services are unavailable
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
            </div>
        );
  }
  // Error if Firebase services aren't available after mount and initial loading check
  if ((!firebaseAuth || !firestoreDb) && isMounted) {
     return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle text-destructive mb-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            <h1 className="text-2xl font-bold mb-2 text-destructive">Application Configuration Error</h1>
            <p className="text-muted-foreground max-w-md">
                Firebase services (Authentication or Firestore) are not available. Please ensure your Firebase project is correctly configured in your environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>) and that these services are enabled in your Firebase console.
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
