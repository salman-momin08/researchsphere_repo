
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

// Define path constants
const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_PROFILE_SETTINGS_PATH = '/admin/profile/settings';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const ADMIN_CREATOR_EMAIL = "admin-creator@researchsphere.com";
const MOCK_ADMIN_EMAIL = "admin@example.com"; // For easier local admin testing

const convertFirestoreTimestampToISO = (timestamp: any): string | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) return timestamp.toDate().toISOString();
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === 'object' && timestamp.seconds !== undefined && typeof timestamp.seconds === 'number' && timestamp.nanoseconds !== undefined && typeof timestamp.nanoseconds === 'number') {
    return new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000).toISOString();
  }
  return String(timestamp);
};

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdminUser: boolean;
  isProfileComplete: boolean;
  initialAuthCheckComplete: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (emailForReset: string) => Promise<void>;
  updateUserProfile: (data: Partial<User>) => Promise<boolean>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  isSocialLoginInProgress: boolean;
  showIncompleteProfileToast: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [initialAuthCheckComplete, setInitialAuthCheckComplete] = useState(false);
  const [hasShownIncompleteProfileToast, setHasShownIncompleteProfileToast] = useState(false);

  const router = useRouter();
  const pathnameFromHook = usePathname(); // For dependency array of main effect
  const searchParamsFromHook = useNextSearchParams(); // For dependency array of main effect
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const ensureFirestoreUserProfile = useCallback(async (
    firebaseUser: FirebaseUser,
    profileDataFromSignupOrUpdate?: Partial<User>,
    isUpdatingProfileOp: boolean = false // Renamed to avoid conflict with isUpdatingProfile state
  ): Promise<User | null> => {
    if (!firestoreDb) {
      console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
      return null;
    }
    const uid = firebaseUser.uid;
    const userDocRef = doc(firestoreDb, "users", uid);

    try {
      const userSnap = await getDoc(userDocRef);
      let dataToSave: Omit<User, 'id'> & { createdAt?: any, updatedAt?: any };
      const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

      if (userSnap.exists()) {
        const existingData = userSnap.data() as User;
        // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

        let determinedRole = existingData.role;
        if (isUpdatingProfileOp && profileDataFromSignupOrUpdate?.role) {
          determinedRole = profileDataFromSignupOrUpdate.role;
        } else if (!existingData.role) {
          determinedRole = isAdminByEmail ? "Admin" : "Author";
        }

        let determinedIsAdmin = existingData.isAdmin || false;
        if (isAdminByEmail) {
          determinedIsAdmin = true;
          if (determinedRole !== "Admin") determinedRole = "Admin";
        } else if (isUpdatingProfileOp && profileDataFromSignupOrUpdate && 'isAdmin' in profileDataFromSignupOrUpdate) {
          determinedIsAdmin = existingData.isAdmin || false; // Users cannot make themselves admin via self-update
        }
        
        dataToSave = {
          userId: uid,
          email: firebaseUser.email || existingData.email || null,
          displayName: profileDataFromSignupOrUpdate?.displayName || firebaseUser.displayName || existingData.displayName || firebaseUser.email || "User",
          photoURL: profileDataFromSignupOrUpdate?.photoURL || firebaseUser.photoURL || existingData.photoURL || null,
          username: isUpdatingProfileOp && profileDataFromSignupOrUpdate?.username !== undefined ? (profileDataFromSignupOrUpdate.username || null) : (existingData.username || null),
          role: determinedRole,
          phoneNumber: isUpdatingProfileOp && profileDataFromSignupOrUpdate?.phoneNumber !== undefined ? (profileDataFromSignupOrUpdate.phoneNumber || null) : (existingData.phoneNumber || null),
          institution: isUpdatingProfileOp && profileDataFromSignupOrUpdate?.institution !== undefined ? (profileDataFromSignupOrUpdate.institution || null) : (existingData.institution || null),
          researcherId: isUpdatingProfileOp && profileDataFromSignupOrUpdate?.researcherId !== undefined ? (profileDataFromSignupOrUpdate.researcherId || null) : (existingData.researcherId || null),
          isAdmin: determinedIsAdmin,
          isSuspended: isUpdatingProfileOp && profileDataFromSignupOrUpdate?.isSuspended !== undefined ? profileDataFromSignupOrUpdate.isSuspended : (existingData.isSuspended || false),
          createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt))) : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        // console.log(`AuthContext (ensureFirestoreUserProfile): Data to merge/update for existing user ${uid}:`, dataToSave);
        await setDoc(userDocRef, dataToSave, { merge: true });
      } else { // New user document
        const defaultRole = isAdminByEmail ? "Admin" : (profileDataFromSignupOrUpdate?.role || "Author");
        dataToSave = {
          userId: uid,
          email: firebaseUser.email,
          displayName: profileDataFromSignupOrUpdate?.displayName || firebaseUser.displayName || firebaseUser.email || "User",
          photoURL: profileDataFromSignupOrUpdate?.photoURL || firebaseUser.photoURL || null,
          username: profileDataFromSignupOrUpdate?.username || null,
          role: defaultRole,
          phoneNumber: profileDataFromSignupOrUpdate?.phoneNumber || null,
          institution: profileDataFromSignupOrUpdate?.institution || null,
          researcherId: profileDataFromSignupOrUpdate?.researcherId || null,
          isAdmin: isAdminByEmail,
          isSuspended: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        // console.log(`AuthContext (ensureFirestoreUserProfile): Data to create for new user ${uid}:`, dataToSave);
        await setDoc(userDocRef, dataToSave);
      }

      const finalSnap = await getDoc(userDocRef);
      if (finalSnap.exists()) {
        const rawData = { id: finalSnap.id, ...finalSnap.data() } as any;
        const hydratedUser: User = {
          ...rawData,
          createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
          updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
        };
        // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated user ${uid} for context:`, hydratedUser);
        return hydratedUser;
      }
      throw new Error(`User document ${uid} not found after create/update.`);
    } catch (error: any) {
      console.error(`AuthContext (ensureFirestoreUserProfile): Error for ${uid}: "${error.message}"`, error.code, error);
      // Toast handled by caller or main effect
      return null;
    }
  }, []); // Removed toast dependency to avoid potential loops if toast context re-renders

  const showIncompleteProfileToastCb = useCallback(() => {
    if (typeof window !== 'undefined' && !sessionStorage.getItem('incompleteProfileToastShownThisSession')) {
      toast({
        title: "Profile Incomplete",
        description: "Your profile is missing some key details. Please visit Profile Settings to update it.",
        duration: 7000,
        variant: "default"
      });
      sessionStorage.setItem('incompleteProfileToastShownThisSession', 'true');
      setHasShownIncompleteProfileToast(true);
    }
  }, [toast]);

  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        // Error rendering handled by AuthProvider's return
      }
      if(!isMounted) setLoading(true); // Ensure loading is true until mounted and first auth check runs
      return;
    }
    // console.log(`AuthContext: Main effect triggered. Pathname from hook: ${pathnameFromHook}`);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentFirebaseUser: FirebaseUser | null) => {
      // console.log(`AuthContext (onAuthStateChanged): Firebase user state changed. UID:`, currentFirebaseUser?.uid || null);
      setLoading(true); // Set loading for the duration of this async operation

      const currentWindowPathname = typeof window !== 'undefined' ? window.location.pathname : pathnameFromHook;
      const currentWindowSearchParams = typeof window !== 'undefined' ? window.location.search : searchParamsFromHook.toString();

      if (currentFirebaseUser) {
        const appUser = await ensureFirestoreUserProfile(currentFirebaseUser);

        if (appUser) {
          setUser(appUser);
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          const isProfileActuallyComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          setIsProfileComplete(isProfileActuallyComplete);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Current Window Path: ${currentWindowPathname}, IsAdmin: ${determinedIsAdmin}, ProfileComplete: ${isProfileActuallyComplete}`);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);

          let redirectAfterLoginPath = typeof window !== 'undefined' ? localStorage.getItem('redirectAfterLogin') : null;
          const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;

          // Path correction for profile settings
          if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
            redirectAfterLoginPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
          }
          
          // --- Redirection Decision Tree ---
          if (!isProfileActuallyComplete) {
            if (currentWindowPathname !== AUTHOR_PROFILE_SETTINGS_PATH && !currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              // console.log(`AuthContext: Profile incomplete for ${appUser.email}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
              if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            } else {
              // console.log(`AuthContext: Profile incomplete, but already on settings page for ${appUser.email}. No redirect from here.`);
            }
          } else { // Profile IS complete
            if (completingProfileStorageFlag && (currentWindowPathname === AUTHOR_PROFILE_SETTINGS_PATH || currentWindowPathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
              // console.log(`AuthContext: Profile complete, was on settings for completion for ${appUser.email}. Clearing flags & redirecting.`);
              if (typeof window !== 'undefined') {
                localStorage.removeItem('completingProfile');
                localStorage.removeItem('redirectAfterLogin');
              }
              const targetDashboard = determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              router.push(redirectAfterLoginPath && ![AUTHOR_PROFILE_SETTINGS_PATH, ADMIN_PROFILE_SETTINGS_PATH].includes(redirectAfterLoginPath.split('?')[0]) ? redirectAfterLoginPath : targetDashboard);
            } else if (redirectAfterLoginPath) {
              // console.log(`AuthContext: Profile complete. Handling redirectAfterLoginPath: ${redirectAfterLoginPath} for ${appUser.email}.`);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              router.push(redirectAfterLoginPath);
            } else {
              const onAuthPage = [LOGIN_PATH, SIGNUP_PATH].includes(currentWindowPathname);
              const nonAdminEntryPoints = [HOME_PATH, LOGIN_PATH, SIGNUP_PATH, AUTHOR_PROFILE_SETTINGS_PATH, ADMIN_PROFILE_SETTINGS_PATH];

              if (determinedIsAdmin && nonAdminEntryPoints.includes(currentWindowPathname) && !currentWindowPathname.startsWith('/admin/')) {
                // console.log(`AuthContext: Admin ${appUser.email} on non-admin entry. Redirecting to admin dashboard.`);
                router.push(ADMIN_DASHBOARD_PATH);
              } else if (!determinedIsAdmin && onAuthPage) {
                // console.log(`AuthContext: User ${appUser.email} on auth page. Redirecting to user dashboard.`);
                router.push(appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
              } else {
                // console.log(`AuthContext: User ${appUser.email} on valid page ${currentWindowPathname}. No default redirect needed.`);
              }
            }
          }
        } else { // ensureFirestoreUserProfile returned null (Firestore error)
          console.error("AuthContext: Firestore profile sync failed. Firebase user exists but appUser is null. Logging out.");
          if (firebaseAuth) await signOut(firebaseAuth); // This will re-trigger onAuthStateChanged with null
        }
      } else { // No firebaseUser (logged out)
        setUser(null);
        setIsAdminUser(false);
        setIsProfileComplete(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
          // Do not clear 'redirectAfterLogin' here, user might log back in.
          sessionStorage.removeItem('incompleteProfileToastShownThisSession');
        }
      }
      setLoading(false);
      setInitialAuthCheckComplete(true);
      // console.log(`AuthContext (onAuthStateChanged): Setting loading to false. InitialAuthCheckComplete: true.`);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, pathnameFromHook, searchParamsFromHook]); // router, ensureFirestoreUserProfile removed to simplify and control flow from within effect


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();

    try {
      if (!identifier.includes('@')) {
        // Attempt to find user by username
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) {
            emailToLogin = userData.email;
          } else {
            // This case should ideally not happen if profiles are complete
            throw new Error(`User account for '${identifier}' is improperly configured (missing email).`);
          }
        } else {
          // Username not found, proceed to try identifier as email (will likely fail if it's not an email)
          // Or, more explicitly, throw an error here if we want to differentiate "username not found"
          // For security, it's better to have a generic error later.
        }
      }
      // Attempt to sign in with the determined email (or original identifier if it was an email)
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      setShowLoginModal(false);
      setHasShownIncompleteProfileToast(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
    } catch (error: any) {
      let errorMessage = "Invalid email/username or password.";
      // Firebase errors for invalid credentials, user not found, or wrong password
      if (error.code === 'auth/invalid-credential' || 
          error.code === 'auth/user-not-found' || 
          error.code === 'auth/wrong-password' ||
          error.code === 'auth/invalid-email') { // invalid-email might occur if username was used and not found
        // Keep generic message for these specific auth errors
      } else if (error.message.startsWith('User account for')) {
        // Specific error from our username check
        errorMessage = error.message;
      }
      else {
        // For other types of errors, use Firebase's message or a fallback
        errorMessage = error.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage); // Re-throw to be caught by the form if needed
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Signup service not available." });
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      const usersRef = collection(firestoreDb, "users");
      const qUsername = query(usersRef, where("username", "==", data.username.trim()));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) throw new Error("Username already taken. Please choose another one.");

      if (data.phoneNumber && data.phoneNumber.trim()) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) throw new Error("Phone number already in use. Please use a different one.");
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await firebaseUpdateProfileAuth(userCredential.user, { displayName: data.fullName });
        const initialProfileData: Partial<User> = {
          displayName: data.fullName, username: data.username.trim(), role: data.role, phoneNumber: data.phoneNumber.trim(),
          institution: data.institution?.trim() || null, researcherId: data.researcherId?.trim() || null,
        };
        const appUser = await ensureFirestoreUserProfile(userCredential.user, initialProfileData); // This will create the Firestore doc
        if (!appUser) throw new Error("Failed to create Firestore profile after signup.");
        
        toast({ title: "Signup Successful!", description: "Your account has been created." });
        setShowLoginModal(false);
        setHasShownIncompleteProfileToast(false);
        if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
      }
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') errorMessage = "Email already registered.";
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null);
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || `An unexpected error during ${providerName} sign-in.`;
    let duration = 7000;
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      toastMessage = `The ${providerName} sign-in popup was closed. Please try again. Ensure popups are not blocked.`; duration = 10000;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account exists with this email using a different sign-in. Try the original method.`; duration = 10000;
    } // ... other specific error codes
    toast({ title: toastTitle, description: toastMessage, variant: "destructive", duration: duration });
  };

  const processSocialLogin = async (providerName: 'google' | 'github') => {
    if (!firebaseAuth) return;
    setLoading(true); setActiveSocialLoginProvider(providerName);
    const providerInstance = providerName === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
    if (providerName === 'google') providerInstance.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      setShowLoginModal(false); setHasShownIncompleteProfileToast(false);
      if (typeof window !== 'undefined') sessionStorage.removeItem('incompleteProfileToastShownThisSession');
    } catch (error) { handleSocialLoginError(error, providerName);
    } finally { /* setLoading handled by onAuthStateChanged */ }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    if (!firebaseAuth) return; setLoading(true);
    try { await signOut(firebaseAuth); toast({ title: "Logged Out" }); router.push(HOME_PATH);
    } catch (error: any) { toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally { /* setLoading handled by onAuthStateChanged */ }
  };

  const sendPasswordResetEmail = async (emailForReset: string) => {
    if (!firebaseAuth) throw new Error("Auth service not available."); setLoading(true);
    try { await firebaseSendPasswordResetEmail(firebaseAuth, emailForReset);
    } catch (error: any) { throw error;
    } finally { setLoading(false); }
  };

  const updateUserProfile = async (data: Partial<User>): Promise<boolean> => {
    const currentFirebaseUser = firebaseAuth?.currentUser;
    if (!currentFirebaseUser || !user || !user.id || !firestoreDb) {
      toast({ variant: "destructive", title: "Authentication Error", description: "User not authenticated." });
      throw new Error("User not authenticated for profile update.");
    }
    setLoading(true);
    let success = false;
    try {
      if (data.username && data.username.trim() && data.username !== user.username) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken.");
        }
      }
      if (data.phoneNumber && data.phoneNumber.trim() && data.phoneNumber !== user.phoneNumber) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use.");
        }
      }

      const updatePayloadFS: Partial<User> & { updatedAt: any } = { updatedAt: serverTimestamp() };
      if (data.displayName !== undefined) updatePayloadFS.displayName = data.displayName?.trim() || null;
      if (data.username !== undefined) updatePayloadFS.username = data.username?.trim() || null;
      if (data.phoneNumber !== undefined) updatePayloadFS.phoneNumber = data.phoneNumber?.trim() || null;
      if (data.institution !== undefined) updatePayloadFS.institution = data.institution?.trim() || null;
      if (data.researcherId !== undefined) updatePayloadFS.researcherId = data.researcherId?.trim() || null;
      if (data.role !== undefined) updatePayloadFS.role = data.role || "Author";

      if (data.displayName && currentFirebaseUser.displayName !== data.displayName) {
        await firebaseUpdateProfileAuth(currentFirebaseUser, { displayName: data.displayName });
      }
      
      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);
      
      const updatedAppUser = await ensureFirestoreUserProfile(currentFirebaseUser, data, true); // Pass data to guide merge

      if (updatedAppUser) {
        setUser(updatedAppUser);
        setIsAdminUser(updatedAppUser.isAdmin === true);
        const isNowComplete = !!(updatedAppUser.username && updatedAppUser.role && updatedAppUser.phoneNumber);
        setIsProfileComplete(isNowComplete);
        
        success = true;
        toast({ title: "Success", description: "Profile updated." });

        const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') === 'true' : false;
        if (isNowComplete && completingProfileStorageFlag) {
          // console.log("AuthContext (updateUserProfile): Profile now complete, was in completing flow. Redirecting away.");
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            const redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin');
            
            const targetDashboard = updatedAppUser.isAdmin ? ADMIN_DASHBOARD_PATH : (updatedAppUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            const finalRedirectPath = redirectAfterLoginPath && ![AUTHOR_PROFILE_SETTINGS_PATH, ADMIN_PROFILE_SETTINGS_PATH].includes(redirectAfterLoginPath.split('?')[0]) ? redirectAfterLoginPath : targetDashboard;
            router.push(finalRedirectPath);
          }
        }
      } else {
        throw new Error("Failed to re-fetch profile after update.");
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message });
      throw error;
    } finally {
      setLoading(false);
    }
    return success;
  };


  if (!isMounted || (!initialAuthCheckComplete && loading)) {
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
        <h1 className="text-xl md:text-2xl font-bold text-destructive mb-2">Application Configuration Error</h1>
        <p className="text-muted-foreground mb-1">Firebase services not available.</p>
        <p className="text-sm text-muted-foreground">Check <code>NEXT_PUBLIC_FIREBASE_...</code> vars.</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdminUser,
        isProfileComplete,
        initialAuthCheckComplete,
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
        showIncompleteProfileToast: showIncompleteProfileToastCb,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
