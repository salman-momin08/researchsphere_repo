
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, Dispatch, SetStateAction, useContext } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation'; // Renamed to avoid conflict
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
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Kept for existing logic if any

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
    const isCreatorAdminEmail = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;
    let finalUserData: User;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as Partial<User>;
      console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);
      
      const dataToUpdate: Partial<User> = {
        email: email || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        // Prioritize existing data for core profile fields unless specifically being updated by profileDataFromSignup
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || (isCreatorAdminEmail ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true,
        updatedAt: serverTimestamp(),
        userId: uid, // Ensure userId is always present
      };

      if (existingData.createdAt) {
        dataToUpdate.createdAt = existingData.createdAt;
      } else {
        dataToUpdate.createdAt = serverTimestamp(); // Should ideally not happen if doc exists
      }
      
      console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToUpdate);
      await setDoc(userDocRef, dataToUpdate, { merge: true }); // Use setDoc with merge for updates to ensure all fields are covered

      const updatedSnap = await getDoc(userDocRef); // Re-fetch to get merged data and server timestamps
      if (!updatedSnap.exists()) throw new Error("Failed to re-fetch user document after update.");
      const rawUpdatedData = { id: uid, ...updatedSnap.data() } as any;
      
      finalUserData = {
        ...rawUpdatedData,
        createdAt: convertTimestampToISO(rawUpdatedData.createdAt),
        updatedAt: convertTimestampToISO(rawUpdatedData.updatedAt),
      } as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated existing user ${uid} with data:`, finalUserData);

    } else {
      console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore profile for ${uid}. Creating new one.`);
      const dataToSave: Omit<User, 'id'> & { createdAt: any, updatedAt: any } = {
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null, // Explicitly null if not provided
        role: profileDataFromSignup?.role || (isCreatorAdminEmail ? "Admin" : "Author"), // Default to Author
        phoneNumber: profileDataFromSignup?.phoneNumber || null, // Explicitly null
        institution: profileDataFromSignup?.institution || null, // Explicitly null
        researcherId: profileDataFromSignup?.researcherId || null, // Explicitly null
        isAdmin: isCreatorAdminEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for new user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge:true even for initial set
      const newSnap = await getDoc(userDocRef);
      if (!newSnap.exists()) throw new Error("Failed to create user document after setDoc.");
      const rawNewData = { id: uid, ...newSnap.data() } as any;
      finalUserData = {
        ...rawNewData,
        createdAt: convertTimestampToISO(rawNewData.createdAt),
        updatedAt: convertTimestampToISO(rawNewData.updatedAt),
      } as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Created new user ${uid} with data:`, finalUserData);
    }
    return finalUserData;

  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}" "${error.code}"`, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. Details: ${error.message}`, duration: 10000 });
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
  const searchParamsFromHook = useNextSearchParams(); 

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    console.log("AuthContext: Top of main useEffect. Pathname:", pathname, "IsMounted:", isMounted);
    if (!isMounted || !firebaseAuth) {
      if (isMounted && !firebaseAuth) {
        console.warn("AuthContext: Firebase Auth not available, but component is mounted. Setting loading to false.");
        setLoading(false);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser:", firebaseUser ? firebaseUser.uid : null);
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

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileStorageFlag = localStorage.getItem('completingProfile');
          }
          
          console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${pathname}, IsAdmin: ${appUser.isAdmin}, ProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}`);
          console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);


          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            console.log(`AuthContext: Profile incomplete for ${appUser.email}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            console.log(`AuthContext: Profile now complete for ${appUser.email} and on settings page with flag. Clearing flags and redirecting.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null; 
              }
            }
            const targetDashboard = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            const finalRedirect = redirectAfterLoginPath || targetDashboard;
            console.log(`AuthContext: Redirecting to ${finalRedirect} after profile completion.`);
            router.push(finalRedirect);
          } else if (redirectAfterLoginPath) {
            console.log(`AuthContext: Handling redirectAfterLoginPath: ${redirectAfterLoginPath} for ${appUser.email}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            
            let correctedRedirectPath = redirectAfterLoginPath;
            if (correctedRedirectPath.startsWith('/user/')) {
                correctedRedirectPath = correctedRedirectPath.replace('/user/', '/author/');
            }
             if (correctedRedirectPath === '/profile/settings' || correctedRedirectPath === '/user/profile/settings') {
                correctedRedirectPath = AUTHOR_PROFILE_SETTINGS_PATH;
            }


            if (appUser.isAdmin && !correctedRedirectPath.startsWith('/admin/')) {
                console.log(`AuthContext: Admin user, redirectAfterLoginPath ${correctedRedirectPath} is not admin path. Redirecting to ${ADMIN_DASHBOARD_PATH}.`);
                router.push(ADMIN_DASHBOARD_PATH);
            } else {
                console.log(`AuthContext: Redirecting to corrected path: ${correctedRedirectPath}`);
                router.push(correctedRedirectPath);
            }
          } else {
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === HOME_PATH || pathname === AUTHOR_PROFILE_SETTINGS_PATH;

            if (appUser.isAdmin) {
              if (onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                console.log(`AuthContext: Admin user on non-admin entry point ${pathname}. Redirecting to ${ADMIN_DASHBOARD_PATH}.`);
                if(pathname !== ADMIN_DASHBOARD_PATH) router.push(ADMIN_DASHBOARD_PATH);
              }
            } else if (onAuthPages) {
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              console.log(`AuthContext: Non-admin user on auth page ${pathname}. Redirecting to ${userDashboard}.`);
              router.push(userDashboard);
            }
          }
        } else {
          console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else {
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
      }
      console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
      setLoading(false);
    });
    return () => unsubscribe();
  }, [isMounted, router, pathname, searchParamsFromHook]); 


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available.";
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    setIsAdminUser(false); // Reset admin status on new login attempt

    let emailToLogin = identifier;
    console.log("AuthContext (login): Attempting login with identifier:", identifier);

    if (!identifier.includes('@')) {
      console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
            console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            console.warn(`AuthContext (login): Profile incomplete for username '${identifier}', email missing. Proceeding with identifier as potential email.`);
          }
        } else {
           console.log(`AuthContext (login): No user found with username '${identifier}'. Proceeding with identifier as potential email.`);
        }
      } catch (dbError: any) {
        setLoading(false);
        console.error("AuthContext (login): Error during username lookup:", dbError);
        toast({ variant: "destructive", title: "Login Error", description: `Error looking up username. Try login with email. ${dbError.message}` });
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    
    try {
      console.log("AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email:", emailToLogin);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful!", description: "Welcome back!" });
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
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      setLoading(false); 
      throw new Error(errorMessage);
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
      // Firebase handles email uniqueness. Username/phone checked by updateUserProfile after creation or on update.
      console.log("AuthContext (signup): Calling Firebase createUserWithEmailAndPassword for email:", data.email);
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      
      if (data.fullName && data.fullName !== cred.user.displayName) {
          await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      
      console.log("AuthContext (signup): Firebase user created. Now ensuring Firestore profile with signup data:", data);
      // ensureFirestoreUserProfile will be called by onAuthStateChanged, but we pass signup data here
      // to ensure it uses it for the initial profile creation.
      // The onAuthStateChanged listener will then pick up this newly created/updated profile.
      const profile = await ensureFirestoreUserProfile(cred.user, data); 
      if (!profile) {
          throw new Error("Failed to create Firestore profile after Firebase user creation.");
      }
      setUser(profile); // Optimistically set user to avoid waiting for onAuthStateChanged if possible
      setIsAdminUser(profile.isAdmin === true);

      toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
      // Redirection logic is now primarily handled by onAuthStateChanged based on profile completeness
      
    } catch (error: any) {
      let errorMessage = "An unknown error occurred during signup.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      console.error("AuthContext (signup): Signup error:", errorMessage, error);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      setLoading(false);
      throw new Error(errorMessage);
    } 
    // setLoading(false) will be called by onAuthStateChanged after all processing
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
      setUser(null); // Handled by onAuthStateChanged, but good for immediate UI update
      setIsAdminUser(false);
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
    setLoading(false); // Ensure loading is reset on social login error
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName} Login Error`;
    let toastMessage = `Could not sign in with ${providerName}. Please try again.`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again. If the issue persists, you might try an alternative sign-in method or check your browser settings.`;
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
            duration: 15000, 
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
      // onAuthStateChanged will handle setting user, profile creation and redirecting
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) is managed by onAuthStateChanged or handleSocialLoginError
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
    console.log("AuthContext (updateUserProfile): Starting profile update. Current user data:", user, "Update data:", updatedData);

    const updatePayloadFS: any = { updatedAt: serverTimestamp() };
    let firebaseAuthUpdatePayload: { displayName?: string } = {};

    // Prepare Firestore payload, ensuring empty strings become null
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
    
    console.log("AuthContext (updateUserProfile): Firestore update payload:", updatePayloadFS, "Firebase Auth update payload:", firebaseAuthUpdatePayload);

    try {
      // Uniqueness checks
      if (updatePayloadFS.username && updatePayloadFS.username !== user.username) {
        const usernameQuery = query(collection(firestoreDb, "users"), where("username", "==", updatePayloadFS.username));
        const usernameSnap = await getDocs(usernameQuery);
        const conflictingUser = usernameSnap.docs.find(doc => doc.id !== user.id);
        if (conflictingUser) {
            throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatePayloadFS.phoneNumber && updatePayloadFS.phoneNumber !== user.phoneNumber) {
        const phoneQuery = query(collection(firestoreDb, "users"), where("phoneNumber", "==", updatePayloadFS.phoneNumber));
        const phoneSnap = await getDocs(phoneQuery);
        const conflictingUser = phoneSnap.docs.find(doc => doc.id !== user.id);
        if (conflictingUser) {
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      if (firebaseAuth.currentUser && firebaseAuthUpdatePayload.displayName !== undefined && firebaseAuthUpdatePayload.displayName !== firebaseAuth.currentUser.displayName) {
          console.log("AuthContext (updateUserProfile): Updating Firebase Auth displayName.");
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      console.log("AuthContext (updateUserProfile): Updating Firestore document.");
      await updateDoc(userDocRef, updatePayloadFS);

      // Optimistically update local state & re-fetch for server timestamps
      const updatedUserForState: User = {
        ...user,
        ...updatePayloadFS, // Apply changes, but FirestoreTimestamps are local objects now
        displayName: firebaseAuthUpdatePayload.displayName !== undefined ? firebaseAuthUpdatePayload.displayName : user.displayName,
        // Keep existing timestamps or they'll be local JS Date objects
        createdAt: user.createdAt,
        updatedAt: new Date().toISOString(), // Optimistic update
      };
      console.log("AuthContext (updateUserProfile): Optimistically updated user state:", updatedUserForState);
      setUser(updatedUserForState);
      setIsAdminUser(updatedUserForState.isAdmin === true); // Ensure admin state is also updated

      // Re-fetch from Firestore to get accurate server timestamps
      const updatedUserFromDbSnap = await getDoc(userDocRef);
      let finalUpdatedUser: User | null = null;

      if (updatedUserFromDbSnap.exists()) {
        const rawData = { id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() } as any;
        finalUpdatedUser = {
          ...rawData,
          createdAt: convertTimestampToISO(rawData.createdAt),
          updatedAt: convertTimestampToISO(rawData.updatedAt),
        } as User;
        console.log("AuthContext (updateUserProfile): User profile re-fetched from Firestore:", finalUpdatedUser);
        setUser(finalUpdatedUser); 
        setIsAdminUser(finalUpdatedUser.isAdmin === true);
      } else {
         console.error("AuthContext (updateUserProfile): Profile update seemed to succeed but could not re-fetch profile from Firestore.");
         // Keep the optimistic update in this case
         finalUpdatedUser = updatedUserForState;
      }
      
      toast({ title: "Success", description: "Your profile has been updated." });

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      let completingProfileStorageFlag: string | null = null;
      let redirectPathAfterLoginStore: string | null = null;

      if (typeof window !== 'undefined') {
        completingProfileStorageFlag = localStorage.getItem('completingProfile');
        redirectPathAfterLoginStore = localStorage.getItem('redirectAfterLogin');
      }
      console.log(`AuthContext (updateUserProfile): Post-update checks - ProfileNowComplete: ${isProfileNowComplete}, CompletingFlag: ${completingProfileStorageFlag}, RedirectPath: ${redirectPathAfterLoginStore}`);

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        console.log("AuthContext (updateUserProfile): Profile now complete and 'completingProfile' flag was set. Clearing flags and redirecting.");
        if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            localStorage.removeItem('redirectAfterLogin'); 
        }
        const targetDashboard = finalUpdatedUser.isAdmin 
            ? ADMIN_DASHBOARD_PATH 
            : (finalUpdatedUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
        const finalRedirect = redirectPathAfterLoginStore || targetDashboard; // Prioritize stored redirect
        console.log(`AuthContext (updateUserProfile): Redirecting to ${finalRedirect}.`);
        router.push(finalRedirect);
      }
      setLoading(false);
      return finalUpdatedUser;

    } catch(error: any) {
        console.error("AuthContext (updateUserProfile): Error updating profile:", error.message, error);
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        setLoading(false);
        throw error;
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
                Please ensure these are correctly set in your environment variables (e.g., Vercel project settings or local <code>.env.local</code> file).
                Restart the application after verification.
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
       {!isMounted || (loading && !user && !firebaseAuth?.currentUser && !((!firebaseAuth || !firestoreDb) && isMounted) ) ? ( 
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
