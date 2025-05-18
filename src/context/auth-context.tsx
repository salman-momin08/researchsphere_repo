
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

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const FORGOT_PASSWORD_PATH = '/forgot-password';

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
  return String(timestamp); // Fallback, should ideally not be needed
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
    const nowServerTimestamp = serverTimestamp();
    const isCreatorAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing Firestore profile for ${uid}:`, existingData);

      dataToSave = {
        email: firebaseUser.email || existingData.email,
        displayName: profileDataFromSignup?.fullName || firebaseUser.displayName || existingData.displayName || null,
        photoURL: firebaseUser.photoURL || existingData.photoURL || null,
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username !== undefined ? existingData.username : null),
        role: profileDataFromSignup?.role || existingData.role || (isCreatorAdminByEmail ? "Admin" : "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber !== undefined ? existingData.phoneNumber : null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution !== undefined ? existingData.institution : null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId !== undefined ? existingData.researcherId : null),
        isAdmin: isCreatorAdminByEmail || (existingData.isAdmin === true),
        isSuspended: existingData.isSuspended || false,
        createdAt: existingData.createdAt ? (existingData.createdAt instanceof Timestamp ? existingData.createdAt : Timestamp.fromDate(new Date(existingData.createdAt as string))) : nowServerTimestamp,
        updatedAt: nowServerTimestamp,
        userId: uid,
      };
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data to update for existing user ${uid}:`, dataToSave);
      await setDoc(userDocRef, dataToSave, { merge: true });
    } else {
      // console.log(`AuthContext (ensureFirestoreUserProfile): No existing profile for ${uid}. Creating new one.`);
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
      // console.log(`AuthContext (ensureFirestoreUserProfile): Data for new user ${uid}:`, dataToSave);
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
      // console.log(`AuthContext (ensureFirestoreUserProfile): Hydrated user ${uid} with data:`, hydratedUser);
      return hydratedUser;
    } else {
      throw new Error(`User document ${uid} not found after create/update operation.`);
    }
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Error ensuring Firestore profile for ${uid}: "${error.message}" "${error.code}"`, error);
    if (error.code === 'permission-denied') {
        toast({ variant: "destructive", title: "Permissions Error", description: "Could not access your profile data due to permission issues. Please check Firestore rules.", duration: 7000 });
    } else {
        toast({ variant: "destructive", title: "Profile Sync Error", description: `Could not save or update your profile. Details: ${error.message}`, duration: 7000 });
    }
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
  const searchParamsFromHook = useNextSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    // console.log(`AuthContext: Top of main useEffect. Pathname: ${pathname}, UserID: ${user?.id}, Loading: ${loading}, IsMounted: ${isMounted}, JustCompletedProfile: ${justCompletedProfile}`);

    if (!isMounted || !firebaseAuth) {
      if (!firebaseAuth && isMounted) setLoading(false);
      return;
    }
    
    if (justCompletedProfile) {
        // console.log("AuthContext: justCompletedProfile is true. Resetting and standing down for this effect cycle.");
        setJustCompletedProfile(false);
        return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log(`AuthContext (onAuthStateChanged): Firebase user state changed. firebaseUser UID: ${firebaseUser?.uid}`);
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
          const determinedIsAdmin = appUser.isAdmin === true;
          setIsAdminUser(determinedIsAdmin);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): User object set. isAdmin: ${determinedIsAdmin}`);

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): Pathname: ${pathname}, isAdminUser: ${determinedIsAdmin}, isProfileComplete: ${isProfileComplete}, RedirectPath: ${redirectAfterLoginPath}, CompletingFlag: ${completingProfileStorageFlag}`);
          // console.log(`AuthContext (onAuthStateChanged for ${appUser.email}): appUser details - username: '${appUser.username}', role: '${appUser.role}', phone: '${appUser.phoneNumber}'`);

          if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
            // console.log(`AuthContext: Profile incomplete for ${appUser.email}. Current path: ${pathname}. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
          } else if (isProfileComplete && (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) && completingProfileStorageFlag === 'true') {
            // console.log(`AuthContext: Profile complete for ${appUser.email}, was on profile settings for completion. Redirecting away.`);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
              if (redirectAfterLoginPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectAfterLoginPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                localStorage.removeItem('redirectAfterLogin');
                redirectAfterLoginPath = null; 
              }
            }
            const targetDashboard = determinedIsAdmin ? ADMIN_DASHBOARD_PATH : (appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            const finalRedirect = redirectAfterLoginPath || targetDashboard;
            // console.log(`AuthContext: Redirecting from settings after completion (fallback by onAuthStateChanged) to: ${finalRedirect}`);
            router.push(finalRedirect);
          } else if (redirectAfterLoginPath) {
            let correctedRedirectPath = redirectAfterLoginPath;
            if (redirectAfterLoginPath === '/user/profile/settings' || redirectAfterLoginPath === '/profile/settings') {
                correctedRedirectPath = `${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`;
            }
            if (!isProfileComplete && correctedRedirectPath !== AUTHOR_PROFILE_SETTINGS_PATH && !correctedRedirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                // If profile is still incomplete, but redirectAfterLoginPath is not settings, force to settings first
                // console.log(`AuthContext: Profile incomplete, redirectAfterLoginPath was ${redirectAfterLoginPath}, forcing to settings.`);
                if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
                router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
            } else if (isProfileComplete || correctedRedirectPath === AUTHOR_PROFILE_SETTINGS_PATH || correctedRedirectPath.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
                // console.log(`AuthContext: Has redirectAfterLoginPath: ${correctedRedirectPath}. Redirecting.`);
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
                router.push(correctedRedirectPath);
            }
          } else {
            const onAuthPage = pathname === LOGIN_PATH || pathname === SIGNUP_PATH || pathname === FORGOT_PASSWORD_PATH;
            const onNonAdminEntryPoint = onAuthPage || pathname === HOME_PATH || pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');

            if (determinedIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
              // console.log(`AuthContext: Admin ${appUser.email} on non-admin entry point (${pathname}). Redirecting to ${ADMIN_DASHBOARD_PATH}.`);
              router.push(ADMIN_DASHBOARD_PATH);
            } else if (!determinedIsAdmin && onAuthPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              const userDashboard = appUser.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
              // console.log(`AuthContext: User ${appUser.email} on auth page (${pathname}). Redirecting to ${userDashboard}.`);
              router.push(userDashboard);
            }
          }
        } else { // appUser is null (ensureFirestoreUserProfile failed)
          console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Forcing logout.");
          if (firebaseAuth) await signOut(firebaseAuth); // This will re-trigger onAuthStateChanged with firebaseUser=null
          setUser(null);
          setIsAdminUser(false);
        }
      } else { // firebaseUser is null
        setUser(null);
        setIsAdminUser(false);
        const isProtectedRoute = !([LOGIN_PATH, SIGNUP_PATH, FORGOT_PASSWORD_PATH, HOME_PATH, '/registration', '/key-committee', '/sample-templates', '/contact-us', '/search-papers', '/terms', '/privacy'].includes(pathname) || pathname === '/');
        if (isProtectedRoute) {
            // console.log(`AuthContext: No firebaseUser, on protected path ${pathname}. Setting redirect and showing login modal.`);
            if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', pathname + (searchParamsFromHook.toString() ? `?${searchParamsFromHook.toString()}` : ''));
            setShowLoginModal(true);
        }
      }
      setLoading(false);
      // console.log(`AuthContext (onAuthStateChanged): Setting loading to false. Final user: ${user?.id}, isAdmin: ${isAdminUser}`);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, user?.id, pathname, router, searchParamsFromHook, justCompletedProfile]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available."});
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    let emailToLogin = identifier.trim();
    let firebaseError = null;

    try {
      if (!identifier.includes('@')) {
        // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
        const usersRef = collection(firestoreDb, "users");
        const q = query(usersRef, where("username", "==", identifier.trim()));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data() as User;
          if (userData.email) {
            emailToLogin = userData.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            // console.warn(`AuthContext (login): User document for username '${identifier}' found but has no email.`);
            throw new Error("User record incomplete for username.");
          }
        } else {
          // console.warn(`AuthContext (login): No email found for username '${identifier}'. Let Firebase handle invalid-credential.`);
        }
      }
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and redirecting
      toast({ title: "Login Successful", description: "Welcome back!" });
      setShowLoginModal(false);
    } catch (error: any) {
      firebaseError = error;
      let errorMessage = error.code === 'auth/invalid-credential' ? "Invalid email/username or password." : (error.message || "Login failed.");
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupFormValues) => {
     if (!firebaseAuth || !firestoreDb) {
      toast({variant: "destructive", title: "Service Error", description: "Authentication service not available."});
      throw new Error("Auth service not available.");
    }
    setLoading(true);
    try {
      if (data.username?.trim()) {
        const usersRef = collection(firestoreDb, "users");
        const qUsername = query(usersRef, where("username", "==", data.username.trim()));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (data.phoneNumber?.trim()) {
        const usersRef = collection(firestoreDb, "users");
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber.trim()));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      if (userCredential.user) {
        await ensureFirestoreUserProfile(userCredential.user, data); // Pass signup data to create Firestore profile
      }
      toast({ title: "Signup Successful!", description: "Your account has been created."});
      setShowLoginModal(false);
      // Redirection is handled by onAuthStateChanged
    } catch (error: any) {
      let errorMessage = error.message || "Signup failed.";
      if (error.code === 'auth/email-already-in-use') errorMessage = "Email already registered.";
      console.error("AuthContext (signup): Signup error:", errorMessage, error);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setActiveSocialLoginProvider(null); 
    // setLoading(false); // setLoading is handled by processSocialLogin's finally
    let toastTitle = `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Sign-In Error`;
    let toastMessage = error.message || "An unexpected error occurred.";

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed by your browser for this site and try again.`;
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toastMessage = `An account already exists with this email using a different sign-in method. Please log in with the original method.`;
    } else if (error.code === 'auth/unauthorized-domain') {
       toastMessage = `This application's domain is not authorized for ${providerName} sign-in. Please check Firebase console configuration.`;
    }
    
    console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, toastMessage, error);
    toast({
      title: toastTitle,
      description: toastMessage,
      variant: "destructive",
      duration: 10000, 
    });
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
      // onAuthStateChanged will handle setting user, profile creation and redirecting
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      setActiveSocialLoginProvider(null); // Always reset after attempt
      // setLoading(false); // setLoading will be handled by onAuthStateChanged after profile sync
    }
  };

  const loginWithGoogle = () => processSocialLogin('google');
  const loginWithGitHub = () => processSocialLogin('github');

  const logout = async () => {
     if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      // setUser(null) and setIsAdminUser(false) handled by onAuthStateChanged
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push(LOGIN_PATH); 
    } catch (error: any) {
      console.error("AuthContext (logout): Logout error:", error);
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
      console.error("AuthContext (sendPasswordResetEmail): Error:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (updatedData: Partial<Pick<User, 'displayName' | 'username' | 'phoneNumber' | 'institution' | 'researcherId' | 'role'>>) => {
    if (!user || !user.id || !firestoreDb || !firebaseAuth?.currentUser) {
      toast({variant: "destructive", title: "Authentication Error", description: "User not authenticated for profile update."});
      throw new Error("User not authenticated.");
    }
    setLoading(true);
    const currentFirebaseUser = firebaseAuth.currentUser;
    let success = false;

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

      const updatePayloadFS: any = { updatedAt: serverTimestamp() };
      if (updatedData.displayName !== undefined) updatePayloadFS.displayName = updatedData.displayName?.trim() || null;
      if (updatedData.username !== undefined) updatePayloadFS.username = updatedData.username?.trim() || null;
      if (updatedData.phoneNumber !== undefined) updatePayloadFS.phoneNumber = updatedData.phoneNumber?.trim() || null;
      if (updatedData.institution !== undefined) updatePayloadFS.institution = updatedData.institution?.trim() || null;
      if (updatedData.researcherId !== undefined) updatePayloadFS.researcherId = updatedData.researcherId?.trim() || null;
      if (updatedData.role !== undefined) updatePayloadFS.role = updatedData.role || "Author"; // Cannot set isAdmin here
      
      const userDocRef = doc(firestoreDb, "users", user.id);
      await updateDoc(userDocRef, updatePayloadFS);

      if (updatedData.displayName && currentFirebaseUser && currentFirebaseUser.displayName !== updatedData.displayName) {
        await firebaseUpdateProfile(currentFirebaseUser, { displayName: updatedData.displayName });
      }

      const updatedUserFromDb = await ensureFirestoreUserProfile(currentFirebaseUser, updatedData); // Re-fetch to get server timestamps and ensure consistency
      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Optimistically update local state
        setIsAdminUser(updatedUserFromDb.isAdmin === true);
        // console.log("AuthContext (updateUserProfile): Optimistically updated local user. New user state:", updatedUserFromDb);
        toast({ title: "Profile Updated", description: "Your profile has been successfully updated." });
        success = true;

        const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        const completingProfileStorageFlag = typeof window !== 'undefined' ? localStorage.getItem('completingProfile') : null;

        if (isProfileNowComplete && completingProfileStorageFlag === 'true') {
          // console.log("AuthContext (updateUserProfile): Profile now complete AND was in 'completingProfile' flow. Clearing flags and redirecting.");
          setJustCompletedProfile(true); // Signal to onAuthStateChanged to stand down
          if (typeof window !== 'undefined') {
            localStorage.removeItem('completingProfile');
            let redirectPath = localStorage.getItem('redirectAfterLogin');
            localStorage.removeItem('redirectAfterLogin'); 
            
            if (redirectPath === AUTHOR_PROFILE_SETTINGS_PATH || redirectPath?.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
              redirectPath = null; 
            }
            const targetDashboard = isAdminUser ? ADMIN_DASHBOARD_PATH : (updatedUserFromDb.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
            // console.log(`AuthContext (updateUserProfile): Redirecting to: ${redirectPath || targetDashboard}`);
            router.push(redirectPath || targetDashboard);
          }
        }
      } else {
        throw new Error("Failed to re-fetch profile after update.");
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

  if (!isMounted || (loading && !user && !firebaseAuth?.currentUser)) {
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
        <p className="text-muted-foreground mb-1">Firebase services (Auth or Firestore) are not available.</p>
        <p className="text-sm text-muted-foreground">Please check client-side Firebase environment variables (NEXT_PUBLIC_FIREBASE_...) and ensure they are correctly set in your `.env.local` file and your hosting provider's settings. Restart the application after verifying.</p>
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
