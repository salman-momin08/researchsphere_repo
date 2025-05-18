
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
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, query, where, getDocs, updateDoc, collection } from 'firebase/firestore';
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

// This function is critical for ensuring user profiles are correctly fetched or created.
const ensureFirestoreUserProfile = async (
  firebaseUser: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues> // Data from signup/profile completion form
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB not available.");
    return null;
  }
  const uid = firebaseUser.uid;
  const userDocRef = doc(firestoreDb, "users", uid);

  console.log(`AuthContext (ensureFirestoreUserProfile): Ensuring profile for UID ${uid}. Email: ${firebaseUser.email}. SignupData:`, profileDataFromSignup);

  try {
    const userSnap = await getDoc(userDocRef);
    let dataToSave: User;
    const nowServerTimestamp = serverTimestamp();
    const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as Partial<User>;
      console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);
      
      dataToSave = {
        id: uid,
        userId: uid, // Ensure this field is always present
        email: firebaseUser.email || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        // Prioritize form data for updates, then existing, then null
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username !== undefined ? existingData.username : null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber !== undefined ? existingData.phoneNumber : null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution !== undefined ? existingData.institution : null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId !== undefined ? existingData.researcherId : null),
        isAdmin: isCreatorAdminByEmail || existingData.isAdmin === true, // isCreatorAdminByEmail takes precedence
        isSuspended: existingData.isSuspended || false,
        createdAt: existingData.createdAt || nowServerTimestamp, // Preserve original createdAt
        updatedAt: nowServerTimestamp,
      };
      console.log(`AuthContext (ensureFirestoreUserProfile): Data to merge/update for existing user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave, { merge: true });
    } else {
      console.log(`AuthContext (ensureFirestoreUserProfile): No existing profile for ${uid}. Creating new one.`);
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
        createdAt: nowServerTimestamp,
        updatedAt: nowServerTimestamp,
      };
      console.log(`AuthContext (ensureFirestoreUserProfile): Data for new user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave);
    }

    const finalSnap = await getDoc(userDocRef);
    if (finalSnap.exists()) {
      const rawData = { id: finalSnap.id, ...finalSnap.data() };
      const hydratedUser: User = {
        ...rawData,
        createdAt: convertFirestoreTimestampToISO(rawData.createdAt),
        updatedAt: convertFirestoreTimestampToISO(rawData.updatedAt),
      } as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Successfully ensured/hydrated profile for ${uid}:`, hydratedUser);
      return hydratedUser;
    } else {
      throw new Error(`User document ${uid} not found after create/update operation.`);
    }
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}" "${error.code}"`, error);
    toast({ variant: "destructive", title: "Profile Sync Error", description: `Could not save or update your profile in our database (${error.code}). Please try again. If issue persists, contact support.`, duration: 10000 });
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
  const [justCompletedProfile, setJustCompletedProfile] = useState(false); 

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    console.log("AuthContext: Main useEffect. Path:", pathname, "Mounted:", isMounted, "User:", user?.id, "JustCompleted:", justCompletedProfile);
    if (!isMounted || !firebaseAuth) {
      if (!firebaseAuth && isMounted) {
        console.error("AuthContext: Firebase Auth service is null even after mount. Critical config error.");
        setLoading(false);
      }
      return;
    }

    if (justCompletedProfile) {
      console.log("AuthContext: justCompletedProfile is true. Resetting and standing down for this effect cycle.");
      setJustCompletedProfile(false);
      // setLoading(false); // Ensure loading is false if we return early
      return; 
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext (onAuthStateChanged): Firebase user state changed. UID:", firebaseUser?.uid);
      setLoading(true); 

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
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Hydrated appUser. IsAdmin: ${determinedIsAdmin}. Profile:`, appUser);
          
          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Path: ${pathname}, IsAdmin: ${determinedIsAdmin}, ProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}`);

          // 1. Profile Completion Flow
          if (!isProfileComplete) {
            if (pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              console.warn(`AuthContext: Profile incomplete for ${appUser.email}. Current path: ${pathname}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
              if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
              router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
              setLoading(false); return;
            }
          } else if (isProfileComplete && completingProfileStorageFlag === 'true' && (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
            console.log(`AuthContext: Profile complete for ${appUser.email}, user was on profile settings for completion. Redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectAfterLoginPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null; 
              }
            }
            const targetDashboard = determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            const finalRedirect = redirectAfterLoginPath || targetDashboard;
            console.log(`AuthContext: Redirecting after explicit completion to: ${finalRedirect}`);
            router.push(finalRedirect);
            setLoading(false); return;
          }

          // 2. Handle redirectAfterLoginPath if not related to profile completion
          if (redirectAfterLoginPath) {
            let correctedRedirectPath = redirectAfterLoginPath;
            if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                correctedRedirectPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`; 
            }
            // Only redirect if this path isn't where profile completion would send them anyway
            if (correctedRedirectPath !== `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true` || isProfileComplete) {
                console.log(`AuthContext: Has redirectAfterLoginPath: ${correctedRedirectPath}. Redirecting.`);
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
                router.push(correctedRedirectPath);
                setLoading(false); return;
            }
          }
          
          // 3. Default dashboard redirects if on auth pages or admin on wrong entry point
          const onAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH;
          const onNonAdminEntryPoint = onAuthPage || pathname === HOME_PATH || (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'));

          if (determinedIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
            console.log(`AuthContext: Admin ${appUser.email} on non-admin entry point (${pathname}). Redirecting to ${ADMIN_DASHBOARD_PATH}.`);
            router.push(ADMIN_DASHBOARD_PATH);
          } else if (!determinedIsAdmin && onAuthPage && (pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
            const userDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
            console.log(`AuthContext: User ${appUser.email} on auth page (${pathname}). Redirecting to ${userDashboard}.`);
            router.push(userDashboard);
          }
        } else {
            console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Logging out Firebase user.");
            if (firebaseAuth) await signOut(firebaseAuth); 
            setUser(null);
            setIsAdminUser(false);
        }
      } else {
        setUser(null);
        setIsAdminUser(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, pathname, router, searchParamsFromHook, user?.id, justCompletedProfile]); // Added user?.id to re-evaluate if user object reference changes

  const login = async (identifier: string, pass: string) => {
    // ... (login logic remains largely the same, ensure setLoading true/false)
    if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available."});
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
          else throw new Error("User record incomplete.");
        }
      }
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful", description: "Welcome back!" });
      setShowLoginModal(false);
    } catch (error: any) {
      const errorMessage = error.code === 'auth/invalid-credential' ? "Invalid email/username or password." : (error.message || "Login failed.");
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
    // ... (signup logic, ensure setLoading true/false)
     if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available."});
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      const usersRef = collection(firestoreDb, "users");
      if (data.username?.trim()) {
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        if (!(await getDocs(qUsername)).empty) throw new Error("Username already taken.");
      }
      if (data.phoneNumber?.trim()) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        if (!(await getDocs(qPhone)).empty) throw new Error("Phone number already in use.");
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user && data.fullName) {
        await firebaseUpdateProfile(userCredential.user, { displayName: data.fullName });
      }
      // Pass signup data to ensure Firestore profile is created with it by onAuthStateChanged
      await ensureFirestoreUserProfile(userCredential.user, data); 
      toast({ title: "Signup Successful!", description: "Your account has been created."});
      setShowLoginModal(false);
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') errorMessage = "Email already registered.";
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null); 
    setLoading(false); 
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
    // ... (social login, ensure setLoading true/false appropriately)
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Error", description: "Authentication service not available." });
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    const providerInstance = providerName === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      // setLoading and activeSocialLoginProvider are handled by onAuthStateChanged or error handler
      // But as a safeguard if onAuthStateChanged doesn't fire (e.g. popup closed before firebase event)
       if (firebaseAuth && !firebaseAuth.currentUser && activeSocialLoginProvider === providerName) {
         setActiveSocialLoginProvider(null);
         setLoading(false);
       }
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
    // ... (logout logic, ensure setLoading true/false)
     if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push(LOGIN_PATH); 
    } catch (error: any) {
      toast({ variant: "destructive", title: "Logout Failed", description: error.message });
    } finally {
      setUser(null); 
      setIsAdminUser(false);
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (emailForReset: string) => {
    // ... (password reset, ensure setLoading true/false)
    if (!firebaseAuth) throw new Error("Auth service not available.");
    setLoading(true);
    try {
      await firebaseSendPasswordResetEmail(firebaseAuth, emailForReset);
      // Toast handled by calling component
    } catch (error: any) {
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      toast({variant: "destructive", title: "Authentication Error", description: "User not authenticated."});
      throw new Error("User not authenticated.");
    }
    setLoading(true);
    const currentFirebaseUser = firebaseAuth.currentUser;
    let success = false;

    try {
      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username.trim() !== "" && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username.trim()));
        if (!(await getDocs(qUsername)).empty && (await getDocs(qUsername)).docs.some(doc => doc.id !== user.id)) {
          throw new Error("Username already taken.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber.trim()));
        if (!(await getDocs(qPhone)).empty && (await getDocs(qPhone)).docs.some(doc => doc.id !== user.id)) {
          throw new Error("Phone number already in use.");
        }
      }

      const updatePayloadFS: any = { updatedAt: serverTimestamp() };
      if (updatedData.displayName !== undefined) updatePayloadFS.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || "Author";
      
      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfile(currentFirebaseUser, { displayName: updatedData.displayName });
      }

      // Optimistically update local state
      const newLocalUser = { ...user, ...updatePayloadFS, updatedAt: new Date().toISOString() } as User;
      setUser(newLocalUser); 
      setIsAdminUser(newLocalUser.isAdmin === true);
      console.log("AuthContext (updateUserProfile): Optimistically updated local user. New user state:", newLocalUser);
      
      toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });
      success = true;

      const isProfileNowComplete = !!(newLocalUser.username && newLocalUser.role && newLocalUser.phoneNumber);
      const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

      if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
        console.log("AuthContext (updateUserProfile): Profile now complete AND was in 'completingProfile' flow. Redirecting.");
        if (typeof window !== 'undefined') {
          localStorage.removeItem('completingProfile');
          let redirectPath = localStorage.getItem('redirectAfterLogin');
          localStorage.removeItem('redirectAfterLogin');
          if (redirectPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            redirectPath = null;
          }
          const targetDashboard = isAdminUser ? ADMIN_DASHBOARD_PATH : (newLocalUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
          setJustCompletedProfile(true); 
          router.push(redirectPath || targetDashboard);
        }
      }
      return success;
    } catch (error: any) {
      console.error("AuthContext (updateUserProfile): Error updating profile:", error.message, error);
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  if ((!firebaseAuth || !firestoreDb) && isMounted) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background p-4 text-center">
        <h1 className="text-2xl font-bold text-destructive mb-2">Application Configuration Error</h1>
        <p className="text-muted-foreground mb-1">Firebase services not available.</p>
        <p className="text-sm text-muted-foreground">Please check Firebase environment variables and restart.</p>
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

    