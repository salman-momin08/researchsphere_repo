
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import {
  auth as firebaseAuth,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider,
  db as firestoreDb
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

const MOCK_ADMIN_EMAIL = 'admin@example.com';
const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) {
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      const determinedIsAdmin = firestoreIsAdmin === true;

      return {
        id: userSnap.id,
        email: docData.email || null,
        displayName: docData.displayName || null,
        photoURL: docData.photoURL || null,
        username: docData.username || null,
        role: docData.role || null,
        phoneNumber: docData.phoneNumber || null,
        institution: docData.institution || null,
        researcherId: docData.researcherId || null,
        isAdmin: determinedIsAdmin,
        createdAt: docData.createdAt instanceof Timestamp ? docData.createdAt.toDate().toISOString() : docData.createdAt,
        updatedAt: docData.updatedAt instanceof Timestamp ? docData.updatedAt.toDate().toISOString() : docData.updatedAt,
      };
    } else {
      return null;
    }
  } catch (error: any) {
    toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};

const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileData?: Partial<SignupFormValues & { isSocialSignIn?: boolean; isAdminOverride?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  try {
    const userSnap = await getDoc(userDocRef);
    const nowServerTimestamp = serverTimestamp();
    const isCreatorAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    let baseData: Partial<User> = {
      id: firebaseUid,
      email: firebaseUserObject.email,
      displayName: profileData?.fullName || firebaseUserObject.displayName || (profileData?.isSocialSignIn && firebaseUserObject.email ? firebaseUserObject.email.split('@')[0] : null) || "User",
      photoURL: firebaseUserObject.photoURL || null,
      username: profileData?.username || null,
      role: profileData?.role || (isCreatorAdminByEmail ? "Admin" : (profileData?.isSocialSignIn ? "Author" : "Author")),
      phoneNumber: profileData?.phoneNumber || null,
      institution: profileData?.institution || null,
      researcherId: profileData?.researcherId || null,
      isAdmin: profileData?.isAdminOverride !== undefined ? profileData.isAdminOverride : (isCreatorAdminByEmail || false),
    };

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData,
        ...baseData,
        updatedAt: nowServerTimestamp,
      };
      if (existingData.isAdmin === true && !isCreatorAdminByEmail && profileData?.isAdminOverride === undefined) {
         dataToSave.isAdmin = true;
      }
       if (existingData.createdAt && !dataToSave.createdAt) {
        dataToSave.createdAt = existingData.createdAt;
      }
    } else {
      dataToSave = {
        userId: firebaseUid,
        ...baseData,
        createdAt: nowServerTimestamp,
        updatedAt: nowServerTimestamp,
      };
    }
    
    await setDoc(userDocRef, dataToSave, { merge: true });
    const fetchedProfile = await fetchUserProfileFromFirestore(firebaseUid);
    if (!fetchedProfile) {
        console.error("AuthContext (ensureFirestoreUserProfile): Profile fetched as null immediately after setDoc for UID", firebaseUid);
    }
    return fetchedProfile;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Critical error creating/updating Firestore profile for UID ${firebaseUid}. This may be due to Firestore rules or connectivity issues. Error: ${error.message}`, error.code, error);
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
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (!isMounted && typeof window !== 'undefined') {
        // console.warn("AuthContext: Waiting for component to mount before initializing auth state listener.");
      } else if (isMounted && (!firebaseAuth || !firestoreDb)) {
        console.error("AuthContext: Firebase Auth or Firestore DB instance is not available. Client-side features may be limited.");
        toast({ variant: "destructive", title: "Initialization Error", description: "Core services failed to load. Please refresh or contact support."});
      }
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        let appUser = await fetchUserProfileFromFirestore(firebaseUser.uid);

        if (!appUser) {
          appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });
        }

        if (appUser) {
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);
          
          appUser.isAdmin = finalIsAdmin;

          setUser(appUser);
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }

          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          const isCompletingProfilePage = pathname === '/profile/settings' && (isMounted ? searchParamsFromHook?.get('complete') === 'true' : false);


          if (!isProfileConsideredComplete && !isCompletingProfilePage) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else {
            if (isProfileConsideredComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
              localStorage.removeItem('completingProfile');
            }

            if (redirectAfterLoginPath) {
              router.push(redirectAfterLoginPath);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            } else {
              const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
              const comingFromProfileCompletion = pathname === '/profile/settings' && (isMounted && searchParamsFromHook?.get('complete') === 'true');
              const onNonAdminEntryPoint = onAuthPages || pathname === '/' || comingFromProfileCompletion;

              if (appUser.isAdmin) {
                 if (onNonAdminEntryPoint && !pathname.startsWith('/admin')) {
                   router.push('/admin/dashboard');
                 }
              } else { 
                if ((onAuthPages || comingFromProfileCompletion) && pathname !== '/') {
                   router.push('/');
                }
              }
            }
          }
        } else {
          console.error(
            "AuthContext (onAuthStateChanged): User authenticated with Firebase, but ensureFirestoreUserProfile (profile sync/creation in Firestore) failed or returned null. This indicates a problem saving/retrieving the user's profile details. Logging out Firebase user to prevent inconsistent state."
          );
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else { 
        setUser(null);
        setIsAdminUser(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => {
      unsubscribe();
    };
  }, [isMounted, pathname, router, searchParamsFromHook]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
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
            setLoading(false);
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email.`;
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          toast({ variant: "destructive", title: "Login Failed", description: "Invalid email/username or password." });
          throw new Error("Invalid email/username or password.");
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged handles success
      toast({ title: "Login Successful", description: "Welcome back!" });
    } catch (error) {
      setLoading(false);
      setActiveSocialLoginProvider(null);
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
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    const usersRef = collection(firestoreDb, "users");
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        const errorMsg = "Username is already taken. Please choose another one.";
        toast({ variant: "destructive", title: "Signup Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    if (data.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            const errorMsg = "Phone number already in use. Please use a different one.";
            toast({ variant: "destructive", title: "Signup Failed", description: errorMsg });
            throw new Error(errorMsg);
        }
    }

    let firebaseUser: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
    } catch (authError: any) {
      setLoading(false);
      setActiveSocialLoginProvider(null);
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
        const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;
        await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, {...data, isAdminOverride: isAdminByEmail });
        // onAuthStateChanged will now pick up the new user
        toast({ title: "Signup Successful", description: "Welcome to ResearchSphere!" });
      } catch (profileError: any) {
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      // setLoading(false) handled by onAuthStateChanged
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setLoading(false);
    setActiveSocialLoginProvider(null);

    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing. If unintentional, please check your browser's popup settings and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 10000, 
          });
          return;
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
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 7000 });
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
      // onAuthStateChanged handles success
      toast({ title: `${providerName} Sign-In Successful`, description: "Welcome!" });
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      toast({ variant: "destructive", title: "Error", description: "User not logged in or database service unavailable."});
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const usersRef = collection(firestoreDb, "users");

      if (updatedData.username && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        const conflictingUser = usernameSnap.docs.find(docSnap => docSnap.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        const conflictingUser = phoneSnap.docs.find(docSnap => docSnap.id !== user.id);
        if (conflictingUser) {
            setLoading(false);
            throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const updatePayloadFS: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };
      delete (updatePayloadFS as any).isAdmin;

      if (firebaseAuth.currentUser) {
          if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
            await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
          }
      }

      await updateDoc(userDocRef, updatePayloadFS);
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb);
        setIsAdminUser(updatedUserFromDb.isAdmin === true);

        if (typeof window !== 'undefined') {
          const completingProfileFlag = localStorage.getItem('completingProfile') === 'true';
          if (completingProfileFlag) {
            const isProfileNowComplete = updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber;
            if (isProfileNowComplete) {
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname.startsWith('/profile/settings')) {
                  const defaultRedirect = updatedUserFromDb.isAdmin ? '/admin/dashboard' : '/';
                  router.push(defaultRedirect);
              }
            }
          }
        }
        return updatedUserFromDb;
      } else {
        throw new Error("Profile updated in Firestore, but failed to reload latest data into context.");
      }
    } catch(error: any) {
      if (error.message !== "Username already taken. Please choose another one." &&
          error.message !== "Phone number already in use. Please use a different one.") {
      }
      throw error; 
    } finally {
        setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{
        user, loading, login, signup, logout,
        loginWithGoogle, loginWithGitHub,
        sendPasswordResetEmail, updateUserProfile,
        showLoginModal, setShowLoginModal, isAdmin: isAdminUser,
        isSocialLoginInProgress: activeSocialLoginProvider !== null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
