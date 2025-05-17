
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
  // getIdToken, // Not currently used for frontend-only Firestore access
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
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Kept for consistency, though ADMIN_CREATOR_EMAIL is primary for dynamic admin creation

const PROFILE_SETTINGS_PATH_AUTHOR = '/author/profile/settings';

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
    toast({ variant: "destructive", title: "Database Error", description: "User profile database is not accessible. Please try again later.", duration: 7000 });
    return null;
  }
  const { uid, email, displayName: firebaseDisplayName, photoURL: firebasePhotoURL } = firebaseUser;
  const userDocRef = doc(firestoreDb, "users", uid);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: Partial<User> & { id: string; email: string | null; updatedAt: any; createdAt?: any; userId: string; };
    const isAdminByEmail = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}. Raw Data:`, JSON.parse(JSON.stringify(existingData)));

      dataToSave = {
        id: uid,
        userId: uid, // Ensure this field is always present
        email: email, // Always update with the latest from Firebase Auth
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null, // Update if Firebase Auth has newer, else keep existing
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role || existingData.role || (isAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isAdminByEmail || existingData.isAdmin === true, // Prioritize email check, then existing data
        isSuspended: existingData.isSuspended === true,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    } else {
      // console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore profile for ${uid}. Creating new with signup data (if any).`);
      dataToSave = {
        id: uid,
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    // Ensure fields that should be null if empty are set to null
    dataToSave.username = dataToSave.username === "" ? null : dataToSave.username;
    dataToSave.phoneNumber = dataToSave.phoneNumber === "" ? null : dataToSave.phoneNumber;
    dataToSave.institution = dataToSave.institution === "" ? null : dataToSave.institution;
    dataToSave.researcherId = dataToSave.researcherId === "" ? null : dataToSave.researcherId;
    if (!dataToSave.role) dataToSave.role = "Author"; // Default role if still somehow undefined

    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save/merge for ${uid}:`, JSON.parse(JSON.stringify(dataToSave)));
    await setDoc(userDocRef, dataToSave, { merge: true }); // Merge ensures we don't wipe fields not in dataToSave if doc exists

    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      // console.log(`AuthContext (ensureFirestoreUserProfile): Profile saved/updated for ${uid}. Fetched data:`, JSON.parse(JSON.stringify(finalData)));
      const appUser = convertUserDocumentTimestamps({
        ...finalData,
        id: userDocAfterSave.id, // ensure id is part of the returned object
        isAdmin: finalData.isAdmin === true, // ensure isAdmin is boolean
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
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (!firebaseAuth || !firestoreDb) {
        setLoading(false); // Only set loading false if services are definitely not available
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      setActiveSocialLoginProvider(null);

      if (firebaseUser) {
        // console.log(`AuthContext (onAuthStateChanged): Firebase user detected: ${firebaseUser.uid}, Email: ${firebaseUser.email}`);
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          // console.log(`AuthContext (onAuthStateChanged): Hydrated appUser for ${firebaseUser.uid}:`, JSON.parse(JSON.stringify(appUser)));
          const finalIsAdmin = appUser.isAdmin === true;
          // console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);
          
          setUser(appUser);
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false); // Close login modal if it was open

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          // console.log(`AuthContext (onAuthStateChanged): Profile for ${appUser.id} - Username: '${appUser.username}', Role: '${appUser.role}', Phone: '${appUser.phoneNumber}'. Complete: ${isProfileComplete}`);
          
          let redirectAfterLoginPath: string | null = null;
          let completingProfileStorageFlag: string | null = null;
          const completeQueryParam = searchParamsFromHook.get('complete') === 'true';

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }
          // console.log(`AuthContext (onAuthStateChanged): Path: ${pathname}, IsAdmin: ${finalIsAdmin}, ProfileComplete: ${isProfileComplete}, RedirectAfterLoginPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}, CompleteQueryParam: ${completeQueryParam}`);


          if (!isProfileComplete) {
            if (pathname !== PROFILE_SETTINGS_PATH_AUTHOR) {
              // console.log(`AuthContext (onAuthStateChanged): Profile INCOMPLETE for ${appUser.id}. Redirecting to ${PROFILE_SETTINGS_PATH_AUTHOR}?complete=true`);
              if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
              router.push(`${PROFILE_SETTINGS_PATH_AUTHOR}?complete=true`);
            } else {
              // console.log(`AuthContext (onAuthStateChanged): Profile INCOMPLETE for ${appUser.id}, but already on settings page. No redirect.`);
            }
          } else { // Profile IS complete
            // Check if the user was on the profile settings page for completion
            if (pathname === PROFILE_SETTINGS_PATH_AUTHOR && (completeQueryParam || completingProfileStorageFlag === 'true')) {
              // console.log(`AuthContext (onAuthStateChanged): Profile COMPLETE for ${appUser.id} AND was on profile settings for completion. Redirecting away.`);
              if (typeof window !== 'undefined') {
                localStorage.removeItem('completingProfile');
                if (redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin'); // Clear as it's being used or was for profile completion
              }
              let targetPath = redirectAfterLoginPath;
              if (targetPath === PROFILE_SETTINGS_PATH_AUTHOR) { // Avoid redirecting back to settings
                targetPath = null; 
              }
              const finalRedirect = targetPath || (finalIsAdmin ? '/admin/dashboard' : (appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
              // console.log(`AuthContext (onAuthStateChanged): Redirecting to ${finalRedirect} after profile completion for ${appUser.id}.`);
              router.push(finalRedirect);
            } else if (redirectAfterLoginPath && redirectAfterLoginPath !== pathname) {
              // console.log(`AuthContext (onAuthStateChanged): Using redirectAfterLoginPath: ${redirectAfterLoginPath} for ${appUser.id}.`);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              router.push(redirectAfterLoginPath);
            } else if (finalIsAdmin) {
              const onNonAdminEntryPoint = ['/', '/login', '/signup', '/forgot-password', PROFILE_SETTINGS_PATH_AUTHOR].includes(pathname) || pathname.startsWith('/author/') || pathname.startsWith('/reviewer/');
              if (onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                // console.log(`AuthContext (onAuthStateChanged): Admin ${appUser.id} on non-admin entry point '${pathname}'. Redirecting to /admin/dashboard.`);
                router.push('/admin/dashboard');
              }
            } else { // Non-admin, profile complete, no specific redirect from settings or login path
              const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
              if (onAuthPages) {
                const defaultUserDashboard = appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard';
                // console.log(`AuthContext (onAuthStateChanged): Non-admin ${appUser.id} on auth page '${pathname}'. Redirecting to ${defaultUserDashboard}.`);
                router.push(defaultUserDashboard);
              }
            }
          }
        } else { // appUser is null from ensureFirestoreUserProfile (critical Firestore error)
          console.error("AuthContext (onAuthStateChanged): Failed to fetch or create user profile in Firestore. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // firebaseUser is null
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          // Don't clear redirectAfterLogin here, ProtectedRoute might need it if modal was shown
          localStorage.removeItem('completingProfile'); 
        }
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [isMounted, pathname, router, searchParamsFromHook]); // Added searchParamsFromHook


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

    // Perform uniqueness checks (moved these from AuthContext to SignupForm for earlier feedback)
    // For this context, assume these checks passed in the form.
    // Firestore rules will be the ultimate gatekeeper.

    let firebaseUserInstance: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUserInstance = cred.user;
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

    try {
        const appUserProfile = await ensureFirestoreUserProfile(firebaseUserInstance, data);
        if (appUserProfile) {
            // onAuthStateChanged will set the user and trigger redirects.
            toast({ title: "Signup Successful!", description: "Welcome to ResearchSphere! Please complete your profile if prompted." });
        } else {
            // This case is serious: Firebase user created, but Firestore profile failed.
            // onAuthStateChanged handles logging out the Firebase user in this scenario.
            throw new Error("Firestore profile creation failed after signup.");
        }
    } catch (profileError: any) {
        setLoading(false); 
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in.`, duration: 10000 });
        // Consider if Firebase user should be deleted here if Firestore profile fails, more complex.
        // For now, onAuthStateChanged will log them out.
        throw profileError;
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      setUser(null);
      setIsAdminUser(false);
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      toast({title: "Logged Out", description: "You have been successfully logged out."});
      router.push('/'); 
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
        } else if (key === 'role' && (value && value !== user.role)) { // Only update role if it's changing
            updatePayloadFS[key] = value;
        } else if (value !== undefined && key !== 'isAdmin' && key !== 'email' && key !== 'userId' && key !== 'role' && key !== 'displayName') {
            // General fields, exclude those managed elsewhere or immutable
            updatePayloadFS[key] = value;
        }
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
      // console.log(`AuthContext (updateUserProfile): Updating Firestore users/${user.id} with:`, JSON.parse(JSON.stringify(updatePayloadFS)));
      await updateDoc(userDocRef, updatePayloadFS);

      // Optimistically update local state and then confirm with Firestore
      const optimisticallyUpdatedUser = { ...user, ...updatePayloadFS } as User;
      if(firebaseAuthUpdatePayload.displayName) optimisticallyUpdatedUser.displayName = firebaseAuthUpdatePayload.displayName;
      setUser(optimisticallyUpdatedUser); // Optimistic update

      const updatedUserFromDbSnap = await getDoc(userDocRef);
      let finalUpdatedUser: User | null = null;
      if (updatedUserFromDbSnap.exists()) {
        finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        setUser(finalUpdatedUser); // Set with server-confirmed data
        setIsAdminUser(finalUpdatedUser.isAdmin === true);
        // console.log("AuthContext (updateUserProfile): Successfully updated and re-fetched user from Firestore:", JSON.parse(JSON.stringify(finalUpdatedUser)));
      } else {
         console.error("AuthContext (updateUserProfile): Failed to re-fetch profile after update for user:", user.id);
         finalUpdatedUser = optimisticallyUpdatedUser; // Fallback to optimistic if re-fetch fails
      }

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      // console.log(`AuthContext (updateUserProfile): After update - Profile for ${finalUpdatedUser.id} - Username: '${finalUpdatedUser.username}', Role: '${finalUpdatedUser.role}', Phone: '${finalUpdatedUser.phoneNumber}'. Complete: ${isProfileNowComplete}`);
      
      if (typeof window !== 'undefined') {
          const completingProfileFlag = localStorage.getItem('completingProfile');
          if (isProfileNowComplete && completingProfileFlag === 'true') {
            // console.log("AuthContext (updateUserProfile): Profile now complete AND was in completingProfile flow. Redirecting.");
            const redirectPathAfterCompletion = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('completingProfile'); // Clear this first
            if (redirectPathAfterCompletion) {
              localStorage.removeItem('redirectAfterLogin');
            }
            
            let targetPath = redirectPathAfterCompletion;
            if (targetPath === PROFILE_SETTINGS_PATH_AUTHOR) targetPath = null; // Avoid redirecting back to settings
            
            const finalRedirectPath = targetPath || (finalUpdatedUser.isAdmin ? '/admin/dashboard' : (finalUpdatedUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
            // console.log(`AuthContext (updateUserProfile): Redirecting to ${finalRedirectPath} after profile update completion.`);
            router.push(finalRedirectPath);
          }
      }
      toast({ title: "Success", description: "Your profile has been updated." });
      setLoading(false);
      return finalUpdatedUser;

    } catch(error: any) {
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
