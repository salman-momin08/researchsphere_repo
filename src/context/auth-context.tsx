
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
  deleteDoc, 
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';
const MOCK_ADMIN_EMAIL = 'admin@example.com'; 

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
  return String(timestamp); 
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

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile found for ${uid}:`, JSON.parse(JSON.stringify(existingData)));
      
      dataToSave = {
        ...existingData, // Start with existing data
        id: uid,
        userId: uid, 
        email: email, 
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || existingData.displayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || existingData.photoURL || null,
        // For other fields, prioritize existing unless explicitly in profileDataFromSignup (e.g., during profile completion)
        username: existingData.username || null, // Default to existing or null
        role: existingData.role || (email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL ? "Admin" : "Author"), // Default to existing or derived
        phoneNumber: existingData.phoneNumber || null,
        institution: existingData.institution || null,
        researcherId: existingData.researcherId || null,
        isAdmin: (email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL) ? true : (existingData.isAdmin === true),
        updatedAt: serverTimestamp(),
        // createdAt should ideally not change after initial creation
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(convertTimestampToISO(existingData.createdAt)!))) : serverTimestamp(),
      };

      // If profileDataFromSignup is provided (e.g. from profile completion form), merge it carefully
      if (profileDataFromSignup && Object.keys(profileDataFromSignup).length > 0) {
        console.log("AuthContext (ensureFirestoreUserProfile): Merging with profileDataFromSignup for existing user:", profileDataFromSignup);
        if (profileDataFromSignup.username !== undefined) dataToSave.username = profileDataFromSignup.username || null;
        if (profileDataFromSignup.role !== undefined) dataToSave.role = profileDataFromSignup.role || (email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL ? "Admin" : "Author");
        if (profileDataFromSignup.phoneNumber !== undefined) dataToSave.phoneNumber = profileDataFromSignup.phoneNumber || null;
        if (profileDataFromSignup.institution !== undefined) dataToSave.institution = profileDataFromSignup.institution || null;
        if (profileDataFromSignup.researcherId !== undefined) dataToSave.researcherId = profileDataFromSignup.researcherId || null;
        // isAdmin should not be updated from profileDataFromSignup
      }

    } else {
      console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore profile for ${uid}. Creating new.`);
      const isCreatorAdmin = email === ADMIN_CREATOR_EMAIL || email === MOCK_ADMIN_EMAIL;
      dataToSave = {
        id: uid,
        userId: uid,
        email: email,
        displayName: profileDataFromSignup?.fullName || firebaseDisplayName || (email ? email.split('@')[0] : "User"),
        photoURL: firebasePhotoURL || null,
        username: profileDataFromSignup?.username || null, // Explicitly null if not provided
        role: profileDataFromSignup?.role || (isCreatorAdmin ? "Admin" : "Author"), // Default to Author or Admin
        phoneNumber: profileDataFromSignup?.phoneNumber || null, // Explicitly null
        institution: profileDataFromSignup?.institution || null, // Explicitly null
        researcherId: profileDataFromSignup?.researcherId || null, // Explicitly null
        isAdmin: isCreatorAdmin,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    (Object.keys(dataToSave) as Array<keyof typeof dataToSave>).forEach(key => {
        if (dataToSave[key] === undefined) {
            (dataToSave as any)[key] = null;
        }
        if (key === 'institution' && dataToSave.institution === "") dataToSave.institution = null;
        if (key === 'researcherId' && dataToSave.researcherId === "") dataToSave.researcherId = null;
    });

    console.log(`AuthContext (ensureFirestoreUserProfile): Data to save/merge for ${uid}:`, JSON.parse(JSON.stringify(dataToSave)));
    await setDoc(userDocRef, dataToSave, { merge: true }); 
    
    const userDocAfterSave = await getDoc(userDocRef);
    if (userDocAfterSave.exists()) {
      const finalData = userDocAfterSave.data();
      console.log(`AuthContext (ensureFirestoreUserProfile): Profile saved/updated for ${uid}. Fetched data:`, JSON.parse(JSON.stringify(finalData)));
      return convertUserDocumentTimestamps({
        ...finalData,
        id: userDocAfterSave.id,
        isAdmin: finalData.isAdmin === true, 
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
    if (!isMounted || !firebaseAuth) {
      if (isMounted && !firebaseAuth) setLoading(false);
      return;
    }

    console.log("AuthContext: onAuthStateChanged listener attached.");
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext: onAuthStateChanged triggered. Firebase user:", firebaseUser?.uid || "null");
      setLoading(true); 
      setActiveSocialLoginProvider(null);

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          const currentIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(currentIsAdmin);
          setShowLoginModal(false); 

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          const onProfileSettingsPage = pathname === '/author/profile/settings';
          const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
          
          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

          console.log(`AuthContext: Redirection check. Pathname: ${pathname}, isAdmin: ${currentIsAdmin}, ProfileComplete: ${isProfileComplete}, redirectAfterLogin: ${redirectAfterLoginPath}, completingProfileFlag: ${completingProfileStorageFlag}`);
          console.log(`AuthContext: appUser for check (username: ${appUser.username}, role: ${appUser.role}, phone: ${appUser.phoneNumber})`);

          if (!isProfileComplete && !onProfileSettingsPage) {
            const targetRedirect = '/author/profile/settings?complete=true';
            console.log(`AuthContext: Profile INCOMPLETE. Current path: ${pathname}. Redirecting to ${targetRedirect}`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(targetRedirect);
          } else if (isProfileComplete && onProfileSettingsPage && (searchParamsFromHook?.get('complete') === 'true' || completingProfileStorageFlag === 'true')) {
            console.log(`AuthContext: Profile COMPLETE and ON profile settings page with complete flag. Redirecting away.`);
            if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
            let targetPath = redirectAfterLoginPath;
            if (typeof window !== 'undefined' && redirectAfterLoginPath) localStorage.removeItem('redirectAfterLogin');
            
            if (!targetPath) { 
              targetPath = currentIsAdmin ? '/admin/dashboard' : '/author/dashboard';
            }
            console.log(`AuthContext: Redirecting to targetPath after profile completion: ${targetPath}`);
            router.push(targetPath);
          } else if (redirectAfterLoginPath) {
            console.log(`AuthContext: Found redirectAfterLoginPath: ${redirectAfterLoginPath}.`);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            let correctedRedirectPath = redirectAfterLoginPath;
            if (redirectAfterLoginPath === '/user/profile/settings') { 
                correctedRedirectPath = '/author/profile/settings';
                if (searchParamsFromHook?.has('complete') || completingProfileStorageFlag === 'true') {
                    correctedRedirectPath += '?complete=true';
                }
            }
            console.log(`AuthContext: Redirecting to correctedRedirectPath: ${correctedRedirectPath}`);
            router.push(correctedRedirectPath);
          } else {
            const onNonAdminEntryPoint = ['/', '/login', '/signup', '/forgot-password', '/author/profile/settings'].includes(pathname) || pathname.startsWith('/author/profile/settings'); // include if on profile settings
            const onAdminArea = pathname.startsWith('/admin/');

            if (currentIsAdmin && onNonAdminEntryPoint && !onAdminArea) {
              if (pathname !== '/admin/dashboard') {
                 console.log(`AuthContext: Admin on non-admin entry point '${pathname}'. Redirecting to /admin/dashboard.`);
                 router.push('/admin/dashboard');
              } else {
                console.log("AuthContext: Admin on admin dashboard, no redirect needed.");
              }
            } else if (!currentIsAdmin && onAuthPages) {
              const userDashboard = appUser.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard';
              if (pathname !== userDashboard) {
                 console.log(`AuthContext: Non-admin on auth page '${pathname}'. Redirecting to ${userDashboard}.`);
                 router.push(userDashboard);
              } else {
                console.log("AuthContext: Non-admin on their dashboard, no redirect needed.");
              }
            } else {
              console.log("AuthContext: No specific redirect condition met. Staying on current page or default behavior.");
            }
          }
        } else { 
          console.error("AuthContext: ensureFirestoreUserProfile returned null. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else { 
        console.log("AuthContext: No Firebase user session found.");
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false); 
      // console.log("AuthContext: setLoading(false). User state:", user, "isAdmin:", isAdminUser);
    });

    return () => {
      console.log("AuthContext: onAuthStateChanged listener detached.");
      unsubscribe();
    };
  }, [isMounted, pathname, router, searchParamsFromHook]); 


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      const msg = "Authentication or Database service not available for login.";
      console.error("AuthContext (login):", msg);
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
            const errMessage = `User profile incomplete for username '${identifier}' (missing email).`;
            //  console.error("AuthContext (login):", errMessage);
            throw new Error(errMessage);
          }
        } else {
          setLoading(false);
          const errMessage = `No user found with username '${identifier}'.`;
          // console.warn("AuthContext (login):", errMessage);
          throw new Error(errMessage); 
        }
      } catch (dbError: any) {
        setLoading(false);
        const errMessage = `Error during username lookup: ${dbError.message}.`;
        // console.error("AuthContext (login):", errMessage, dbError);
        throw new Error(errMessage);
      }
    }
    
    // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful!", description: "Welcome back!" });
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
      // console.error("AuthContext (signup):", msg);
      toast({ variant: "destructive", title: "Service Error", description: msg });
      throw new Error(msg);
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    if (data.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
            setLoading(false);
            const errMessage = "Username already taken. Please choose another one.";
            // console.warn("AuthContext (signup):", errMessage);
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
            // console.warn("AuthContext (signup):", errMessage);
            toast({ variant: "destructive", title: "Signup Failed", description: errMessage });
            throw new Error(errMessage);
        }
    }

    let firebaseUserInstance: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUserInstance = cred.user;
      // console.log("AuthContext (signup): Firebase Auth user created:", firebaseUserInstance.uid);
    } catch (authError: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = authError.message || errorMessage;
      }
      // console.error("AuthContext (signup): Firebase Auth creation error:", errorMessage, authError);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    try {
        if (data.fullName && data.fullName !== firebaseUserInstance.displayName) {
            await updateProfile(firebaseUserInstance, { displayName: data.fullName });
            // console.log("AuthContext (signup): Firebase Auth profile displayName updated for", firebaseUserInstance.uid);
        }
        const appUser = await ensureFirestoreUserProfile(firebaseUserInstance, data);
        if (!appUser) {
          throw new Error("Failed to create or sync Firestore profile after signup.");
        }
        toast({ title: "Signup Successful!", description: "Welcome! Please complete your profile if prompted." });
    } catch (profileError: any) {
        setLoading(false);
        // console.error("AuthContext (signup): Firestore profile sync error after auth creation:", profileError.message, profileError);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup failed: ${profileError.message}. Please try logging in. If issues persist, contact support.`, duration: 10000 });
    }
  };

  const logout = async () => {
    if (!firebaseAuth) {
      // console.warn("AuthContext (logout): Firebase Auth not available.");
      return;
    }
    // console.log("AuthContext (logout): Attempting logout.");
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/'); 
    } catch (error: any) {
      setLoading(false);
      // console.error("AuthContext (logout): Logout failed:", error.message, error);
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again. If the issue persists, your browser might be blocking popups aggressively or there might be network issues.`;
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Try logging in with that method.";
          break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    //  console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, toastMessage, firebaseError);
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
      // console.error("AuthContext (processSocialLogin):", msg);
      toast({variant: "destructive", title: "Login Error", description: msg});
      return;
    }
    // console.log(`AuthContext (processSocialLogin): Attempting ${providerName} login.`);
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) {
      const msg = "Authentication service not available for password reset.";
      // console.error("AuthContext (sendPasswordResetEmail):", msg);
      throw new Error(msg);
    }
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable. Cannot update profile.";
      // console.error("AuthContext (updateUserProfile):", errorMsg);
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
        updatePayloadFS[key] = value === "" ? null : value;
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
          await updateProfile(firebaseAuth.currentUser, firebaseAuthUpdatePayload);
          //  console.log("AuthContext (updateUserProfile): Firebase Auth displayName updated.");
      }
      
      const userDocRef = doc(firestoreDb, "users", user.id);
      // console.log("AuthContext (updateUserProfile): Updating Firestore with payload:", JSON.parse(JSON.stringify(updatePayloadFS)));
      await updateDoc(userDocRef, updatePayloadFS);
      
      const optimisticallyUpdatedUser = { ...user, ...updatedData, updatedAt: new Date().toISOString() } as User;
      setUser(optimisticallyUpdatedUser);
      setIsAdminUser(optimisticallyUpdatedUser.isAdmin === true); 

      // console.log("AuthContext (updateUserProfile): Optimistically updated local user state.");
      
      const updatedUserFromDbSnap = await getDoc(userDocRef);
      if (updatedUserFromDbSnap.exists()) {
        const finalUpdatedUser = convertUserDocumentTimestamps({ id: updatedUserFromDbSnap.id, ...updatedUserFromDbSnap.data() }) as User;
        setUser(finalUpdatedUser); 
        setIsAdminUser(finalUpdatedUser.isAdmin === true);
        // console.log("AuthContext (updateUserProfile): Successfully updated and re-fetched profile:", finalUpdatedUser);
        
        const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
        const currentCompletingProfileFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && currentCompletingProfileFlag === 'true') {
          // console.log("AuthContext (updateUserProfile): Profile now complete, redirecting from profile settings.");
          if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
          let targetPath: string | null = null;
          if (typeof window !== 'undefined') {
            targetPath = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin');
          }
          const finalTargetPath = targetPath || (finalUpdatedUser.isAdmin ? '/admin/dashboard' : '/author/dashboard');
          // console.log(`AuthContext (updateUserProfile): Redirecting to ${finalTargetPath} after profile completion.`);
          router.push(finalTargetPath);
        }
        
        toast({ title: "Success", description: "Your profile has been updated." });
        setLoading(false);
        return finalUpdatedUser;
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }

    } catch(error: any) {
        // console.error("AuthContext (updateUserProfile): Update profile error:", error.message, error);
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
        setLoading(false);
        throw error; 
    }
  };

  if (!isMounted || (loading && !user && (!firebaseAuth || !firebaseAuth.currentUser))) {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
        <LoadingSpinner size={48} />
        <p className="ml-3">Initializing Application...</p>
      </div>
    );
  }

  if (isMounted && (!firebaseAuth || !firestoreDb)) {
     return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle text-destructive mb-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            <h1 className="text-2xl font-bold mb-2">Application Configuration Error</h1>
            <p className="text-muted-foreground max-w-md">
                Firebase services are not available. Please ensure your Firebase project is correctly configured (API keys, Project ID, etc.) in your environment variables and that Firestore is enabled.
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

    