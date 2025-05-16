
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
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) return null;
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      const determinedIsAdmin = firestoreIsAdmin === true;

      const fetchedUser: User = {
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
      return fetchedUser;
    }
    return null;
  } catch (error: any) {
    toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};

const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) return null;
  const userDocRef = doc(firestoreDb, "users", firebaseUid);

  try {
    const userSnap = await getDoc(userDocRef);
    const isAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData,
        email: firebaseUserObject.email || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseUserObject.displayName || existingData.displayName || "User",
        photoURL: firebaseUserObject.photoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? (profileDataFromSignup.role || "Author") : (existingData.role || "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        isAdmin: isAdminByEmail || existingData.isAdmin || false,
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt || serverTimestamp(),
      };
    } else {
      dataToSave = {
        id: firebaseUid,
        email: firebaseUserObject.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseUserObject.displayName || (profileDataFromSignup?.isSocialSignIn && firebaseUserObject.email ? firebaseUserObject.email.split('@')[0] : "User"),
        photoURL: firebaseUserObject.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: profileDataFromSignup?.role || (isAdminByEmail ? "Admin" : (profileDataFromSignup?.isSocialSignIn ? "Author" : "Author")),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isAdminByEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }
    
    // Ensure all optional fields are explicitly null if not set, to prevent 'undefined' in Firestore
    dataToSave.username = dataToSave.username === undefined ? null : dataToSave.username;
    dataToSave.role = dataToSave.role === undefined ? "Author" : dataToSave.role;
    dataToSave.phoneNumber = dataToSave.phoneNumber === undefined ? null : dataToSave.phoneNumber;
    dataToSave.institution = dataToSave.institution === undefined ? null : dataToSave.institution;
    dataToSave.researcherId = dataToSave.researcherId === undefined ? null : dataToSave.researcherId;
    dataToSave.isAdmin = dataToSave.isAdmin === undefined ? false : dataToSave.isAdmin;

    await setDoc(userDocRef, dataToSave, { merge: true });
    const fetchedProfile = await fetchUserProfileFromFirestore(firebaseUid);
    return fetchedProfile;
  } catch (error: any) {
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
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        setLoading(false);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        let appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });

        if (appUser) {
          const rawIsAdminFromProfile = appUser.isAdmin;
          const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);
          
          appUser.isAdmin = finalIsAdmin;

          setUser(appUser);
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }

          const isProfileConsideredComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          const currentSearchParams = searchParamsFromHook; // Use the hook's value directly
          const isCompletingProfilePage = pathname === '/profile/settings' && currentSearchParams?.get('complete') === 'true';

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
              const onNonAdminEntryPoint = ['/login', '/signup', '/forgot-password', '/', '/profile/settings'].includes(pathname) || (pathname === '/profile/settings' && currentSearchParams?.get('complete') === 'true');
              
              if (appUser.isAdmin) {
                if (onNonAdminEntryPoint && !pathname.startsWith('/admin/dashboard')) {
                  router.push('/admin/dashboard');
                }
              } else { 
                if (onNonAdminEntryPoint && pathname !== '/') {
                  router.push('/');
                }
              }
            }
          }
        } else {
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
        await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, data);
        toast({ title: "Signup Successful", description: "Welcome to ResearchSphere! Please complete your profile if prompted." });
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
      setLoading(false); 
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
          toastMessage = `The ${providerName} sign-in popup was closed before completing. If this was unintentional, please ensure popups are allowed and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 7000, 
          });
          // Reset loading states here as onAuthStateChanged might not fire
          setLoading(false);
          setActiveSocialLoginProvider(null);
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
    setLoading(false); // Ensure loading is reset for other social login errors too
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

 const isUsernameTakenInFirestore = async (username: string, excludeUserId?: string): Promise<boolean> => {
    if (!firestoreDb || !username || !username.trim()) return false;
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, where("username", "==", username));
    try {
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return false;
      if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
      return true; 
    } catch (error: any) {
      toast({variant: "destructive", title: "Validation Error", description: "Could not verify username uniqueness. Please try again."});
      return true; 
    }
  };

  const isPhoneNumberTakenInFirestore = async (phoneNumber: string, excludeUserId?: string): Promise<boolean> => {
    if (!firestoreDb || !phoneNumber || !phoneNumber.trim()) return false;
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, where("phoneNumber", "==", phoneNumber));
    try {
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return false;
      if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
      return true; 
    } catch (error: any) {
      toast({variant: "destructive", title: "Validation Error", description: "Could not verify phone number uniqueness. Please try again."});
      return true; 
    }
  };


 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable. Cannot update profile.";
      toast({ variant: "destructive", title: "Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    setLoading(true);

    try {
      if (updatedData.username && updatedData.username !== user.username) {
        if (await isUsernameTakenInFirestore(updatedData.username, user.id)) {
          const errorMsg = "Username already taken. Please choose another one.";
          throw new Error(errorMsg);
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        if (await isPhoneNumberTakenInFirestore(updatedData.phoneNumber, user.id)) {
            const errorMsg = "Phone number already in use. Please use a different one.";
            throw new Error(errorMsg);
        }
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: any = { 
        displayName: updatedData.displayName || user.displayName,
        username: updatedData.username !== undefined ? (updatedData.username || null) : user.username,
        role: updatedData.role || user.role,
        phoneNumber: updatedData.phoneNumber !== undefined ? (updatedData.phoneNumber || null) : user.phoneNumber,
        institution: updatedData.institution !== undefined ? (updatedData.institution || null) : user.institution,
        researcherId: updatedData.researcherId !== undefined ? (updatedData.researcherId || null) : user.researcherId,
        updatedAt: serverTimestamp() 
      };
      
      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }

      await updateDoc(userDocRef, updatePayloadFS);
      
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb);
        setIsAdminUser(updatedUserFromDb.isAdmin === true);

        if (typeof window !== 'undefined') {
          const completingProfileFlag = localStorage.getItem('completingProfile') === 'true';
          if (completingProfileFlag) {
            const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
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
        setLoading(false);
        return updatedUserFromDb;
      } else {
        const errorMsg = "Profile updated in Firestore, but failed to reload latest data into context.";
        throw new Error(errorMsg);
      }
    } catch(error: any) {
        toast({variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."})
        setLoading(false);
        throw error; 
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

