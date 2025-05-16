
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
  if (!firestoreDb) {
    // console.error("AuthContext (fetchUserProfileFromFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      // console.log(`AuthContext (fetchUserProfileFromFirestore): Raw isAdmin from Firestore for ${uid}:`, firestoreIsAdmin, `(type: ${typeof firestoreIsAdmin})`);
      const determinedIsAdmin = firestoreIsAdmin === true; // Strict boolean check

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
    // console.warn(`AuthContext (fetchUserProfileFromFirestore): No user document found for UID ${uid}. A new one will be created if this is part of login/signup.`);
    return null;
  } catch (error: any) {
    // console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching user profile for UID ${uid}:`, error.message, error.code);
    toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};

// This function is critical for ensuring a user document exists in Firestore.
// It's called after Firebase Auth events (login, signup).
const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    // console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);

  try {
    const userSnap = await getDoc(userDocRef);
    const isCreatorAdminEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL;
    const isMockAdminEmail = firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): User ${firebaseUid} exists. Merging data. Existing isAdmin:`, existingData.isAdmin);
      dataToSave = {
        // ...existingData, // Spread existing data first
        email: firebaseUserObject.email || existingData.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseUserObject.displayName || existingData.displayName || "User",
        photoURL: firebaseUserObject.photoURL || existingData.photoURL || null,
        // Only overwrite these if provided by signup, otherwise keep existing or default to null
        username: profileDataFromSignup?.username !== undefined ? (profileDataFromSignup.username || null) : (existingData.username || null),
        role: profileDataFromSignup?.role !== undefined ? (profileDataFromSignup.role || (existingData.role || "Author")) : (existingData.role || "Author"),
        phoneNumber: profileDataFromSignup?.phoneNumber !== undefined ? (profileDataFromSignup.phoneNumber || null) : (existingData.phoneNumber || null),
        institution: profileDataFromSignup?.institution !== undefined ? (profileDataFromSignup.institution || null) : (existingData.institution || null),
        researcherId: profileDataFromSignup?.researcherId !== undefined ? (profileDataFromSignup.researcherId || null) : (existingData.researcherId || null),
        isAdmin: isCreatorAdminEmail || isMockAdminEmail || existingData.isAdmin || false, // Prioritize email flags, then existing, then default
        updatedAt: serverTimestamp(),
        // createdAt: existingData.createdAt || serverTimestamp(), // Keep original createdAt
      };
       if (existingData.createdAt) {
         dataToSave.createdAt = existingData.createdAt; // Preserve original creation timestamp
       } else {
         dataToSave.createdAt = serverTimestamp();
       }
    } else {
      // console.log(`AuthContext (ensureFirestoreUserProfile): New user ${firebaseUid}. Creating Firestore document.`);
      dataToSave = {
        userId: firebaseUid, // Explicitly set userId field
        email: firebaseUserObject.email || null,
        displayName: profileDataFromSignup?.fullName || firebaseUserObject.displayName || (profileDataFromSignup?.isSocialSignIn && firebaseUserObject.email ? firebaseUserObject.email.split('@')[0] : "User"),
        photoURL: firebaseUserObject.photoURL || null,
        username: profileDataFromSignup?.username || null, // Default to null
        role: profileDataFromSignup?.role || (isCreatorAdminEmail || isMockAdminEmail ? "Admin" : "Author"), // Default to "Author" or "Admin"
        phoneNumber: profileDataFromSignup?.phoneNumber || null, // Default to null
        institution: profileDataFromSignup?.institution || null, // Default to null
        researcherId: profileDataFromSignup?.researcherId || null, // Default to null
        isAdmin: isCreatorAdminEmail || isMockAdminEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    }
    
    // Ensure all optional fields are explicitly null if not set to prevent 'undefined' in Firestore
    // This is now handled by the defaulting logic above.

    // console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for ${firebaseUid}:`, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge:true to be safe for both create and update scenarios
    
    const fetchedProfile = await fetchUserProfileFromFirestore(firebaseUid); // Fetch fresh data after write
    // console.log(`AuthContext (ensureFirestoreUserProfile): Profile fetched after save for ${firebaseUid}:`, fetchedProfile);
    return fetchedProfile;

  } catch (error: any) {
    // console.error(`AuthContext (ensureFirestoreUserProfile): Error for UID ${firebaseUid}:`, error.message, error.code);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 15000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false); // Specific state for isAdmin
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        // console.warn("AuthContext: Firebase Auth or Firestore DB instance is not available early. Client-side features may be limited until ready.");
        setLoading(false);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext (onAuthStateChanged): Auth state changed. Firebase user:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        let appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });

        if (appUser) {
          const isAdminByEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          // console.log(`AuthContext (onAuthStateChanged): Raw isAdmin from Firestore profile for ${firebaseUser.uid}:`, rawIsAdminFromProfile, `(type: ${typeof rawIsAdminFromProfile})`);
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true); // Strict boolean check
          // console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);
          
          appUser.isAdmin = finalIsAdmin; // Ensure appUser object reflects this
          
          setUser(appUser);
          setIsAdminUser(finalIsAdmin); // Set specific isAdmin state
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }

          const isProfileComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          // console.log(`AuthContext (onAuthStateChanged): User: ${appUser.id}, isAdmin: ${finalIsAdmin}, isProfileComplete: ${isProfileComplete}, Pathname: ${pathname}`);
          
          const currentClientSearchParams = searchParamsFromHook; // Use the one from top level

          if (!isProfileComplete && pathname !== '/profile/settings') {
            // console.log("AuthContext (onAuthStateChanged): Profile incomplete. Redirecting to /profile/settings?complete=true");
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else if (isProfileComplete && pathname === '/profile/settings' && (currentClientSearchParams?.get('complete') === 'true' || (typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true'))) {
            // console.log("AuthContext (onAuthStateChanged): Profile complete and on settings page with complete=true. Redirecting away.");
            if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
            const targetPath = redirectAfterLoginPath || (finalIsAdmin ? '/admin/dashboard' : '/');
            router.push(targetPath);
            if (redirectAfterLoginPath && typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
          } else if (redirectAfterLoginPath) {
            // console.log("AuthContext (onAuthStateChanged): redirectAfterLoginPath found:", redirectAfterLoginPath, "Current pathname:", pathname);
            // Only redirect if not already on the target path to avoid loop
            if (pathname !== redirectAfterLoginPath) {
                router.push(redirectAfterLoginPath);
            }
            if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
          } else {
            const onNonAdminEntryPoint = ['/login', '/signup', '/forgot-password', '/'].includes(pathname) || (pathname === '/profile/settings' && currentClientSearchParams?.get('complete') === 'true');
            if (finalIsAdmin && onNonAdminEntryPoint && !pathname.startsWith('/admin/dashboard')) {
              // console.log("AuthContext (onAuthStateChanged): Admin on non-admin entry point. Redirecting to /admin/dashboard. Current path:", pathname);
              router.push('/admin/dashboard');
            } else if (!finalIsAdmin && onNonAdminEntryPoint && pathname !== '/') {
                 // console.log("AuthContext (onAuthStateChanged): Non-admin on auth page post-login. Redirecting to /. Current path:", pathname);
                // router.push('/'); // This might be too aggressive. User might land on / then get profile, then redirect.
            }
            // If user is admin and already on an admin page, or non-admin on a non-auth page, no redirect needed here.
            // console.log("AuthContext (onAuthStateChanged): No specific redirect needed based on admin status or entry point. Pathname:", pathname);
          }
        } else {
          // console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile returned null. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setIsAdminUser(false);
        }
      } else { 
        // console.log("AuthContext (onAuthStateChanged): No Firebase user. Clearing local state.");
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
      // console.log("AuthContext: Unsubscribing from onAuthStateChanged.");
      unsubscribe();
    };
  }, [isMounted, pathname, router, searchParamsFromHook]); // Added searchParamsFromHook

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
      // console.error("AuthContext (isUsernameTakenInFirestore): Error:", error.message);
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
      // console.error("AuthContext (isPhoneNumberTakenInFirestore): Error:", error.message);
      toast({variant: "destructive", title: "Validation Error", description: "Could not verify phone number uniqueness. Please try again."});
      return true; 
    }
  };

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            setLoading(false);
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email.`;
            // console.error("AuthContext (login): " + errorMsg);
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          // console.warn(`AuthContext (login): No email found for username '${identifier}'.`);
          toast({ variant: "destructive", title: "Login Failed", description: "Invalid email/username or password." });
          throw new Error("Invalid email/username or password.");
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        // console.error("AuthContext (login): " + errorMsg, dbError);
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    try {
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and toast
    } catch (error) {
      setLoading(false); // setLoading(false) will be handled by onAuthStateChanged finally block. If error here, auth state won't change.
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
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage); // Re-throw for the form to catch
    }
    // setLoading(false) will be handled by onAuthStateChanged's finally block
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // Client-side pre-checks (moved from earlier to simplify rules)
    if (await isUsernameTakenInFirestore(data.username)) {
      setLoading(false);
      throw new Error("Username already taken. Please choose another one.");
    }
    if (data.phoneNumber && await isPhoneNumberTakenInFirestore(data.phoneNumber)) {
      setLoading(false);
      throw new Error("Phone number already in use. Please use a different one.");
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
      // console.error("AuthContext (signup): Firebase signup error:", errorMessage, authError);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUser) {
      try {
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        // ensureFirestoreUserProfile will be called by onAuthStateChanged
        // but we can call it here to immediately create the Firestore doc with more details
        const appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, data);
        if (!appUser) {
          // This case should ideally not happen if ensureFirestoreUserProfile is robust
          throw new Error("Failed to create Firestore profile after signup.");
        }
        // onAuthStateChanged will set user state and handle redirects
      } catch (profileError: any) {
        // console.error("AuthContext (signup): Firestore profile creation/update error:", profileError.message, profileError);
        // If Firestore profile creation fails, the user exists in Auth but not Firestore.
        // onAuthStateChanged will attempt to create it again.
        // For now, we'll show a more generic error.
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try logging in or updating your profile.`, duration: 10000 });
        // Don't re-throw here, let onAuthStateChanged handle the state.
      }
    }
    // setLoading(false) will be handled by onAuthStateChanged's finally block
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true); // Indicate loading during logout
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will clear user state and handle redirects/toast
    } catch (error: any) {
      // console.error("AuthContext (logout): Logout Failed:", error.message, error);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
      setLoading(false); // Reset loading if logout itself fails
    }
    // setLoading(false) will be handled by onAuthStateChanged's finally block
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. If this was unintentional, please ensure popups are allowed and try again. Some browsers or extensions might block popups.`;
          toast({
            title: toastTitle,
            description: toastMessage,
            duration: 10000, 
          });
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
    // console.error(`AuthContext (${providerName}Login): Social login error:`, toastMessage, firebaseError);
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 7000 });
    setLoading(false); 
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
      // onAuthStateChanged will handle setting user and toast
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) will be handled by onAuthStateChanged's finally block or handleSocialLoginError
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable. Cannot update profile.";
      // console.error("AuthContext (updateUserProfile): " + errorMsg);
      toast({ variant: "destructive", title: "Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    setLoading(true);

    try {
      if (updatedData.username && updatedData.username !== user.username) {
        if (await isUsernameTakenInFirestore(updatedData.username, user.id)) {
          setLoading(false);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        if (await isPhoneNumberTakenInFirestore(updatedData.phoneNumber, user.id)) {
            setLoading(false);
            throw new Error("Phone number already in use. Please use a different one.");
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
      // console.log("AuthContext (updateUserProfile): Update payload for Firestore:", updatePayloadFS);
      
      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }

      await updateDoc(userDocRef, updatePayloadFS);
      
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb);
        setIsAdminUser(updatedUserFromDb.isAdmin === true); // Update specific isAdmin state

        const isProfileNowComplete = !!(updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber);
        if (isProfileNowComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
            localStorage.removeItem('completingProfile');
            const redirectPath = localStorage.getItem('redirectAfterLogin');
            const targetPath = redirectPath || (updatedUserFromDb.isAdmin ? '/admin/dashboard' : '/');
            // console.log(`AuthContext (updateUserProfile): Profile complete. Redirecting to ${targetPath}`);
            if (pathname !== targetPath) router.push(targetPath);
            if (redirectPath) localStorage.removeItem('redirectAfterLogin');
        }
        setLoading(false);
        return updatedUserFromDb;
      } else {
        const errorMsg = "Profile updated in Firestore, but failed to reload latest data into context.";
        // console.error("AuthContext (updateUserProfile): " + errorMsg);
        throw new Error(errorMsg);
      }
    } catch(error: any) {
        // console.error("AuthContext (updateUserProfile): General error during update:", error.message, error);
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
        showLoginModal, setShowLoginModal, isAdmin: isAdminUser, // Provide specific isAdmin state
        isSocialLoginInProgress: activeSocialLoginProvider !== null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
