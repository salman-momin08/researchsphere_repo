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

export const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com"; // For easier admin testing

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

const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues>
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

    const isCreatorAdmin = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // Prioritize existing Firestore data for core profile fields, update with Auth data if newer/changed
      dataToSave = {
        userId: uid,
        email: firebaseUser.email || existingData.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username !== undefined ? existingData.username : null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdmin ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber !== undefined ? existingData.phoneNumber : null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution !== undefined ? existingData.institution : null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId !== undefined ? existingData.researcherId : null),
        isAdmin: isCreatorAdmin || existingData.isAdmin === true, // Prioritize creator email for admin status
        isSuspended: existingData.isSuspended || false,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    } else {
      // New user document
      dataToSave = {
        userId: uid,
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }
    await setDoc(userDocRef, dataToSave, { merge: true });

    const finalSnap = await getDoc(userDocRef); // Re-fetch to get server timestamps
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
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}"`, error.code, error);
    return null;
  }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [justCompletedProfile, setJustCompletedProfile] = useState(false); // Semaphore for profile completion redirect

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Call hook at top level
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) {
      setLoading(false); // Ensure loading is false if Firebase isn't ready
      return;
    }

    if (justCompletedProfile) {
      setJustCompletedProfile(false);
      return; // Let the redirect from updateUserProfile take precedence
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true);
      let appUser: User | null = null;
      let redirectAfterLoginPath: string | null = null;
      let completingProfileStorageFlag: string | null = null;

      if (typeof window !== 'undefined') {
        redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
        completingProfileStorageFlag = localStorage.getItem('completingProfile');
      }

      if (firebaseUser) {
        appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);

          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && pathname === AUTHOR_PROFILE_SETTINGS_PATH) {
            // Profile just got completed by a save, or user landed here after completion
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectAfterLoginPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null; // Avoid redirecting back to settings
              }
            }
            const target = redirectAfterLoginPath || (appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
            router.push(target);
          } else if (redirectAfterLoginPath) {
            let correctedRedirectPath = redirectAfterLoginPath;
            if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                correctedRedirectPath = AUTHOR_PROFILE_SETTINGS_PATH;
            }
             if (correctedRedirectPath === AUTHOR_PROFILE_SETTINGS_PATH && isProfileComplete) {
                // If profile is complete and we were headed to settings, clear flags and go to dashboard
                if (typeof window !== 'undefined') {
                    localStorage.removeItem('redirectAfterLogin');
                    localStorage.removeItem('completingProfile');
                }
                router.push(appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH));
            } else {
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
                router.push(correctedRedirectPath);
            }
          } else {
            const onAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH;
            const onNonAdminEntryPoint = onAuthPage || pathname === HOME_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH);

            if (appUser.isAdmin && onNonAdminEntryPoint && pathname !== ADMIN_DASHBOARD_PATH && !pathname.startsWith('/admin/')) {
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!appUser.isAdmin && onAuthPage && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH)) {
              const userDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              router.push(userDashboard);
            }
          }
        } else {
          // Failed to ensure Firestore profile, implies a critical error
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else {
        setUser(null);
        setIsAdminUser(false);
        const isAuthorArea = pathname.startsWith('/author/');
        const isAdminArea = pathname.startsWith('/admin/');
        const isReviewerArea = pathname.startsWith('/reviewer/');
        const isProtectedGenericPath = isAuthorArea || isAdminArea || isReviewerArea;
        const isAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH || pathname === '/forgot-password';

        if (isProtectedGenericPath && !isAuthPage && typeof window !== 'undefined') {
          if (isMounted && !showLoginModal) { // Only show modal if component is mounted
            localStorage.setItem("redirectAfterLogin", pathname);
            setShowLoginModal(true);
          }
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, pathname, router, searchParamsFromHook, toast, showLoginModal, justCompletedProfile]); // Added user, searchParams, showLoginModal, justCompletedProfile

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
      // onAuthStateChanged will handle profile fetching and redirection
      setShowLoginModal(false); // Close modal on successful Firebase auth
    } catch (error: any) {
      firebaseError = error;
      const errorMessage = error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'
        ? "Invalid email/username or password."
        : (error.message || "Login failed. Please try again.");
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage); // Re-throw for form to catch
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Auth service not available.");
    setLoading(true);
    try {
      // Check username uniqueness
      const usersRef = collection(firestoreDb, "users");
      if (data.username && data.username.trim() !== "") {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Check phone number uniqueness
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
      // ensureFirestoreUserProfile will be called by onAuthStateChanged listener
      // Pass signup data to ensureFirestoreUserProfile for initial profile creation
      await ensureFirestoreUserProfile(userCredential.user, data);
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
      toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method. Please sign in with the original method.`;
    } else if (error.code === 'auth/unauthorized-domain') {
      toastMessage = `This application's domain is not authorized for ${providerName} sign-in. Please check Firebase console settings.`;
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
      setLoading(false);
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    const providerInstance = providerName === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle setting user, profile creation and redirecting
      setShowLoginModal(false);
    } catch (error: any) {
      handleSocialLoginError(error, providerName);
    } finally {
      // setLoading(false) and setActiveSocialLoginProvider(null) will be handled by onAuthStateChanged or error handler
      // to avoid race conditions if onAuthStateChanged fires quickly.
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      setUser(null);
      setIsAdminUser(false); // Reset admin state on logout
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
      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
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
      
      const finalUpdatedUser: User = {
        ...user,
        ...updatePayloadFS,
        email: user.email, // email cannot be changed here
        photoURL: currentFirebaseUser.photoURL || user.photoURL, // ensure photoURL is current
        updatedAt: new Date().toISOString(), // Optimistic update for local state
      };
      setUser(finalUpdatedUser);
      setIsAdminUser(finalUpdatedUser.isAdmin === true);

      const isProfileNowComplete = !!(finalUpdatedUser.username && finalUpdatedUser.role && finalUpdatedUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : 'false';

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        setJustCompletedProfile(true); // Signal to onAuthStateChanged to stand down for one cycle
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
          const storedRedirectPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');
          const target = storedRedirectPath && storedRedirectPath !== AUTHOR_PROFILE_SETTINGS_PATH && !storedRedirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')
            ? storedRedirectPath
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
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
        <LoadingSpinner size={48} />
        <p className="ml-3">Initializing Application...</p>
      </div>
    );
  }

  if ((!firebaseAuth || !firestoreDb) && isMounted) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h1 className="text-2xl font-bold text-destructive mb-2">Application Configuration Error</h1>
        <p className="text-muted-foreground mb-1">Firebase services (Authentication or Firestore) are not available.</p>
        <p className="text-sm text-muted-foreground">
          Please ensure your Firebase environment variables (<code>NEXT_PUBLIC_FIREBASE_...</code>)
          are correctly set up in your <code>.env.local</code> file (for local development)
          AND in your Vercel project settings (for deployment). Restart your development server after changes.
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
