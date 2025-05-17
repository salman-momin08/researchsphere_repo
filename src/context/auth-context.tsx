
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
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // For easy admin login during mock phase

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
   if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
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


// This function is now responsible for fetching OR creating the Firestore profile.
const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> // Data from signup form or profile completion
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
    toast({ variant: "destructive", title: "Database Error", description: "User profile database is not accessible. Please try again later.", duration: 7000 });
    return null;
  }
  const { uid, email, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Partial<User> & { id: string; email: string | null; updatedAt: any; createdAt?: any; userId: string; };
    const isCreatorAdminByEmail = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile found for ${uid}:`, JSON.parse(JSON.stringify(existingData)));

      dataToSave = {
        ...existingData, // Start with existing data
        id: uid,
        userId: uid, // Ensure userId is present, it's same as id (Firebase UID)
        email: email, // Always update email from Firebase Auth
        // Update displayName: prefer signup data, then firebase auth, then existing, then default
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null, // Update photoURL from Firebase Auth or keep existing
        // For other fields, prioritize data from signup/profile completion, then existing Firestore data, then null
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author"), // Default role if new
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        // isAdmin is critical: only update if profileDataFromSignup explicitly provides it (which it shouldn't for normal users)
        // or if it's a predefined admin email. Otherwise, keep existingData.isAdmin.
        isAdmin: isCreatorAdminByEmail || (existingData.isAdmin === true),
        isSuspended: existingData.isSuspended === true, // Preserve existing suspension status
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
      };
    } else {
      // console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore profile for ${uid}. Creating new.`);
      dataToSave = {
        id: uid,
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isCreatorAdminByEmail ? "Admin" : "Author"), // Default role
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }
    // Ensure truly empty optional fields from forms are stored as null
    if (dataToSave.username === "") dataToSave.username = null;
    if (dataToSave.phoneNumber === "") dataToSave.phoneNumber = null;
    if (dataToSave.institution === "") dataToSave.institution = null;
    if (dataToSave.researcherId === "") dataToSave.researcherId = null;


    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save/merge for ${uid}:`, JSON.parse(JSON.stringify(dataToSave)));
    await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge: true to be safe, especially on creation

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      // console.log(`AuthContext (ensureFirestoreUserProfile): Profile saved/updated for ${uid}. Fetched data:`, JSON.parse(JSON.stringify(finalData)));
      return convertUserDocumentTimestamps({
        ...finalData,
        id: userDocAfterSave.id, // Ensure id is the doc ID
        isAdmin: finalData.isAdmin === true, // Ensure boolean
      });
    }
    console.error(`AuthContext (ensureFirestoreUserProfile): Failed to fetch profile after save for ${uid}.`);
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
  const [isAdminUser, setIsAdminUser] = useState(false); // Specific state for isAdmin
  const [loading, setLoading] = useState(true); // Start true until auth state is resolved
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
    if (!isMounted) return; // Only run effect if component is mounted

    if (!firebaseAuth || !firestoreDb) {
      console.error("AuthContext: Firebase Auth or Firestore DB instance is not available. Critical setup issue. Check src/lib/firebase.ts and .env.local variables.");
      setLoading(false);
      // No need to show toast here, AuthProvider renders an error message directly
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true); // Set loading true while processing auth state
      setActiveSocialLoginProvider(null);

      // console.log("AuthContext (onAuthStateChanged): Auth state changed. FirebaseUser:", firebaseUser?.uid || "null");

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          // console.log("AuthContext (onAuthStateChanged): Successfully fetched/created appUser from Firestore:", JSON.parse(JSON.stringify(appUser)));
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

          // console.log(`AuthContext (onAuthStateChanged): For UID ${appUser.id} - Pathname: ${pathname}, IsAdmin: ${appUser.isAdmin}, IsProfileComplete: ${isProfileComplete}, redirectAfterLoginPath: ${redirectAfterLoginPath}, completingProfileStorageFlag: ${completingProfileStorageFlag}`);

          // Priority 1: Profile Completion
          if (!isProfileComplete && pathname !== '/author/profile/settings') {
            // console.log(`AuthContext (onAuthStateChanged): Profile INCOMPLETE. Current path: ${pathname}. Redirecting to /author/profile/settings?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/author/profile/settings?complete=true');
          } else if (isProfileComplete && pathname === '/author/profile/settings' && (searchParamsFromHook?.get('complete') === 'true' || completingProfileStorageFlag === 'true')) {
            // console.log(`AuthContext (onAuthStateChanged): Profile COMPLETE and ON author profile settings page with complete flag. Redirecting away.`);
            if (typeof window !== 'undefined') {
                localStorage.removeItem('completingProfile');
                if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            }
            let targetPath = redirectAfterLoginPath;
            if (targetPath === '/user/profile/settings' || targetPath === '/profile/settings' || targetPath === '/author/profile/settings') {
                targetPath = appUser.isAdmin ? '/admin/dashboard' : (appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard');
            } else if (targetPath && targetPath.startsWith("/user/")) {
                 targetPath = targetPath.replace("/user/", "/author/");
            }
            const finalRedirect = targetPath || (appUser.isAdmin ? '/admin/dashboard' : (appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
            // console.log(`AuthContext (onAuthStateChanged): Redirecting to ${finalRedirect} after profile completion.`);
            router.push(finalRedirect);
          }
          // Priority 2: Stored Redirect Path (e.g., after trying to access a protected page)
          else if (redirectAfterLoginPath) {
            let correctedRedirectPath = redirectAfterLoginPath;
             if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') { // Stale path
                correctedRedirectPath = '/author/profile/settings';
                if (!isProfileComplete) correctedRedirectPath += '?complete=true';
            } else if (redirectAfterLoginPath.startsWith("/user/")) { // Correct old /user/ paths
                 correctedRedirectPath = redirectAfterLoginPath.replace("/user/", "/author/");
            }
            // console.log(`AuthContext (onAuthStateChanged): Using redirectAfterLoginPath: ${correctedRedirectPath}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            router.push(correctedRedirectPath);
          }
          // Priority 3: Default redirects based on role if on auth pages or specific entry points
          else {
            const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === '/' || pathname === '/author/profile/settings';

            if (appUser.isAdmin) {
                if (onNonAdminEntryPoint && pathname !== '/admin/dashboard' && !pathname.startsWith('/admin/')) {
                    // console.log(`AuthContext (onAuthStateChanged): Admin on non-admin entry point '${pathname}'. Redirecting to /admin/dashboard.`);
                    router.push('/admin/dashboard');
                }
            } else if (onAuthPages) { // Non-admin on auth page
                const defaultUserDashboard = appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard';
                // console.log(`AuthContext (onAuthStateChanged): Non-admin on auth page '${pathname}'. Redirecting to ${defaultUserDashboard}.`);
                router.push(defaultUserDashboard);
            }
            // If none of the above, user stays on current page (e.g., refresh of an already valid page)
          }
        } else {
          // This case means ensureFirestoreUserProfile returned null (critical Firestore error)
          console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // firebaseUser is null (not logged in)
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false); // Auth processing finished
    });

    return () => {
      unsubscribe();
    };
  }, [isMounted, pathname, router, searchParamsFromHook]); // Added dependencies


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for login.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true); // Set loading true at the start of the login attempt
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
            const errMessage = `User profile incomplete for username '${identifier}' (missing email).`;
            throw new Error(errMessage);
          }
        } else {
          setLoading(false);
          const errMessage = `No user found with username '${identifier}'.`;
          throw new Error(errMessage);
        }
      } catch (dbError: any) {
        setLoading(false);
        const errMessage = `Error during username lookup: ${dbError.message}.`;
        throw new Error(errMessage);
      }
    }

    // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and redirecting. setLoading(false) will be called there.
    } catch (error) {
      setLoading(false); // Ensure loading is false on error
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
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for signup.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true); // Set loading true at the start of signup
    setActiveSocialLoginProvider(null);

    // Client-side uniqueness checks (before Firebase user creation)
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
    if (data.phoneNumber) { // Phone number is now mandatory
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
      setLoading(false); // Ensure loading is false on error
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = authError.message || errorMessage;
      }
      // console.error("AuthContext (signup): Firebase account creation error:", errorMessage, authError);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    try {
        if (data.fullName && data.fullName !== firebaseUserInstance.displayName) {
            await updateFirebaseProfile(firebaseUserInstance, { displayName: data.fullName });
        }
        // ensureFirestoreUserProfile will be called by onAuthStateChanged,
        // but we pass data from signup form to ensure profile is created with these details.
        await ensureFirestoreUserProfile(firebaseUserInstance, data);
        // onAuthStateChanged handles redirects and setting user state. setLoading(false) will be called there.
        toast({ title: "Signup Successful!", description: "Welcome to ResearchSphere. Please complete your profile if prompted." });
    } catch (profileError: any) {
        setLoading(false); // Ensure loading is false on error
        // console.error("AuthContext (signup): Firestore profile creation error:", profileError.message, profileError);
        // This toast is important if ensureFirestoreUserProfile itself fails AFTER Firebase user creation.
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in. If issues persist, contact support.`, duration: 10000 });
        throw profileError;
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will set user to null and handle redirects. setLoading(false) will be called there.
      toast({title: "Logged Out", description: "You have been successfully logged out."});
    } catch (error: any) {
      setLoading(false); // Ensure loading is false on error
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setLoading(false);
    setActiveSocialLoginProvider(null);
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
      // onAuthStateChanged will handle setting user, profile creation and redirecting. setLoading(false) will be called there.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) {
      const msg = "Authentication service not available for password reset.";
      throw new Error(msg);
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
    (Object.keys(updatedData) as Array<keyof typeof updatedData>).forEach(key => {
        const value = updatedData[key];
        if (key === 'displayName' && value !== user.displayName) {
          firebaseAuthUpdatePayload.displayName = String(value || "");
        }
        if (key === 'username' || key === 'phoneNumber' || key === 'institution' || key === 'researcherId') {
            updatePayloadFS[key] = value === "" ? null : value;
        } else if (value !== undefined && key !== 'isAdmin') { // For other fields like role, but never isAdmin from client
            updatePayloadFS[key] = value;
        }
    });


    try {
      // Uniqueness checks for username and phone (if changed)
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

      // Update Firebase Auth display name if it changed
      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      // Optimistic update of local state
      const optimisticallyUpdatedUser = {
        ...user,
        ...updatePayloadFS, // Apply the (potentially nulled) updates
        displayName: firebaseAuthUpdatePayload.displayName !== undefined ? firebaseAuthUpdatePayload.displayName : user.displayName, // Update displayName from auth payload
        updatedAt: new Date().toISOString(), // Simulate timestamp update
      } as User;
      setUser(optimisticallyUpdatedUser);
      setIsAdminUser(optimisticallyUpdatedUser.isAdmin === true); // Ensure isAdminUser state is also updated


      const updatedUserFromDbSnap = await getDoc(userDocRef); // Re-fetch to confirm and get server timestamps
      if (updatedUserFromDbSnap.exists()) {
        const finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        setUser(finalUpdatedUser);
        setIsAdminUser(finalUpdatedUser.isAdmin === true);

        const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
        const currentCompletingProfileFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && currentCompletingProfileFlag === 'true') {
          // console.log("AuthContext (updateUserProfile): Profile now complete, redirecting from profile settings.");
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            let targetPath = localStorage.getItem('redirectAfterLogin');
            if (targetPath) localStorage.removeItem('redirectAfterLogin');

            if (targetPath === '/user/profile/settings' || targetPath === '/profile/settings' || targetPath === '/author/profile/settings') {
                targetPath = finalUpdatedUser.isAdmin ? '/admin/dashboard' : (finalUpdatedUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard');
            } else if (targetPath && targetPath.startsWith("/user/")) { // Correct old /user/ paths
                targetPath = targetPath.replace("/user/", "/author/");
            }
            const finalRedirectPath = targetPath || (finalUpdatedUser.isAdmin ? '/admin/dashboard' : (finalUpdatedUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
            router.push(finalRedirectPath);
          }
        }
        toast({ title: "Success", description: "Your profile has been updated." });
        setLoading(false);
        return finalUpdatedUser;
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

    } catch(error: any) {
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        setLoading(false);
        throw error;
    }
  };

  // Initial loading screen logic
  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser)) { // Show global loading only if not mounted or truly in initial auth check
       return (
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
            </div>
        );
    }


  // Critical error: Firebase not configured properly
  if (isMounted && (!firebaseAuth || !firestoreDb)) {
     return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-background text-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle text-destructive mb-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            <h1 className="text-2xl font-bold mb-2">Application Configuration Error</h1>
            <p className="text-muted-foreground max-w-md">
                Firebase services are not available. Please ensure your Firebase project is correctly configured (API keys, Project ID, etc.) in your environment variables and that Firestore is enabled. Check browser console for more details.
            </p>
        </div>
    );
  }


  return (
    <AuthContext.Provider value={{
        user,
        loading,
        isAdmin: isAdminUser, // Use the specific isAdminUser state
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
