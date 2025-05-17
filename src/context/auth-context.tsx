
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
  profileDataFromSignup?: Partial<SignupFormValues> // Used for initial profile data from signup form
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB is not available.");
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
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);
      
      // Merge existing data with new data from Firebase Auth or signup form
      // Prioritize existing data for fields not typically updated by Firebase Auth directly (username, role, phone, etc.)
      // unless explicitly provided by profileDataFromSignup (which happens during profile completion save)
      const dataToUpdate: Partial<User> & { updatedAt: any, createdAt?: any } = {
        userId: uid,
        email: email || existingData.email || null,
        // For displayName, prioritize profileDataFromSignup, then firebaseUser.displayName, then existingData.displayName
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        
        // Core profile fields: prioritize what's in profileDataFromSignup (if present, e.g., from profile completion form)
        // otherwise, keep existing Firestore data.
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? profileDataFromSignup.role : (existingData.role || (isCreatorAdminEmail ? "Admin" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        
        isAdmin: isCreatorAdminEmail || existingData.isAdmin === true,
        isSuspended: existingData.isSuspended === true, // Preserve suspended status
        updatedAt: serverTimestamp(),
      };
      if (existingData.createdAt) {
        dataToUpdate.createdAt = existingData.createdAt; 
      } else {
        dataToUpdate.createdAt = serverTimestamp(); 
      }
      
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToUpdate);
      await setDoc(userDocRef, dataToUpdate, { merge: true });

      const updatedSnap = await getDoc(userDocRef);
      if (!updatedSnap.exists()) throw new Error("Failed to re-fetch user document after update.");
      const rawUpdatedData = { id: uid, ...updatedSnap.data() } as any;
      
      finalUserData = {
        ...rawUpdatedData,
        createdAt: convertTimestampToISO(rawUpdatedData.createdAt),
        updatedAt: convertTimestampToISO(rawUpdatedData.updatedAt),
      } as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated existing user ${uid} with data:`, finalUserData);

    } else {
      // console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore profile for ${uid}. Creating new one.`);
      // This path is taken for brand new users (e.g., first social login, or first login after email/pass signup if doc wasn't created yet)
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
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for new user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge:true for safety even on create
      const newSnap = await getDoc(userDocRef);
      if (!newSnap.exists()) throw new Error("Failed to create user document after setDoc.");
      const rawNewData = { id: uid, ...newSnap.data() } as any;
      finalUserData = {
        ...rawNewData,
        createdAt: convertTimestampToISO(rawNewData.createdAt),
        updatedAt: convertTimestampToISO(rawNewData.updatedAt),
      } as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Created new user ${uid} with data:`, finalUserData);
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
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    // console.log(`AuthContext: Top of main useEffect. Pathname: ${pathname} IsMounted: ${isMounted}`);
    if (!isMounted || !firebaseAuth) {
      if (isMounted && !firebaseAuth) {
        setLoading(false);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log(`AuthContext (onAuthStateChanged): Firebase user state changed. UID: ${firebaseUser ? firebaseUser.uid : null}, Pathname: ${pathname}`);
      setActiveSocialLoginProvider(null);
      
      if (firebaseUser) {
        // Pass undefined for profileDataFromSignup here, as this is for existing session or new social login *before* profile completion form
        const appUser = await ensureFirestoreUserProfile(firebaseUser, undefined); 

        if (appUser) {
          setUser(appUser);
          const currentIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(currentIsAdmin);
          setShowLoginModal(false);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          let completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;
          
          const AUTHOR_PROFILE_SETTINGS_PATH_WITH_QUERY = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;

          if (redirectAfterLoginPath) {
            if (redirectAfterLoginPath.startsWith('/user/profile/settings') || redirectAfterLoginPath === '/profile/settings' || redirectAfterLoginPath === '/profile/settings?complete=true') {
              // console.log(`AuthContext: Correcting stale redirectAfterLoginPath from ${redirectAfterLoginPath} to ${AUTHOR_PROFILE_SETTINGS_PATH_WITH_QUERY}`);
              redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH_WITH_QUERY;
            }
          }
          
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${pathname}, IsAdmin: ${currentIsAdmin}, ProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}`);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);

          // Scenario 1: Profile is incomplete, send to complete it
          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
            // console.log(`AuthContext: Profile incomplete for ${appUser.email}. Current path: ${pathname}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH_WITH_QUERY}`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(AUTHOR_PROFILE_SETTINGS_PATH_WITH_QUERY);
          } 
          // Scenario 2: Profile is complete, but user is on profile settings page due to 'completingProfile' flow (e.g., refresh/back button)
          // This is a fallback if updateUserProfile hasn't redirected yet.
          else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            // console.log(`AuthContext: Profile complete, on profile settings page WITH completingProfile flag for ${appUser.email}. Clearing flags and redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              localStorage.removeItem('redirectAfterLogin'); 
            }
            const defaultDashboard = currentIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            const finalRedirect = (redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH && !redirectAfterLoginPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH)) 
                                  ? redirectAfterLoginPath 
                                  : defaultDashboard;
            // console.log(`AuthContext: Redirecting to ${finalRedirect} after ensuring profile completion from settings page (onAuthStateChanged fallback).`);
            router.push(finalRedirect);
          } 
          // Scenario 3: Handle redirectAfterLoginPath if set and profile completion is not the active flow
          else if (redirectAfterLoginPath && completingProfileStorageFlag !== 'true') {
            // console.log(`AuthContext: Handling redirectAfterLoginPath: ${redirectAfterLoginPath} for ${appUser.email}`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            
            let targetPath = redirectAfterLoginPath;
            if (currentIsAdmin && !targetPath.startsWith('/admin/')) {
                targetPath = ADMIN_DASHBOARD_PATH;
            } else if (!currentIsAdmin && targetPath.startsWith('/admin/')) {
                targetPath = AUTHOR_DASHBOARD_PATH; // Or appropriate non-admin dashboard
            }
            // console.log(`AuthContext: Redirecting to stored/corrected path: ${targetPath}`);
            router.push(targetPath);
          } 
          // Scenario 4: Default redirects from auth pages or for admins to their dashboard
          else if (completingProfileStorageFlag !== 'true') { 
            const onAuthPages = [LOGIN_PATH, SIGNUP_PATH].includes(pathname);
            const onNonAdminEntryPoint = onAuthPages || pathname === HOME_PATH;

            if (currentIsAdmin) {
              if (onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                // console.log(`AuthContext: Admin user on non-admin entry point ${pathname}. Redirecting to ${ADMIN_DASHBOARD_PATH}.`);
                if(pathname !== ADMIN_DASHBOARD_PATH) router.push(ADMIN_DASHBOARD_PATH);
              }
            } else if (onAuthPages && isProfileComplete) { // Non-admin on auth page, profile is complete
              const userDashboard = appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              // console.log(`AuthContext: Non-admin user on auth page ${pathname}, profile complete. Redirecting to ${userDashboard}.`);
              router.push(userDashboard);
            }
          }
        } else {
          // console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else {
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
      }
      // console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
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
    setIsAdminUser(false); 

    let emailToLogin = identifier;
    // console.log("AuthContext (login): Attempting login with identifier:", identifier);

    if (!identifier.includes('@')) {
      // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDocData = querySnapshot.docs[0].data();
          if (userDocData.email) {
            emailToLogin = userDocData.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          }
        }
      } catch (dbError: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Login Error", description: `Error looking up username. Try login with email. ${dbError.message}` });
        throw new Error(`Error during username lookup: ${dbError.message}.`);
      }
    }
    
    try {
      // console.log("AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email:", emailToLogin);
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
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      
      if (data.fullName && data.fullName !== cred.user.displayName) {
          await updateFirebaseProfile(cred.user, { displayName: data.fullName });
      }
      
      // Pass `data` (from SignupFormValues) to ensure these fields are used for the new Firestore document
      await ensureFirestoreUserProfile(cred.user, data); 

      toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
      // onAuthStateChanged will handle the rest, including profile completion redirect if necessary
      
    } catch (error: any) {
      let errorMessage = "An unknown error occurred during signup.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'The email address is not valid.';
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMessage = 'Email/password accounts are not enabled.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'The password is too weak.';
      }
      else {
        errorMessage = error.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      setLoading(false);
      throw new Error(errorMessage);
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
      setUser(null); 
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
    setLoading(false); 
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName} Login Error`;
    let toastMessage = `Could not sign in with ${providerName}. Please try again.`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
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
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle profile creation/fetch and redirection.
    } catch (error) {
      handleSocialLoginError(error, providerName);
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
    // console.log("AuthContext (updateUserProfile): Starting profile update. Current user data:", user, "Update data:", updatedData);

    const updatePayloadFS: any = { updatedAt: serverTimestamp() };
    let firebaseAuthUpdatePayload: { displayName?: string } = {};

    if (updatedData.displayName !== undefined) {
      const newDisplayName = updatedData.displayName || user.displayName || ""; 
      firebaseAuthUpdatePayload.displayName = newDisplayName;
      updatePayloadFS.displayName = newDisplayName;
    }
    if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username || null;
    if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || null;
    if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber || null;
    if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution || null;
    if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId || null;
    
    // console.log("AuthContext (updateUserProfile): Firestore update payload:", updatePayloadFS, "Firebase Auth update payload:", firebaseAuthUpdatePayload);

    try {
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
          // console.log("AuthContext (updateUserProfile): Updating Firebase Auth displayName.");
          await updateFirebaseProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      // console.log("AuthContext (updateUserProfile): Updating Firestore document.");
      await updateDoc(userDocRef, updatePayloadFS);

      // Immediately update local state for responsiveness
      const optimisticallyUpdatedUser: User = {
        ...user,
        displayName: firebaseAuthUpdatePayload.displayName !== undefined ? firebaseAuthUpdatePayload.displayName : user.displayName,
        username: updatePayloadFS.username !== undefined ? updatePayloadFS.username : user.username,
        role: updatePayloadFS.role !== undefined ? updatePayloadFS.role : user.role,
        phoneNumber: updatePayloadFS.phoneNumber !== undefined ? updatePayloadFS.phoneNumber : user.phoneNumber,
        institution: updatePayloadFS.institution !== undefined ? updatePayloadFS.institution : user.institution,
        researcherId: updatePayloadFS.researcherId !== undefined ? updatePayloadFS.researcherId : user.researcherId,
        updatedAt: new Date().toISOString(), // Optimistic
      };
      setUser(optimisticallyUpdatedUser);
      setIsAdminUser(optimisticallyUpdatedUser.isAdmin === true);
      // console.log("AuthContext (updateUserProfile): Optimistically updated local user state:", optimisticallyUpdatedUser);

      // Optionally, re-fetch from Firestore to get server timestamps, but optimistic update is often enough for UI.
      // For this fix, we prioritize the optimistic update and its effect on redirection.
      const finalUpdatedUser = optimisticallyUpdatedUser; 
      
      toast({ title: "Success", description: "Your profile has been updated." });

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;
      // console.log(`AuthContext (updateUserProfile): Post-update checks - ProfileNowComplete: ${isProfileNowComplete}, CompletingFlag: ${completingProfileStorageFlag}`);

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        // console.log("AuthContext (updateUserProfile): Profile now complete and 'completingProfile' flag was set. Clearing flags and redirecting.");
        let redirectPathAfterLoginStore = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
        
        if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            localStorage.removeItem('redirectAfterLogin'); 
        }
        
        if (redirectPathAfterLoginStore && (redirectPathAfterLoginStore.startsWith(AUTHOR_PROFILE_SETTINGS_PATH))) {
            // console.log(`AuthContext (updateUserProfile): redirectAfterLoginStore was profile settings (${redirectPathAfterLoginStore}), clearing to allow default dashboard redirect.`);
            redirectPathAfterLoginStore = null; 
        }
        
        const defaultDashboard = finalUpdatedUser.isAdmin 
            ? ADMIN_DASHBOARD_PATH 
            : (finalUpdatedUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
        const finalRedirect = redirectPathAfterLoginStore || defaultDashboard; 
        // console.log(`AuthContext (updateUserProfile): Redirecting to ${finalRedirect} after profile save.`);
        router.push(finalRedirect);
      }
      setLoading(false);
      return finalUpdatedUser;

    } catch(error: any) {
        // console.error("AuthContext (updateUserProfile): Error updating profile:", error.message, error);
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        setLoading(false);
        throw error;
    }
  };


  if (!isMounted || (!firebaseAuth || !firestoreDb)) {
    const configError = (!firebaseAuth || !firestoreDb) && isMounted;
    return (
        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
          <LoadingSpinner size={48} />
          <p className="ml-3">
            {configError ? "Application Configuration Error. Check Firebase setup." : "Initializing Application..."}
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
       {(loading && !user && firebaseAuth && firestoreDb ) ? ( 
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

    