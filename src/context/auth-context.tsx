
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
const MOCK_ADMIN_EMAIL = "admin@example.com"; // For easy admin login during mock phase

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
    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any };
    const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

      dataToSave = {
        userId: uid, // Ensure this is always present
        email: firebaseUser.email || existingData.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // Prioritize existing Firestore data for these fields during login, unless explicitly completing profile
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username !== undefined ? existingData.username : null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber !== undefined ? existingData.phoneNumber : null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution !== undefined ? existingData.institution : null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId !== undefined ? existingData.researcherId : null),
        isAdmin: isCreatorAdminByEmail || existingData.isAdmin === true, // Prioritize creator email
        isSuspended: existingData.isSuspended || false,
        updatedAt: serverTimestamp(),
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : serverTimestamp(), // Preserve original createdAt
      };
      console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToSave);
    } else {
      console.log(`AuthContext (ensureFirestoreUserProfile): No existing Firestore profile for ${uid}. Creating new one.`);
      dataToSave = {
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
      console.log(`AuthContext (ensureFirestoreUserProfile): Data to create for new user ${uid}:`, dataToSave);
    }

    await setDoc(userDocRef, dataToSave, { merge: true });
    const finalSnap = await getDoc(userDocRef);

    if (finalSnap.exists()) {
      const rawData = { id: finalSnap.id, ...finalSnap.data() };
      const hydratedUser = {
        ...rawData,
        createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
        updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
      } as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated ${userSnap.exists() ? 'existing' : 'new'} user ${uid} with data:`, hydratedUser);
      return hydratedUser;
    } else {
      throw new Error("User document not found after create/update operation.");
    }
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}" "${error.code}"`, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 10000 });
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
  const [justCompletedProfile, setJustCompletedProfile] = useState(false); // Semaphore

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams();
  const { toast } = useToast();


  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    console.log("AuthContext: Top of main useEffect. Pathname:", pathname, "IsMounted:", isMounted);
    if (!isMounted || !firebaseAuth) {
      // If not mounted or Firebase auth isn't ready, wait.
      // setLoading(true) might be appropriate if not already true
      return;
    }

    if (justCompletedProfile) {
      console.log("AuthContext: justCompletedProfile is true, returning early from main useEffect.");
      setJustCompletedProfile(false); // Reset semaphore
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser:", firebaseUser?.uid || "null");
      setLoading(true); // Start loading when auth state changes

      let redirectAfterLoginPath: string | null = null;
      let completingProfileStorageFlag: string | null = null;

      if (typeof window !== 'undefined') {
        redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
        completingProfileStorageFlag = localStorage.getItem('completingProfile');
      }

      if (firebaseUser) {
        const appUser = await ensureFirestoreUserProfile(firebaseUser);

        if (appUser) {
          setUser(appUser);
          setIsAdminUser(appUser.isAdmin === true);
          console.log("AuthContext (onAuthStateChanged for", appUser.email, "): Pathname:", pathname, ", IsAdmin:", appUser.isAdmin, ", RedirectPath:", redirectAfterLoginPath, ", CompletingFlag:", completingProfileStorageFlag);
          console.log("AuthContext (onAuthStateChanged for", appUser.email, "): appUser details - username:", `'${appUser.username}'`, ", role:", `'${appUser.role}'`, ", phone:", `'${appUser.phoneNumber}'`);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          console.log("AuthContext (onAuthStateChanged for", appUser.email, "): ProfileComplete:", isProfileComplete);


          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            console.log("AuthContext: Profile incomplete for", appUser.email, ". Redirecting to", `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
            console.log("AuthContext: Profile complete, user on settings page due to completing flag. Redirecting away for", appUser.email);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectAfterLoginPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null;
              }
            }
            const targetDashboard = appUser.isAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            const finalRedirect = redirectAfterLoginPath || targetDashboard;
            console.log("AuthContext: Redirecting to:", finalRedirect);
            router.push(finalRedirect);
          } else if (redirectAfterLoginPath) {
            let correctedRedirectPath = redirectAfterLoginPath;
            if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                correctedRedirectPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
            }
            console.log("AuthContext: Handling redirectAfterLoginPath:", correctedRedirectPath, "for", appUser.email);
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            router.push(correctedRedirectPath);
          } else {
            const onAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH;
            const onNonAdminEntryPoint = onAuthPage || pathname === HOME_PATH || pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH+'?');

            if (appUser.isAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
              console.log("AuthContext: Admin on non-admin entry point. Redirecting to ADMIN_DASHBOARD_PATH for", appUser.email);
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!appUser.isAdmin && onAuthPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH+'?')) {
              const userDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              console.log("AuthContext: User on auth page. Redirecting to", userDashboard, "for", appUser.email);
              router.push(userDashboard);
            } else {
              console.log("AuthContext: No specific redirect needed for", appUser.email, "on path", pathname);
            }
          }
        } else {
          console.error("AuthContext (onAuthStateChanged): Failed to fetch or create Firestore profile for Firebase user", firebaseUser.uid, ". Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // firebaseUser is null (not logged in)
        console.log("AuthContext (onAuthStateChanged): No Firebase user. Clearing local state.");
        setUser(null);
        setIsAdminUser(false);
        // Redirect logic for non-authenticated users is primarily handled by ProtectedRoute
      }
      console.log("AuthContext (onAuthStateChanged): Setting loading to false.");
      setLoading(false);
    });
    return () => {
      console.log("AuthContext: Unsubscribing from onAuthStateChanged.");
      unsubscribe();
    };
  }, [pathname, router, isMounted, searchParamsFromHook, justCompletedProfile, user]); // Added `user` to re-evaluate if user state changes from `updateUserProfile`


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available. Please try again later."});
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();
    let firebaseError = null;

    try {
      if (!identifier.includes('@')) {
        console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) {
            emailToLogin = userData.email;
            console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            throw new Error("Username found but email is missing in profile."); // Should not happen
          }
        } else {
          console.log(`AuthContext (login): No email found for username '${identifier}'. Proceeding with identifier as email.`);
          // Let Firebase handle it if the username was actually an email without "@"
        }
      }
      console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false);
      // onAuthStateChanged will handle profile fetching and redirection
      toast({ title: "Login Successful", description: "Welcome back!" });
    } catch (error: any) {
      firebaseError = error;
      const errorMessage = error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'
        ? "Invalid email/username or password."
        : (error.message || "Login failed. Please try again.");
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage); // Re-throw for form to catch
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available. Please try again later."});
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      // Check for username uniqueness
      const usersRef = collection(firestoreDb, "users");
      const qUsername = query(usersRef, where("username", "==", data.username.trim()));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        throw new Error("Username already taken. Please choose another one.");
      }

      // Check for phone number uniqueness
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
      // `ensureFirestoreUserProfile` will be called by `onAuthStateChanged` using `profileDataFromSignup`
      // Pass the signup data to ensure it's used for the initial Firestore document creation
      await ensureFirestoreUserProfile(userCredential.user, data); // This will set the role, username etc.
      setShowLoginModal(false);
      toast({ title: "Signup Successful!", description: "Your account has been created."});
      // Redirection will be handled by onAuthStateChanged based on profile completeness
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed. Please try again.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "This email is already registered. Please try logging in.";
      }
      console.error("AuthContext (signup): Firebase signup error:", errorMessage, error);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage); // Re-throw for form to catch
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
      toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again. If issues persist, check browser settings or extensions.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method. Please sign in with the original method.`;
    } else if (error.code === 'auth/unauthorized-domain') {
      toastMessage = `This application's domain is not authorized for ${providerName} sign-in. Please check Firebase console settings.`;
    } else if (error.code === 'auth/network-request-failed') {
      toastMessage = `A network error occurred while trying to sign in with ${providerName}. Please check your internet connection.`;
    } else if (error.code === 'auth/operation-not-allowed') {
       toastMessage = `${providerName} sign-in is not enabled for this project. Please check Firebase Authentication settings.`;
    }

    toast({
      title: toastTitle,
      description: toastMessage,
      variant: "destructive",
      duration: 10000,
    });
    // console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, error.code, error.message, error);
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
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) will be handled by onAuthStateChanged's setLoading(false) or the error handler
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will set user to null
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      // No direct router.push here, onAuthStateChanged handles it by seeing no user
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
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
      toast({title: "Request Submitted", description: "If your email is registered, you'll receive a reset link."});
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Could not process your request."});
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      toast({variant: "destructive", title: "Authentication Error", description: "User not authenticated or database service unavailable."});
      throw new Error("User not authenticated or database service unavailable.");
    }
    setLoading(true);
    const currentFirebaseUser = firebaseAuth.currentUser;
    try {
      const usersRef = collection(firestoreDb, "users");
      // Uniqueness checks
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

      const updatePayloadFS: Partial<User> & {updatedAt: any} = { updatedAt: serverTimestamp() };
      if (updatedData.displayName !== undefined) updatePayloadFS.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || "Author";
      // isAdmin is not updated here by users.

      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfile(currentFirebaseUser, { displayName: updatedData.displayName });
      }

      // Optimistically update local user state
      const updatedLocalUser = { ...user, ...updatePayloadFS, updatedAt: new Date().toISOString() } as User;
      setUser(updatedLocalUser); // This is the optimistic update
      setIsAdminUser(updatedLocalUser.isAdmin === true); // Re-evaluate admin status based on potentially updated local user

      toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });

      const isProfileNowComplete = !!(updatedLocalUser.username && updatedLocalUser.role && updatedLocalUser.phoneNumber);
      const completingProfileFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

      if (isProfileNowComplete && completingProfileFlag === 'true') {
        console.log("AuthContext (updateUserProfile): Profile now complete AND completingProfile flag was true. Redirecting.");
        setJustCompletedProfile(true); // Signal to onAuthStateChanged to stand down its redirect
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
          let redirectPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');

          if (redirectPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            redirectPath = null; // Don't redirect back to settings
          }
          const targetDashboard = updatedLocalUser.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedLocalUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
          const finalRedirect = redirectPath || targetDashboard;
          console.log("AuthContext (updateUserProfile): Redirecting to", finalRedirect);
          router.push(finalRedirect);
        }
      }
      return true;
    } catch (error: any) {
      console.error("AuthContext (updateUserProfile): Error updating profile:", error.message, error);
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser) ) {
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
