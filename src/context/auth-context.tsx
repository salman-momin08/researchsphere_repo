
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

const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Can be removed if not used
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

// Fetches user profile from Firestore
const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (fetchUserProfileFromFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  console.log(`AuthContext (fetchUserProfileFromFirestore): Attempting to fetch profile for UID ${uid}`);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      // console.log(`AuthContext (fetchUserProfileFromFirestore): Raw isAdmin from Firestore for ${uid}:`, firestoreIsAdmin, `(type: ${typeof firestoreIsAdmin})`);
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
      console.log(`AuthContext (fetchUserProfileFromFirestore): Profile found for UID ${uid}:`, fetchedUser);
      return fetchedUser;
    } else {
      console.log(`AuthContext (fetchUserProfileFromFirestore): No profile document found for UID ${uid}.`);
      return null;
    }
  } catch (error: any) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching profile for UID ${uid}. Firebase error: ${error.code} - ${error.message}`, error);
    toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};

// Creates or updates a user profile in Firestore after Firebase Auth event
const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileDataFromSignup?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  console.log(`AuthContext (ensureFirestoreUserProfile): Ensuring profile for UID ${firebaseUid}.`);

  try {
    const userSnap = await getDoc(userDocRef);
    const nowServerTimestamp = serverTimestamp();
    const isCreatorAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL;

    // Base data from Firebase Auth and signup form (if available)
    // Ensure all optional fields default to null if not provided
    const baseData: Partial<User> = {
      userId: firebaseUid, // Important for security rules
      email: firebaseUserObject.email || null,
      displayName: profileDataFromSignup?.fullName || firebaseUserObject.displayName || (profileDataFromSignup?.isSocialSignIn && firebaseUserObject.email ? firebaseUserObject.email.split('@')[0] : "User"),
      photoURL: firebaseUserObject.photoURL || null,
      username: profileDataFromSignup?.username || null,
      role: profileDataFromSignup?.role || (isCreatorAdminByEmail ? "Admin" : (profileDataFromSignup?.isSocialSignIn ? "Author" : "Author")),
      phoneNumber: profileDataFromSignup?.phoneNumber || null,
      institution: profileDataFromSignup?.institution || null,
      researcherId: profileDataFromSignup?.researcherId || null,
      isAdmin: isCreatorAdminByEmail || false, // Default admin status based on email for creation
    };

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      console.log(`AuthContext (ensureFirestoreUserProfile): Existing profile found for UID ${firebaseUid}. Merging data.`);
      dataToSave = {
        ...existingData, // Preserve existing fields
        ...baseData,     // Override with new/updated base data
        updatedAt: nowServerTimestamp,
      };
      // Preserve existing isAdmin status if user already exists, unless it's a creator admin email
      if (existingData.isAdmin === true && !isCreatorAdminByEmail) {
         dataToSave.isAdmin = true;
      } else if (isCreatorAdminByEmail) {
         dataToSave.isAdmin = true;
         dataToSave.role = "Admin"; // Ensure role is Admin too
      }
      if (existingData.createdAt && !dataToSave.createdAt) {
        dataToSave.createdAt = existingData.createdAt; // Preserve original creation date
      }
    } else {
      console.log(`AuthContext (ensureFirestoreUserProfile): No existing profile for UID ${firebaseUid}. Creating new one.`);
      dataToSave = {
        ...baseData,
        createdAt: nowServerTimestamp,
        updatedAt: nowServerTimestamp,
      };
    }
    
    // Ensure all optional fields are at least null if not set
    dataToSave.username = dataToSave.username || null;
    dataToSave.role = dataToSave.role || "Author";
    dataToSave.phoneNumber = dataToSave.phoneNumber || null;
    dataToSave.institution = dataToSave.institution || null;
    dataToSave.researcherId = dataToSave.researcherId || null;
    dataToSave.isAdmin = dataToSave.isAdmin || false;

    console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for UID ${firebaseUid}:`, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true }); // Use merge: true to be safe
    console.log(`AuthContext (ensureFirestoreUserProfile): Firestore document set/merged for UID ${firebaseUid}.`);
    
    const fetchedProfile = await fetchUserProfileFromFirestore(firebaseUid); // Fetch fresh to confirm
    if (!fetchedProfile) {
        console.error("AuthContext (ensureFirestoreUserProfile): CRITICAL - Profile fetched as null immediately after setDoc for UID", firebaseUid);
    } else {
      console.log(`AuthContext (ensureFirestoreUserProfile): Successfully fetched profile post-save for UID ${firebaseUid}.`);
    }
    return fetchedProfile;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Critical error creating/updating Firestore profile for UID ${firebaseUid}. Firebase error: ${error.code} - ${error.message}`, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. Details: ${error.message}`, duration: 15000 });
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
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !firebaseAuth || !firestoreDb) {
      if (isMounted && (!firebaseAuth || !firestoreDb)) {
        console.warn("AuthContext: Firebase Auth or Firestore DB instance is not available. Client-side features may be limited.");
        setLoading(false);
      }
      return;
    }

    console.log("AuthContext: Setting up onAuthStateChanged listener.");
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext (onAuthStateChanged): Firebase auth state changed. Firebase user UID:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        // User is signed in with Firebase Auth. Now ensure Firestore profile exists or create it.
        let appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });

        if (appUser) {
          console.log(`AuthContext (onAuthStateChanged): Firestore profile ensured/fetched for UID ${firebaseUser.uid}.`, appUser);
          
          const rawIsAdminFromProfile = appUser.isAdmin;
          // console.log(`AuthContext (onAuthStateChanged): Raw isAdmin from profile for ${firebaseUser.uid}:`, rawIsAdminFromProfile, `(type: ${typeof rawIsAdminFromProfile})`);
          const finalIsAdmin = (firebaseUser.email === ADMIN_CREATOR_EMAIL || firebaseUser.email === MOCK_ADMIN_EMAIL) || (rawIsAdminFromProfile === true);
          // console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);
          
          appUser.isAdmin = finalIsAdmin; // Update appUser in memory with final admin status

          setUser(appUser);
          setIsAdminUser(finalIsAdmin);
          setShowLoginModal(false);

          // Redirection logic
          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }

          const isProfileConsideredComplete = !!(appUser.username && appUser.role && appUser.phoneNumber);
          const isCompletingProfilePage = pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true';
          
          console.log(`AuthContext (onAuthStateChanged): UID ${appUser.id}, isAdmin: ${appUser.isAdmin}, ProfileComplete: ${isProfileConsideredComplete}, CompletingPage: ${isCompletingProfilePage}, Pathname: ${pathname}, RedirectAfterLogin: ${redirectAfterLoginPath}`);

          if (!isProfileConsideredComplete && !isCompletingProfilePage) {
            console.log(`AuthContext (onAuthStateChanged): Profile incomplete for UID ${appUser.id}. Redirecting to complete profile.`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else {
            if (isProfileConsideredComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
              localStorage.removeItem('completingProfile');
            }

            if (redirectAfterLoginPath) {
              console.log(`AuthContext (onAuthStateChanged): UID ${appUser.id} - Has redirectAfterLoginPath: ${redirectAfterLoginPath}. Redirecting.`);
              router.push(redirectAfterLoginPath);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            } else {
              // Default redirection after login if no specific path or profile completion needed
              const onNonAdminEntryPoint = ['/login', '/signup', '/forgot-password', '/', '/profile/settings'].includes(pathname) || (pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true');
              
              if (appUser.isAdmin) {
                if (onNonAdminEntryPoint && !pathname.startsWith('/admin/dashboard')) {
                  console.log(`AuthContext (onAuthStateChanged): Admin UID ${appUser.id} on non-admin entry. Redirecting to /admin/dashboard.`);
                  router.push('/admin/dashboard');
                } else {
                   console.log(`AuthContext (onAuthStateChanged): Admin UID ${appUser.id} - No specific redirect needed or already in admin area. Current path: ${pathname}`);
                }
              } else { // Not an admin
                if (onNonAdminEntryPoint && pathname !== '/') {
                  console.log(`AuthContext (onAuthStateChanged): Non-admin UID ${appUser.id} on auth/profile page. Redirecting to /.`);
                  router.push('/');
                } else {
                   console.log(`AuthContext (onAuthStateChanged): Non-admin UID ${appUser.id} - No specific redirect needed. Current path: ${pathname}`);
                }
              }
            }
          }
        } else {
            console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile failed for Firebase UID:", firebaseUser.uid, ". Logging out Firebase user.");
            if (firebaseAuth) await signOut(firebaseAuth); 
            setUser(null);
            setIsAdminUser(false);
        }
      } else { 
        console.log("AuthContext (onAuthStateChanged): No Firebase user. Clearing local state.");
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
      console.log("AuthContext: Unsubscribing from onAuthStateChanged.");
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
    console.log(`AuthContext (login): Attempting login with identifier: '${identifier}'`);

    if (!identifier.includes('@')) {
      console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
            console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}'.`);
          } else {
            setLoading(false);
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email.`;
            console.error("AuthContext (login): " + errorMsg);
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          console.log(`AuthContext (login): No user found with username '${identifier}'.`);
          toast({ variant: "destructive", title: "Login Failed", description: "Invalid email/username or password." });
          throw new Error("Invalid email/username or password.");
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        console.error("AuthContext (login): " + errorMsg, dbError);
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    try {
      console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged handles success, setting user state, and redirection
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
      console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
    // No setLoading(false) here, onAuthStateChanged handles it
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    console.log("AuthContext (signup): Attempting signup with data:", data);

    // Username and Phone Number uniqueness checks removed from here before Firebase Auth creation
    // Firebase Auth will handle email uniqueness.
    // Username/Phone uniqueness will be handled by ensureFirestoreUserProfile or updateUserProfile after auth.

    let firebaseUser: FirebaseUser;
    try {
      console.log("AuthContext (signup): Calling Firebase createUserWithEmailAndPassword...");
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
      console.log("AuthContext (signup): Firebase user created:", firebaseUser.uid);
    } catch (authError: any) {
      setLoading(false);
      setActiveSocialLoginProvider(null);
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = authError.message || errorMessage;
      }
      console.error("AuthContext (signup): Firebase signup error:", errorMessage, authError);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUser) {
      try {
        console.log("AuthContext (signup): Updating Firebase Auth profile display name to:", data.fullName);
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        console.log("AuthContext (signup): Calling ensureFirestoreUserProfile to create Firestore document...");
        // Pass all signup data to ensureFirestoreUserProfile
        await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, data);
        // onAuthStateChanged will now pick up the new user and Firestore profile
        toast({ title: "Signup Successful", description: "Welcome to ResearchSphere! Please complete your profile if prompted." });
      } catch (profileError: any) {
        // This catch might not be hit if ensureFirestoreUserProfile handles its own toasts
        console.error("AuthContext (signup): Profile setup error after Firebase user creation:", profileError.message, profileError);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
      }
    }
    // No setLoading(false) here, onAuthStateChanged handles it
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    console.log("AuthContext (logout): Attempting logout.");
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      // onAuthStateChanged will clear user state and set loading to false
    } catch (error: any) {
      console.error("AuthContext (logout): Logout failed:", error.message, error);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
      setLoading(false); 
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    // setLoading(false) and setActiveSocialLoginProvider(null) are handled by the main onAuthStateChanged listener
    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing. If this was unintentional, please ensure popups are allowed for this site and try again. Sometimes, quickly switching browser tabs can also cause this.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000, 
          });
          return; // Return here because onAuthStateChanged might not fire, so we need to ensure loading states are reset by it.
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
    console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, toastMessage, firebaseError);
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 7000 });
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    console.log(`AuthContext (processSocialLogin): Attempting ${providerName} login.`);
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged handles success and profile creation/fetching
      toast({ title: `${providerName} Sign-In Successful`, description: "Welcome!" });
    } catch (error) {
      handleSocialLoginError(error, providerName);
      // Ensure loading and provider state are reset if onAuthStateChanged doesn't fire (e.g. popup closed by user)
      // This is a fallback; onAuthStateChanged should ideally handle this by setting firebaseUser to null.
      if ((error as any).code === 'auth/popup-closed-by-user' || (error as any).code === 'auth/cancelled-popup-request') {
        setLoading(false);
        setActiveSocialLoginProvider(null);
      }
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const isUsernameTakenInFirestore = async (username: string, excludeUserId?: string): Promise<boolean> => {
    if (!firestoreDb) return false; 
    if (!username.trim()) return false;
    console.log(`AuthContext (isUsernameTakenInFirestore): Checking username '${username}'`, excludeUserId ? `excluding UID ${excludeUserId}` : '');
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, where("username", "==", username));
    try {
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return false;
      if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
      return true; 
    } catch (error: any) {
      console.error("AuthContext (isUsernameTakenInFirestore): Error checking username:", error.message, error.code);
      toast({variant: "destructive", title: "Validation Error", description: "Could not verify username uniqueness. Please try again."});
      return true; 
    }
  };

  const isPhoneNumberTakenInFirestore = async (phoneNumber: string, excludeUserId?: string): Promise<boolean> => {
    if (!firestoreDb || !phoneNumber || !phoneNumber.trim()) return false;
    console.log(`AuthContext (isPhoneNumberTakenInFirestore): Checking phone '${phoneNumber}'`, excludeUserId ? `excluding UID ${excludeUserId}` : '');
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, where("phoneNumber", "==", phoneNumber));
    try {
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return false;
      if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
      return true; 
    } catch (error: any) {
      console.error("AuthContext (isPhoneNumberTakenInFirestore): Error checking phone number:", error.message, error.code);
      toast({variant: "destructive", title: "Validation Error", description: "Could not verify phone number uniqueness. Please try again."});
      return true; 
    }
  };


 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable. Cannot update profile.";
      console.error("AuthContext (updateUserProfile):", errorMsg);
      toast({ variant: "destructive", title: "Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    console.log("AuthContext (updateUserProfile): Attempting to update profile for UID", user.id, "with data:", updatedData);
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
      // Prepare data, ensuring isAdmin is not changed and null for empty optional fields
      const updatePayloadFS: any = { 
        displayName: updatedData.displayName || user.displayName, // Keep existing if not provided
        username: updatedData.username || null, // Default to null if empty
        role: updatedData.role || user.role, // Keep existing if not provided
        phoneNumber: updatedData.phoneNumber || null, // Default to null if empty
        institution: updatedData.institution || null, // Default to null if empty
        researcherId: updatedData.researcherId || null, // Default to null if empty
        updatedAt: serverTimestamp() 
      };
      
      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }

      console.log("AuthContext (updateUserProfile): Updating Firestore document with payload:", updatePayloadFS);
      await updateDoc(userDocRef, updatePayloadFS);
      console.log("AuthContext (updateUserProfile): Firestore document updated. Fetching latest profile...");
      
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        console.log("AuthContext (updateUserProfile): Successfully fetched updated profile.");
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
        console.error("AuthContext (updateUserProfile): " + errorMsg);
        throw new Error(errorMsg);
      }
    } catch(error: any) {
        console.error("AuthContext (updateUserProfile): Error during profile update process:", error.message, error.code || error);
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
