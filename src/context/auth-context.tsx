
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
  updateProfile as firebaseUpdateProfileAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, updateDoc, collection } from 'firebase/firestore';
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

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isProfileComplete: boolean;
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
  if (typeof timestamp === 'string' && !isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
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
    const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        userId: uid, // Ensure this is always set
        email: firebaseUser.email || existingData.email,
        displayName: profileDataFromSignup?.fullName ?? firebaseUser.displayName ?? existingData.displayName ?? null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // Prioritize existing Firestore data for these core profile fields during a normal login
        username: profileDataFromSignup?.username !== undefined ? profileDataFromSignup.username : (existingData.username || null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? profileDataFromSignup.phoneNumber : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? profileDataFromSignup.institution : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? profileDataFromSignup.researcherId : (existingData.researcherId || null),
        isAdmin: isCreatorAdminByEmail || existingData.isAdmin === true, // Ensure admin status is preserved or set for creator
        isSuspended: existingData.isSuspended === true,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    } else { // New user document
      dataToSave = {
        id: uid,
        userId: uid,
        email: firebaseUser.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        username: profileDataFromSignup?.username || null,
        role: isCreatorAdminByEmail ? "Admin" : (profileDataFromSignup?.role || "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber || null,
        institution: profileDataFromSignup?.institution || null,
        researcherId: profileDataFromSignup?.researcherId || null,
        isAdmin: isCreatorAdminByEmail,
        isSuspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }

    await setDoc(userDocRef, dataToSave, { merge: true });
    const finalSnap = await getDoc(userDocRef); // Re-fetch for server timestamps
    if (finalSnap.exists()) {
      const rawData = { id: finalSnap.id, ...finalSnap.data() } as any;
      return {
        ...rawData,
        createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
        updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
      } as User;
    }
    throw new Error(`User document ${uid} not found after create/update.`);
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}:`, error.message, error.code, error);
    toast({ variant: "destructive", title: "Profile Sync Error", description: `Could not save or update your profile in our database. Please try again or contact support. Details: ${error.message}`, duration: 10000 });
    return null;
  }
};


export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);

  const router = useRouter();
  const currentUsePathname = usePathname(); // From Next.js, for dependency array if needed cautiously
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth) {
      if (isMounted && !firebaseAuth) setLoading(false); // Firebase not available, stop loading
      return;
    }

    // Set loading true at the start of any auth state evaluation cycle
    // This will be set to false at the very end of the onAuthStateChanged callback
    setLoading(true);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      const currentWindowPathname = window.location.pathname; // Get freshest pathname
      let appUserFromDb: User | null = null;

      if (firebaseUser) {
        appUserFromDb = await ensureFirestoreUserProfile(firebaseUser);

        if (appUserFromDb) {
          setUser(appUserFromDb);
          const adminStatus = appUserFromDb.isAdmin === true;
          setIsAdminUser(adminStatus);
          const profileStatus = !!(appUserFromDb.username && appUserFromDb.role && appUserFromDb.phoneNumber);
          setIsProfileComplete(profileStatus);

          // --- Redirection Logic ---
          const redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          const completingProfileStorageFlag = localStorage.getItem('completingProfile') === 'true';

          if (!profileStatus) { // Profile is NOT complete
            if (currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              localStorage.setItem('completingProfile', 'true');
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
              setLoading(false);
              return;
            }
          } else { // Profile IS complete
            if (completingProfileStorageFlag && (currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
              // Was on profile settings page for completion, now complete. Redirect away.
              localStorage.removeItem('completingProfile');
              let targetPath = redirectAfterLoginPath;
              localStorage.removeItem('redirectAfterLogin');
              if (targetPath === AUTHOR_PROFILE_SETTINGS_PATH || targetPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                targetPath = null; // Don't redirect back to profile settings
              }
              router.push(targetPath || (adminStatus ? ADMIN_DASHBOARD_PATH : (appUserFromDb.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH)));
              setLoading(false);
              return;
            } else if (redirectAfterLoginPath) {
              localStorage.removeItem('redirectAfterLogin');
              let correctedRedirect = redirectAfterLoginPath;
              // Correct old /user/ paths if found in redirect path and profile is still somehow incomplete
              if ((correctedRedirect.startsWith('/user/profile/settings') || correctedRedirect.startsWith('/profile/settings')) && !profileStatus) {
                   correctedRedirect = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
              } else if (correctedRedirect.startsWith('/user/profile/settings') || correctedRedirect.startsWith('/profile/settings')) {
                   correctedRedirect = adminStatus ? ADMIN_DASHBOARD_PATH : (appUserFromDb.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              }
              router.push(correctedRedirect);
              setLoading(false);
              return;
            } else if (adminStatus && (currentWindowPathname === HOME_PATH || currentWindowPathname === LOGIN_PATH || currentWindowPathname === SIGNUP_PATH || currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH) && currentWindowPathname !== ADMIN_DASHBOARD_PATH) {
              router.push(ADMIN_DASHBOARD_PATH);
              setLoading(false);
              return;
            } else if (!adminStatus && (currentWindowPathname === LOGIN_PATH || currentWindowPathname === SIGNUP_PATH)) {
              router.push(appUserFromDb.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              setLoading(false);
              return;
            }
          }
        } else { // ensureFirestoreUserProfile failed
          if (firebaseAuth.currentUser) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
          setIsProfileComplete(false);
        }
      } else { // No firebaseUser
        setUser(null);
        setIsAdminUser(false);
        setIsProfileComplete(false);
        localStorage.removeItem('completingProfile');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, router]); // Minimal dependencies for the main auth listener

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();
    try {
      if (!identifier.includes('@')) {
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) emailToLogin = userData.email;
          else throw new Error("User record incomplete, email missing for username.");
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful", description: "Welcome back!" });
      setShowLoginModal(false);
      // onAuthStateChanged will handle further state updates and redirection
    } catch (error: any) {
      let errorMessage = error.code === 'auth/invalid-credential' || error.message.includes("User record incomplete") ? "Invalid email/username or password." : (error.message || "Login failed.");
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      setLoading(false); // Reset loading on error
      throw new Error(errorMessage);
    }
    // setLoading(false) will be handled by onAuthStateChanged after successful login
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available."});
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      const usersRef = collection(firestoreDb, "users");
      if (data.username) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) throw new Error("Username already taken. Please choose another one.");
      }
      if (data.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) throw new Error("Phone number already in use. Please use a different one.");
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        // Pass signup data to create initial Firestore profile correctly
        await ensureFirestoreUserProfile(userCredential.user, data);
        if (data.displayName) {
          await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.displayName });
        }
      }
      toast({ title: "Signup Successful!", description: "Your account has been created."});
      setShowLoginModal(false);
      // onAuthStateChanged handles redirection.
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') errorMessage = "Email already registered.";
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      setLoading(false); // Reset loading on error
      throw error;
    }
     // setLoading(false) will be handled by onAuthStateChanged after successful signup
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method.`;
    }
    toast({ title: toastTitle, description: toastMessage, variant: "destructive", duration: 10000 });
  };

  const processSocialLogin = async (providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Error", description: "Authentication service not available." });
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    const providerInstance = providerName === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      setShowLoginModal(false);
      // onAuthStateChanged handles Firestore sync and redirection.
    } catch (error) {
      handleSocialLoginError(error, providerName);
      setLoading(false); // Reset loading on error
    } finally {
      setActiveSocialLoginProvider(null);
    }
    // setLoading(false) will be handled by onAuthStateChanged after successful login
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // User state (user, isAdminUser, isProfileComplete) is cleared by onAuthStateChanged
      if (typeof window !== "undefined") {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push(LOGIN_PATH); // Explicit redirect to login after logout
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
    } catch (error: any) {
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (data: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      throw new Error("User not authenticated for profile update.");
    }
    setLoading(true);
    const currentFirebaseUser = firebaseAuth.currentUser;
    try {
      const usersRef = collection(firestoreDb, "users");
      if (data.username && data.username.trim() !== "" && data.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (data.phoneNumber && data.phoneNumber.trim() !== "" && data.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const updatePayloadFS: any = { updatedAt: serverTimestamp() };
      if (data.displayName !== undefined) updatePayloadFS.displayName = data.displayName?.trim() || null;
      if (data.username !== undefined) updatePayloadFS.username = data.username?.trim() || null;
      if (data.phoneNumber !== undefined) updatePayloadFS.phoneNumber = data.phoneNumber?.trim() || null;
      if (data.institution !== undefined) updatePayloadFS.institution = data.institution?.trim() || null;
      if (data.researcherId !== undefined) updatePayloadFS.researcherId = data.researcherId?.trim() || null;
      if (data.role !== undefined) updatePayloadFS.role = data.role || "Author";

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (data.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== data.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: data.displayName });
      }

      // Immediately update local state after successful DB update
      const updatedUserFromDb = await ensureFirestoreUserProfile(currentFirebaseUser, data as SignupFormValues);
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb);
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        const profileIsNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        setIsProfileComplete(profileIsNowComplete);

        toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });

        if (profileIsNowComplete && localStorage.getItem('completingProfile') === 'true') {
          localStorage.removeItem('completingProfile');
          let targetPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');
          if (targetPath === AUTHOR_PROFILE_SETTINGS_PATH || targetPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            targetPath = null;
          }
          router.push(targetPath || (updatedUserFromDb.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedUserFromDb.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH)));
        }
        return true;
      } else {
        // This case should ideally not be hit if ensureFirestoreUserProfile is robust
        toast({variant: "destructive", title: "Profile Update Incomplete", description: "Profile updated, but couldn't refresh local data. Please reload."});
        return false;
      }
    } catch (error: any) {
      console.error("AuthContext (updateUserProfile): Error updating profile:", error.message, error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  if (!isMounted) { // Show loading screen until client has mounted
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}>
        <LoadingSpinner size={48} />
        <p className="ml-3">Initializing Application...</p>
      </div>
    );
  }

  if ((!firebaseAuth || !firestoreDb) && isMounted) { // Critical Firebase services not available
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h1 className="text-2xl font-bold text-destructive mb-2">Application Configuration Error</h1>
        <p className="text-muted-foreground mb-1">Firebase services (Authentication or Firestore) are not available.</p>
        <p className="text-sm text-muted-foreground">Please check client-side Firebase environment variables (NEXT_PUBLIC_FIREBASE_...) and ensure they are correctly set. Restart the application after verifying.</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: isAdminUser,
        isProfileComplete,
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
