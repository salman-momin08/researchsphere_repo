
"use client";

import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  updateProfile as firebaseUpdateProfile,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, collection, updateDoc } from 'firebase/firestore';
import { auth as firebaseAuth, db as firestoreDb } from '@/lib/firebase';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import type { User } from '@/types';
import { useToast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

export const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings'; // Correct and consistent path
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (emailForReset: string) => Promise<void>;
  updateUserProfile: (data: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => Promise<boolean>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const convertFirestoreTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') {
    if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
  }
  return String(timestamp);
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [justCompletedProfile, setJustCompletedProfile] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const ensureFirestoreUserProfile = useCallback(async (
    firebaseUser: FirebaseUser,
    profileDataFromSignup?: Partial<SignupFormValues> & { isSocial?: boolean }
  ): Promise<User | null> => {
    if (!firestoreDb) {
      console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
      return null;
    }

    const uid = firebaseUser.uid;
    const userDocRef = doc(firestoreDb, "users", uid);

    try {
      const userSnap = await getDoc(userDocRef);
      let dataToSave: Partial<User>;
      let finalUserData: User;

      const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

      if (userSnap.exists()) {
        const existingData = userSnap.data() as User;
        dataToSave = {
          userId: uid,
          email: firebaseUser.email || existingData.email || null,
          displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
          photoURL: firebaseUser.photoURL || existingData.photoURL || null,
          username: existingData.username !== undefined ? existingData.username : (profileDataFromSignup?.username || null),
          role: existingData.role !== undefined ? existingData.role : (isAdminByEmail ? "Admin" : (profileDataFromSignup?.role || "Author")),
          phoneNumber: existingData.phoneNumber !== undefined ? existingData.phoneNumber : (profileDataFromSignup?.phoneNumber || null),
          institution: existingData.institution !== undefined ? existingData.institution : (profileDataFromSignup?.institution || null),
          researcherId: existingData.researcherId !== undefined ? existingData.researcherId : (profileDataFromSignup?.researcherId || null),
          isAdmin: isAdminByEmail || existingData.isAdmin === true,
          isSuspended: existingData.isSuspended || false,
          createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(userDocRef, dataToSave, { merge: true });
      } else {
        dataToSave = {
          userId: uid,
          email: firebaseUser.email,
          displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || null,
          photoURL: firebaseUser.photoURL || null,
          username: profileDataFromSignup?.username || null,
          role: isAdminByEmail ? "Admin" : (profileDataFromSignup?.role || "Author"),
          phoneNumber: profileDataFromSignup?.phoneNumber || null,
          institution: profileDataFromSignup?.institution || null,
          researcherId: profileDataFromSignup?.researcherId || null,
          isAdmin: isAdminByEmail,
          isSuspended: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(userDocRef, dataToSave);
      }

      const finalSnap = await getDoc(userDocRef);
      if (finalSnap.exists()) {
        const rawData = { id: finalSnap.id, ...finalSnap.data() };
        finalUserData = {
          ...rawData,
          createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
          updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
        } as User;
        return finalUserData;
      } else {
        throw new Error("User document not found after create/update operation.");
      }
    } catch (error: any) {
      console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}:`, error.message, error.code, error);
      toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Firestore Error: ${error.message}`, duration: 10000 });
      return null;
    }
  }, [toast]);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) return;
    if (justCompletedProfile) {
        setJustCompletedProfile(false);
        return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      let appUser: User | null = null;

      if (firebaseUser) {
        appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

          if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
            redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH; // Correct old paths
          }
          
          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag && (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              localStorage.removeItem('redirectAfterLogin'); // Clear it as its purpose (to profile settings) is done
            }
            const target = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            router.push(target);
          } else if (redirectAfterLoginPath) {
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            router.push(redirectAfterLoginPath);
          } else {
            const onAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH;
            const onProfileCompletionPage = pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');
            const onNonAdminEntryPoint = onAuthPage || pathname === HOME_PATH || onProfileCompletionPage;

            if (appUser.isAdmin && onNonAdminEntryPoint && pathname !== ADMIN_DASHBOARD_PATH) {
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!appUser.isAdmin && onAuthPage && !onProfileCompletionPage) {
              const userDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(userDashboard);
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
        const isProtectedPath = pathname.startsWith('/author/') || pathname.startsWith('/reviewer/') || pathname.startsWith('/admin/');
        const isAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH || pathname === '/forgot-password';
        if (isProtectedPath && !isAuthPage && typeof window !== 'undefined') {
          localStorage.setItem('redirectAfterLogin', pathname);
          if (isMounted && !showLoginModal) setShowLoginModal(true);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook, ensureFirestoreUserProfile, toast, showLoginModal, justCompletedProfile]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Auth service not available.");
    setLoading(true);
    let emailToLogin = identifier.trim();
    let firebaseError = null;

    try {
      if (!identifier.includes('@')) {
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) {
            emailToLogin = userData.email;
          } else {
            throw new Error("Invalid email/username or password.");
          }
        } else {
          throw new Error("Invalid email/username or password.");
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false);
      // onAuthStateChanged will handle profile fetching and redirection
    } catch (error: any) {
      firebaseError = error;
      const errorMessage = error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'
        ? "Invalid email/username or password."
        : (error.message || "Login failed. Please try again.");
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Auth service not available.");
    setLoading(true);
    try {
      const usersRef = collection(firestoreDb, "users");
      if (data.username && data.username.trim() !== "") {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (data.phoneNumber && data.phoneNumber.trim() !== "") {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user && data.fullName) {
        await firebaseUpdateProfile(userCredential.user, { displayName: data.fullName });
      }
      await ensureFirestoreUserProfile(userCredential.user, data); // This will create the Firestore doc
      // onAuthStateChanged will handle redirection based on profile completeness
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed. Please try again.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "This email is already registered. Please try logging in.";
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setLoading(false);
    setActiveSocialLoginProvider(null);
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again. If the issue persists, another browser extension might be interfering.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method. Please sign in with the original method.`;
    } else if (error.code === 'auth/unauthorized-domain') {
      toastMessage = `This application's domain is not authorized for ${providerName} sign-in. Please contact support.`;
    } else if (error.message?.includes("Auth system not configured")) {
        toastTitle = "CRITICAL SERVER ERROR";
        toastMessage = `Could not authenticate with ${providerName}. The server's authentication system is not configured. Please contact support. (Admin: Check Firebase Admin SDK setup in server logs.)`;
    }
    
    toast({
      title: toastTitle,
      description: toastMessage,
      variant: "destructive",
      duration: 10000,
    });
  };

  const processSocialLogin = async (providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Error", description: "Authentication service is not available." });
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    const providerInstance = providerName === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
    try {
      const result = await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting
      // No need to call ensureFirestoreUserProfile here explicitly, onAuthStateChanged will do it
      setShowLoginModal(false);
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) will be handled by onAuthStateChanged or error handler.
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

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
      router.push(LOGIN_PATH);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (emailForReset: string) => {
    if (!firebaseAuth) throw new Error("Auth service not available.");
    setLoading(true);
    try {
      await firebaseSendPasswordResetEmail(firebaseAuth, emailForReset);
      toast({ title: "Password Reset Email Sent", description: "If an account exists for this email, a reset link has been sent." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error Sending Reset Email", description: error.message || "Could not send password reset email." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      throw new Error("User not authenticated or database service unavailable.");
    }
    setLoading(true);
    const currentFirebaseUser = firebaseAuth.currentUser;

    try {
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", updatedData.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const updatePayloadFS: Partial<User> = {};
      if (updatedData.displayName !== undefined) updatePayloadFS.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || "Author";
      updatePayloadFS.updatedAt = serverTimestamp();

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfile(currentFirebaseUser, { displayName: updatedData.displayName });
      }
      
      // Optimistically update local state and determine if profile is now complete
      const finalUpdatedUser: User = {
        ...user,
        ...updatePayloadFS, // Apply changes
        updatedAt: new Date().toISOString(), // Simulate server timestamp locally
      };
      setUser(finalUpdatedUser);
      setIsAdminUser(finalUpdatedUser.isAdmin === true); // Re-evaluate admin status if role could change it, though not typical here

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

      if (isProfileNowComplete && completingProfileStorageFlag) {
        setJustCompletedProfile(true);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');
          const target = redirectPath && redirectPath !== AUTHOR_PROFILE_SETTINGS_PATH
            ? redirectPath
            : (finalUpdatedUser.isAdmin ? ADMIN_DASHBOARD_PATH : (finalUpdatedUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
          router.push(target);
        }
      }
      toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });
      return true;
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  if (!isMounted || (loading && !user && (!firebaseAuth || !firebaseAuth.currentUser))) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem' }}>
        <LoadingSpinner size={48} />
        <p className="ml-3">Initializing Application...</p>
      </div>
    );
  }

  if ((!firebaseAuth || !firestoreDb) && isMounted) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h1 className="text-2xl font-bold text-destructive mb-2">Application Configuration Error</h1>
        <p className="text-muted-foreground mb-1">Firebase services are not available.</p>
        <p className="text-sm text-muted-foreground">
          Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>)
          are correctly set up in your <code>.env.local</code> file (for local development)
          AND in your Vercel project settings (for deployment). Restart your development server after changes.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Check the browser console and server logs for more specific error messages from Firebase SDK initialization.
        </p>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: isAdminUser,
        login,
        signup,
        logout,
        loginWithGoogle,
        loginWithGitHub,
        sendPasswordResetEmail,
        updateUserProfile,
        showLoginModal,
        setShowLoginModal,
        isSocialLoginInProgress: !!activeSocialLoginProvider,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
