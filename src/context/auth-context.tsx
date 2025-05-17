
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
const MOCK_ADMIN_EMAIL = 'admin@example.com';

const PROFILE_SETTINGS_PATH = '/author/profile/settings';

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

const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
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
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile found for ${uid}. Data:`, JSON.parse(JSON.stringify(existingData)));

      dataToSave = {
        id: uid,
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminByEmail || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
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
        role: profileDataFromSignup?.role || (isCreatorAdminByEmail ? "Admin" : "Author"),
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
    if (dataToSave.role === undefined) dataToSave.role = "Author"; // Default role

    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save/merge for ${uid}:`, JSON.parse(JSON.stringify(dataToSave)));
    await setDoc(userDocRef, dataToSave, { merge: true });

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      // console.log(`AuthContext (ensureFirestoreUserProfile): Profile saved/updated for ${uid}. Fetched data:`, JSON.parse(JSON.stringify(finalData)));
      return convertUserDocumentTimestamps({
        ...finalData,
        id: userDocAfterSave.id,
        isAdmin: finalData.isAdmin === true,
      });
    }
    // console.error(`AuthContext (ensureFirestoreUserProfile): Failed to fetch profile after save for ${uid}.`);
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
  const [loading, setLoading] = useState(true);
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
    if (!isMounted) return;

    if (!firebaseAuth || !firestoreDb) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      setActiveSocialLoginProvider(null);

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;
          let currentPathIsProfileSettings = pathname === PROFILE_SETTINGS_PATH;
          let completeQueryParam = searchParamsFromHook.get('complete') === 'true';

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }
          
          // console.log(`AuthContext: User ${appUser.id}. Path: ${pathname}, Admin: ${appUser.isAdmin}, ProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}, IsOnProfileSettings: ${currentPathIsProfileSettings}`);

          // 1. Profile Completion
          if (!isProfileComplete && !currentPathIsProfileSettings) {
            // console.log(`AuthContext: Profile INCOMPLETE for ${appUser.id}. Redirecting to ${PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${PROFILE_SETTINGS_PATH}?complete=true`);
          }
          // 2. Profile IS Complete & User IS on Profile Settings page (likely just finished)
          else if (isProfileComplete && currentPathIsProfileSettings && (completeQueryParam || completingProfileStorageFlag === 'true')) {
            // console.log(`AuthContext: Profile COMPLETE for ${appUser.id} AND on profile settings page. Redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            }
            let targetPath = redirectAfterLoginPath;
             // Correct a stale redirect to user profile settings itself
            if (targetPath === PROFILE_SETTINGS_PATH || targetPath === '/user/profile/settings' || targetPath === '/profile/settings') {
                targetPath = appUser.isAdmin ? '/admin/dashboard' : (appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard');
            }
            const finalRedirect = targetPath || (appUser.isAdmin ? '/admin/dashboard' : (appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
            // console.log(`AuthContext: Redirecting to ${finalRedirect} after profile completion for ${appUser.id}.`);
            router.push(finalRedirect);
          }
          // 3. Stored Redirect Path (if not handled by profile completion)
          else if (redirectAfterLoginPath) {
            let correctedRedirectPath = redirectAfterLoginPath;
            // Correct stale paths if necessary
            if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                correctedRedirectPath = PROFILE_SETTINGS_PATH;
                if (!isProfileComplete) correctedRedirectPath += '?complete=true';
            } else if (redirectAfterLoginPath.startsWith("/user/")) {
                 correctedRedirectPath = redirectAfterLoginPath.replace("/user/", "/author/");
            }
            // console.log(`AuthContext: Using redirectAfterLoginPath: ${correctedRedirectPath} for ${appUser.id}.`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            router.push(correctedRedirectPath);
          }
          // 4. Default redirects based on role if on auth pages or specific entry points, only if NOT already handled
          else {
            const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === '/' || pathname === PROFILE_SETTINGS_PATH; // PROFILE_SETTINGS_PATH considered an entry point for this logic

            if (appUser.isAdmin) {
                if (onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                    // console.log(`AuthContext: Admin ${appUser.id} on non-admin entry point '${pathname}'. Redirecting to /admin/dashboard.`);
                    router.push('/admin/dashboard');
                }
            } else if (onAuthPages) { // Non-admin on auth page
                const defaultUserDashboard = appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard';
                // console.log(`AuthContext: Non-admin ${appUser.id} on auth page '${pathname}'. Redirecting to ${defaultUserDashboard}.`);
                router.push(defaultUserDashboard);
            }
            // If none of the above, user stays on current page
          }
        } else { // appUser is null from ensureFirestoreUserProfile (critical Firestore error)
          console.error("AuthContext: Failed to fetch or create user profile in Firestore after Firebase Auth. Firebase UID:", firebaseUser.uid, "Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // firebaseUser is null
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
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

    // console.log(`AuthContext (login): Attempting login with identifier: '${identifier}'`);

    if (!identifier.includes('@')) {
      // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Querying Firestore...`);
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
          const errMessage = `No user found with username '${identifier}'. Please check your username or try logging in with email.`;
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
      // onAuthStateChanged will handle setting user and redirecting.
    } catch (error) {
      setLoading(false);
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
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // Perform uniqueness checks before Firebase user creation
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
      // Update Firebase Auth profile display name if provided
      if (data.fullName && data.fullName !== firebaseUserInstance.displayName) {
          await updateFirebaseProfile(firebaseUserInstance, { displayName: data.fullName });
      }
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

    // Firestore profile creation is now handled by onAuthStateChanged calling ensureFirestoreUserProfile
    // We pass `data` to ensureFirestoreUserProfile to populate initial fields
    try {
        await ensureFirestoreUserProfile(firebaseUserInstance, data); // This call now happens implicitly via onAuthStateChanged
        // onAuthStateChanged handles redirects and setting user state.
        toast({ title: "Signup Successful!", description: "Welcome to ResearchSphere. Please complete your profile if prompted." });
    } catch (profileError: any) {
        setLoading(false); // Ensure loading is false if ensureFirestoreUserProfile itself throws an error not caught internally
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in. If issues persist, contact support.`, duration: 10000 });
        throw profileError; // Re-throw to be caught by the form if needed
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will set user to null.
      toast({title: "Logged Out", description: "You have been successfully logged out."});
      router.push('/'); // Explicitly redirect to home on logout
    } catch (error: any) {
      setLoading(false);
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
      // onAuthStateChanged will handle setting user, profile creation/fetching and redirecting.
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

    (Object.keys(updatedData) as Array<keyof typeof updatedData>).forEach(key => {
        const value = updatedData[key];
        if (key === 'displayName' && value !== user.displayName) {
          firebaseAuthUpdatePayload.displayName = String(value || "");
        }
        if (key === 'username' || key === 'phoneNumber' || key === 'institution' || key === 'researcherId') {
            updatePayloadFS[key] = value === "" ? null : value;
        } else if (value !== undefined && key !== 'isAdmin' && key !== 'role') { // Prevent direct update of isAdmin or role from here
            updatePayloadFS[key] = value;
        }
         // For 'role', only update if it's changing from a nullish value or is explicitly provided
        if (key === 'role' && (value && value !== user.role)) {
          updatePayloadFS[key] = value;
        }
    });

    // console.log("AuthContext (updateUserProfile): Prepared Firestore update payload:", JSON.parse(JSON.stringify(updatePayloadFS)));
    // console.log("AuthContext (updateUserProfile): Prepared Firebase Auth update payload:", firebaseAuthUpdatePayload);


    try {
      // Uniqueness checks for username and phone (if changed and not empty)
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
          // console.log("AuthContext (updateUserProfile): Updating Firebase Auth displayName to:", firebaseAuthUpdatePayload.displayName);
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      // console.log(`AuthContext (updateUserProfile): Updating Firestore document users/${user.id} with payload:`, JSON.parse(JSON.stringify(updatePayloadFS)));
      await updateDoc(userDocRef, updatePayloadFS);

      // Optimistically update local state immediately
      const optimisticallyUpdatedUserFields = { ...updatePayloadFS };
      delete optimisticallyUpdatedUserFields.updatedAt; // Don't use serverTimestamp directly
      if (firebaseAuthUpdatePayload.displayName !== undefined) {
          optimisticallyUpdatedUserFields.displayName = firebaseAuthUpdatePayload.displayName;
      }

      const updatedLocalUser = {
          ...user,
          ...optimisticallyUpdatedUserFields,
          updatedAt: new Date().toISOString(), // Simulate timestamp update locally
      } as User;
      
      setUser(updatedLocalUser);
      // console.log("AuthContext (updateUserProfile): Optimistically updated local user state:", JSON.parse(JSON.stringify(updatedLocalUser)));
      
      // Re-fetch from DB to confirm and get server timestamps (or rely on onAuthStateChanged if token refreshes)
      const updatedUserFromDbSnap = await getDoc(userDocRef);
      let finalUpdatedUser: User | null = null;
      if (updatedUserFromDbSnap.exists()) {
        finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        setUser(finalUpdatedUser); // Set with server-confirmed data
        setIsAdminUser(finalUpdatedUser.isAdmin === true);
        // console.log("AuthContext (updateUserProfile): Successfully re-fetched and set user from Firestore:", JSON.parse(JSON.stringify(finalUpdatedUser)));
      } else {
         console.error("AuthContext (updateUserProfile): Failed to re-fetch profile after update for user:", user.id);
         // Keep optimistic update if re-fetch fails but original update didn't throw
         finalUpdatedUser = updatedLocalUser;
      }

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      // console.log("AuthContext (updateUserProfile): isProfileNowComplete:", isProfileNowComplete);

      if (typeof window !== 'undefined') {
          const completingProfileFlag = localStorage.getItem('completingProfile');
          if (isProfileNowComplete && completingProfileFlag === 'true') {
            // console.log("AuthContext (updateUserProfile): Profile now complete, redirecting from profile settings.");
            localStorage.removeItem('completingProfile');
            let targetPath = localStorage.getItem('redirectAfterLogin');
            if (targetPath) localStorage.removeItem('redirectAfterLogin');

            if (targetPath === PROFILE_SETTINGS_PATH || targetPath === '/user/profile/settings' || targetPath === '/profile/settings') {
                targetPath = finalUpdatedUser.isAdmin ? '/admin/dashboard' : (finalUpdatedUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard');
            } else if (targetPath && targetPath.startsWith("/user/")) {
                 targetPath = targetPath.replace("/user/", "/author/");
            }
            const finalRedirectPath = targetPath || (finalUpdatedUser.isAdmin ? '/admin/dashboard' : (finalUpdatedUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
            // console.log(`AuthContext (updateUserProfile): Redirecting to ${finalRedirectPath} after profile update completion.`);
            router.push(finalRedirectPath);
          }
      }
      toast({ title: "Success", description: "Your profile has been updated." });
      setLoading(false);
      return finalUpdatedUser;

    } catch(error: any) {
        // console.error("AuthContext (updateUserProfile): Error during profile update process:", error.message, error);
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        setLoading(false);
        throw error;
    }
  };


  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser)) {
       return (
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
            </div>
        );
    }

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
