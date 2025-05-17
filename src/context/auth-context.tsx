
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
  getAdditionalUserInfo,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, collection, updateDoc, writeBatch } from 'firebase/firestore';
// CORRECTED IMPORT: Path and variable names
import { auth as firebaseAuth, db as firestoreDb } from '@/lib/firebase';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import type { User } from '@/types';
import { useToast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const MOCK_ADMIN_EMAIL = "admin@example.com"; // Kept for simple admin by email
const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com"; // For dynamic admin creation on signup

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

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to convert Firestore Timestamps in user data
const convertUserTimestamps = (userData: any): User => {
  const convert = (timestamp: any) => {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
    if (typeof timestamp === 'string') {
      if (!isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
    }
    if (timestamp instanceof Date) return timestamp.toISOString();
    if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
      return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000).toISOString();
    }
    return String(timestamp); // Fallback
  }

  return {
    ...userData,
    createdAt: convert(userData.createdAt),
    updatedAt: convert(userData.updatedAt),
  } as User;
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [justCompletedProfile, setJustCompletedProfile] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isProfileConsideredComplete = useCallback((profile: User | null): boolean => {
    if (!profile) return false;
    const complete = !!(profile.username && profile.username.trim() !== "" && profile.role && profile.phoneNumber && profile.phoneNumber.trim() !== "");
    return complete;
  }, []);

  const ensureFirestoreUserProfile = useCallback(async (
    firebaseUser: FirebaseUser,
    profileDataFromSignup?: Partial<SignupFormValues> & { isSocial?: boolean }
  ): Promise<User | null> => {
    if (!firestoreDb) {
      console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
      toast({ variant: "destructive", title: "Database Error", description: "User profile database is not accessible." });
      return null;
    }

    const userDocRef = doc(firestoreDb, "users", firebaseUser.uid);

    try {
      const userSnap = await getDoc(userDocRef);
      let dataToSave: Omit<User, 'id'> & { createdAt?: Timestamp | Date, updatedAt?: Timestamp | Date }; // Use Omit for fields not directly in Firestore doc structure initially

      if (userSnap.exists()) {
        // User document exists, merge and update
        const existingData = convertUserTimestamps(userSnap.data()) as User; // Convert timestamps from existing doc
        const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

        dataToSave = {
          userId: firebaseUser.uid,
          email: firebaseUser.email || existingData.email || null,
          displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
          photoURL: firebaseUser.photoURL || existingData.photoURL || null,
          username: profileDataFromSignup?.username || existingData.username || null,
          role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author"),
          phoneNumber: profileDataFromSignup?.phoneNumber || existingData.phoneNumber || null,
          institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
          researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
          isAdmin: isCreatorAdminByEmail || existingData.isAdmin === true, // Prioritize admin email, then existing flag
          isSuspended: existingData.isSuspended || false,
          createdAt: existingData.createdAt ? Timestamp.fromDate(new Date(existingData.createdAt)) : serverTimestamp() as Timestamp, // Preserve original if exists
          updatedAt: serverTimestamp() as Timestamp,
        };
      } else {
        // New user, document doesn't exist
        const isCreatorAdmin = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;
        dataToSave = {
          userId: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || null,
          photoURL: firebaseUser.photoURL || null,
          username: profileDataFromSignup?.username || null,
          role: isCreatorAdmin ? "Admin" : (profileDataFromSignup?.role || "Author"),
          phoneNumber: profileDataFromSignup?.phoneNumber || null,
          institution: profileDataFromSignup?.institution || null,
          researcherId: profileDataFromSignup?.researcherId || null,
          isAdmin: isCreatorAdmin,
          isSuspended: false,
          createdAt: serverTimestamp() as Timestamp,
          updatedAt: serverTimestamp() as Timestamp,
        };
      }

      await setDoc(userDocRef, dataToSave, { merge: true });
      const finalSnap = await getDoc(userDocRef); // Re-fetch to get server-generated timestamps correctly

      if (finalSnap.exists()) {
        const finalData = convertUserTimestamps({ id: finalSnap.id, ...finalSnap.data() }) as User;
        return finalData;
      }
      return null;

    } catch (error: any) {
      console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${firebaseUser.uid}:`, error.message, error.code, error);
      toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfileConsideredComplete, toast]); // Removed isProfileConsideredComplete as it's not used inside this callback directly, only its definition.


  useEffect(() => {
    if (!isMounted || !firebaseAuth) {
      if (!firebaseAuth && isMounted) {
          setLoading(false); // Firebase auth itself isn't available
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (fbUser: FirebaseUser | null) => {
      if (justCompletedProfile) {
        setJustCompletedProfile(false);
      }

      setLoading(true);

      if (fbUser) {
        const appUser = await ensureFirestoreUserProfile(fbUser);

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);

          if (justCompletedProfile) {
            setLoading(false);
            return;
          }

          const profileIsActuallyComplete = isProfileConsideredComplete(appUser);
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;
          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;


          if (!profileIsActuallyComplete) {
            if (pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
              if (typeof window !== 'undefined' && redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH) {
                 // Preserve intended redirect
              } else if (typeof window !== 'undefined') {
                 // If current redirect is to settings or nothing, set it based on current page or home
                 const currentNonAuthPath = (pathname === LOGIN_PATH || pathname === SIGNUP_PATH) ? HOME_PATH : pathname;
                 localStorage.setItem('redirectAfterLogin', currentNonAuthPath);
              }
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            }
          } else { // Profile is complete
            if (completingProfileStorageFlag && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
              if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
              const target = redirectAfterLoginPath && redirectAfterLoginPath !== AUTHOR_PROFILE_SETTINGS_PATH ? redirectAfterLoginPath : (appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              router.push(target);
            } else if (redirectAfterLoginPath) {
              // Correct old paths if necessary
              if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                redirectAfterLoginPath = AUTHOR_PROFILE_SETTINGS_PATH;
              }
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH && profileIsActuallyComplete) {
                // If profile is complete, don't go back to settings
                const target = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
                router.push(target);
              } else {
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
                router.push(redirectAfterLoginPath);
              }
            } else {
              // Default redirects if no specific path and not completing profile
              const onAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH;
              const onNonAdminEntryPoint = onAuthPage || pathname === HOME_PATH || pathname === AUTHOR_PROFILE_SETTINGS_PATH;

              if (appUser.isAdmin && onNonAdminEntryPoint && pathname !== ADMIN_DASHBOARD_PATH && !pathname.startsWith('/admin/')) {
                router.push(ADMIN_DASHBOARD_PATH);
              } else if (!appUser.isAdmin && onAuthPage) {
                router.push(appUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              }
            }
          }
        } else {
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // No Firebase user
        setUser(null);
        setIsAdminUser(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, router, pathname, ensureFirestoreUserProfile, isProfileConsideredComplete, justCompletedProfile, searchParamsFromHook]); // Added searchParamsFromHook for robustness


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Auth service not available.");
    setLoading(true);
    let emailToLogin = identifier.trim();

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
            throw new Error("Username found, but no associated email.");
          }
        } else {
          throw new Error("Invalid email/username or password.");
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful", description: "Welcome back!" });
    } catch (error: any) {
      const firebaseError = error as { code?: string; message?: string };
      const errorMessage = firebaseError.code === 'auth/invalid-credential' || firebaseError.code === 'auth/user-not-found' || firebaseError.code === 'auth/wrong-password'
        ? "Invalid email/username or password."
        : (firebaseError.message || "Login failed. Please try again.");
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
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
      const qUsername = query(usersRef, where("username", "==", data.username.trim()));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        throw new Error("Username already taken. Please choose another one.");
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
      await ensureFirestoreUserProfile(userCredential.user, data);
      toast({ title: "Account Created!", description: "Welcome! Please complete your profile if prompted." });

    } catch (error: any) {
      const firebaseError = error as { code?: string; message?: string };
      let errorMessage = firebaseError.message || "Signup failed. Please try again.";
      if (firebaseError.code === 'auth/email-already-in-use') {
        errorMessage = "This email is already registered. Please try logging in.";
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    const firebaseError = error as { code?: string; message?: string };
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = firebaseError.message || "An unexpected error occurred.";

    if (firebaseError.code === 'auth/popup-closed-by-user') {
      toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
    } else if (firebaseError.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method. Please sign in with the original method.`;
    } else if (firebaseError.code === 'auth/cancelled-popup-request') {
       toastMessage = `The sign-in popup request was cancelled. If you have multiple popups open, please close them and try again.`;
    }
    toast({
      title: toastTitle,
      description: toastMessage,
      variant: "destructive",
      duration: 10000,
    });
    setActiveSocialLoginProvider(null);
    setLoading(false);
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
      await signInWithPopup(firebaseAuth, providerInstance);
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) are handled by onAuthStateChanged or error handler
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
    if (!user || !user.uid || !firestoreDb || !firebaseAuth?.currentUser) {
      throw new Error("User not authenticated or database service unavailable.");
    }
    setLoading(true);

    try {
      const userDocRef = doc(firestoreDb, "users", user.uid);
      const currentProfileSnap = await getDoc(userDocRef);
      if (!currentProfileSnap.exists()) throw new Error("User profile not found in database.");
      const currentProfileData = currentProfileSnap.data() as User;

      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== currentProfileData.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", updatedData.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.uid)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== currentProfileData.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.uid)) {
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
      updatePayloadFS.updatedAt = serverTimestamp() as Timestamp;

      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && firebaseAuth.currentUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }

      const finalUpdatedUser: User = {
        ...user,
        ...updatePayloadFS, // Apply partial updates
        updatedAt: new Date().toISOString(), // Optimistic update for UI
      };
      setUser(finalUpdatedUser);
      setIsAdminUser(finalUpdatedUser.isAdmin === true);

      toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });

      const isProfileNowComplete = isProfileConsideredComplete(finalUpdatedUser);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

      if (isProfileNowComplete && completingProfileStorageFlag) {
        setJustCompletedProfile(true);
        if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
        let redirectPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
        if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');

        if (redirectPath === AUTHOR_PROFILE_SETTINGS_PATH) redirectPath = null;
        const target = redirectPath || (finalUpdatedUser.isAdmin ? ADMIN_DASHBOARD_PATH : (finalUpdatedUser.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
        router.push(target);
      }
      return true;

    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  if ((!firebaseAuth || !firestoreDb) && isMounted) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h1>Application Configuration Error</h1>
        <p>Firebase services are not available. Please ensure your Firebase environment variables (NEXT_PUBLIC_FIREBASE_...) are correctly set up in your <code>.env.local</code> file and your Vercel project settings (if deployed).</p>
        <p>Check the browser console and server logs for more specific error messages from Firebase SDK initialization.</p>
      </div>
    );
  }
   if (!isMounted || (loading && !user && !firebaseAuth?.currentUser) ) {
        return (
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
              <LoadingSpinner size={48} />
              <p className="ml-3">Initializing Application...</p>
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

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

    