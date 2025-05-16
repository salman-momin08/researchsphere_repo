
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
  // getIdToken, // Not used in frontend-only mock
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
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
      const determinedIsAdmin = firestoreIsAdmin === true; // Strict boolean check

      const fetchedUser = {
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
      // console.log(`AuthContext (fetchUserProfileFromFirestore): Profile found for UID ${uid}:`, fetchedUser);
      return fetchedUser;
    } else {
      // console.log(`AuthContext (fetchUserProfileFromFirestore): No profile document found for UID ${uid}.`);
      return null;
    }
  } catch (error: any) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching profile for UID ${uid}:`, error.message, error.code);
    toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};

const ensureFirestoreUserProfile = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileData?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (ensureFirestoreUserProfile): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  console.log(`AuthContext (ensureFirestoreUserProfile): Ensuring profile for UID ${firebaseUid}. Provided profileData:`, profileData);

  try {
    const userSnap = await getDoc(userDocRef);
    const nowServerTimestamp = serverTimestamp();
    const isCreatorAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    let baseData: Partial<User> = {
      userId: firebaseUid, // Ensure userId field is part of the document for rules
      email: firebaseUserObject.email,
      displayName: profileData?.fullName || firebaseUserObject.displayName || (profileData?.isSocialSignIn && firebaseUserObject.email ? firebaseUserObject.email.split('@')[0] : null) || "User",
      photoURL: firebaseUserObject.photoURL || null,
      username: profileData?.username || null,
      role: profileData?.role || (isCreatorAdminByEmail ? "Admin" : (profileData?.isSocialSignIn ? "Author" : "Author")),
      phoneNumber: profileData?.phoneNumber || null,
      institution: profileData?.institution || null,
      researcherId: profileData?.researcherId || null,
      isAdmin: isCreatorAdminByEmail || false, // Default admin status based on email for creation
    };

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      // console.log(`AuthContext (ensureFirestoreUserProfile): Existing profile found for UID ${firebaseUid}:`, existingData);
      dataToSave = {
        ...existingData, // Preserve existing fields
        ...baseData,     // Override with new/updated base data
        updatedAt: nowServerTimestamp,
      };
      // Preserve existing isAdmin status if user already exists, unless it's a creator admin email and isAdmin isn't already true
      if (existingData.isAdmin === true && !isCreatorAdminByEmail) {
         dataToSave.isAdmin = true;
      } else if (isCreatorAdminByEmail) {
         dataToSave.isAdmin = true; // Ensure creator admin always gets admin
         dataToSave.role = "Admin";
      }
       if (existingData.createdAt && !dataToSave.createdAt) {
        dataToSave.createdAt = existingData.createdAt;
      }
    } else {
      // console.log(`AuthContext (ensureFirestoreUserProfile): No existing profile for UID ${firebaseUid}. Creating new one.`);
      dataToSave = {
        ...baseData,
        createdAt: nowServerTimestamp,
        updatedAt: nowServerTimestamp,
      };
    }
    
    console.log(`AuthContext (ensureFirestoreUserProfile): Data to save for UID ${firebaseUid}:`, dataToSave);
    await setDoc(userDocRef, dataToSave, { merge: true });
    // console.log(`AuthContext (ensureFirestoreUserProfile): Firestore document set/merged for UID ${firebaseUid}.`);
    
    const fetchedProfile = await fetchUserProfileFromFirestore(firebaseUid);
    if (!fetchedProfile) {
        console.error("AuthContext (ensureFirestoreUserProfile): Profile fetched as null immediately after setDoc for UID", firebaseUid);
    } else {
      // console.log(`AuthContext (ensureFirestoreUserProfile): Successfully fetched profile post-save for UID ${firebaseUid}:`, fetchedProfile);
    }
    return fetchedProfile;
  } catch (error: any) {
    console.error(`AuthContext (ensureFirestoreUserProfile): Critical error creating/updating Firestore profile for UID ${firebaseUid}. Error: ${error.message}`, error.code, error);
    toast({ variant: "destructive", title: "Critical Profile Sync Error", description: `Could not save or update your profile in our database. Please try logging out and logging in again. If the problem persists, contact support. Details: ${error.message}`, duration: 15000 });
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
  const searchParamsFromHook = useNextSearchParams(); 

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) {
        // console.warn("AuthContext: Waiting for component to mount before initializing auth state listener.");
        return;
    }
    if (!firebaseAuth || !firestoreDb) {
      // console.warn("AuthContext: Firebase Auth or Firestore DB instance is not available. Client-side features may be limited.");
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext (onAuthStateChanged): Firebase auth state changed. Firebase user:", firebaseUser?.uid || null);
      if (firebaseUser) {
        let appUser = await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, {isSocialSignIn: true});

        if (appUser) {
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          // console.log(`AuthContext (onAuthStateChanged): Raw isAdmin from localProfile for ${firebaseUser.uid}:`, rawIsAdminFromProfile, `(type: ${typeof rawIsAdminFromProfile})`);
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true); // Strict boolean check
          // console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);
          
          appUser.isAdmin = finalIsAdmin;
          // console.log(`AuthContext (onAuthStateChanged): Hydrated appUser for ${firebaseUser.uid}:`, appUser);

          setUser(appUser);
          setIsAdminUser(finalIsAdmin); // Set the specific isAdmin state
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          }

          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          const isCompletingProfilePage = pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true';

          // console.log(`AuthContext (onAuthStateChanged): Profile complete: ${isProfileConsideredComplete}, Completing page: ${isCompletingProfilePage}, Redirect path: ${redirectAfterLoginPath}`);

          if (!isProfileConsideredComplete && !isCompletingProfilePage) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            // console.log("AuthContext (onAuthStateChanged): Redirecting to complete profile.");
            router.push('/profile/settings?complete=true');
          } else {
            if (isProfileConsideredComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
              localStorage.removeItem('completingProfile');
            }

            if (redirectAfterLoginPath) {
              // console.log(`AuthContext (onAuthStateChanged): Redirecting to stored path: ${redirectAfterLoginPath}`);
              router.push(redirectAfterLoginPath);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            } else {
              const onAuthPages = ['/login', '/signup', '/forgot-password'].includes(pathname);
              const comingFromProfileCompletion = pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true';
              const onNonAdminEntryPoint = onAuthPages || pathname === '/' || comingFromProfileCompletion;

              if (appUser.isAdmin) {
                 if (onNonAdminEntryPoint && !pathname.startsWith('/admin/dashboard') && !pathname.startsWith('/admin/')) { // Avoid loop if already on admin dashboard
                   // console.log("AuthContext (onAuthStateChanged): Admin user on non-admin entry point, redirecting to admin dashboard.");
                   router.push('/admin/dashboard');
                 } else if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/dashboard') && onAuthPages) {
                   // If an admin is somehow on an auth page but also an admin page (unlikely), send to admin dash.
                   // console.log("AuthContext (onAuthStateChanged): Admin user on auth page but also an admin page, redirecting to admin dashboard.");
                    router.push('/admin/dashboard');
                 }
                 // else: Admin is already on an admin page or a general page they chose, no redirect.
              } else { 
                if ((onAuthPages || comingFromProfileCompletion) && pathname !== '/') {
                   // console.log("AuthContext (onAuthStateChanged): Non-admin user on auth/profile completion page, redirecting to home.");
                   router.push('/');
                }
                // else: Non-admin is on a content page, no redirect.
              }
            }
          }
        } else {
            console.error("AuthContext (onAuthStateChanged): ensureFirestoreUserProfile failed. Logging out Firebase user.");
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
  }, [isMounted, pathname, router, searchParamsFromHook]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;
    // console.log(`AuthContext (login): Attempting login with identifier: '${identifier}'`);

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
            console.error("AuthContext (login): " + errorMsg);
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          // console.log(`AuthContext (login): No user found with username '${identifier}'.`);
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
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged handles success and setting user state
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
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);
    // console.log("AuthContext (signup): Attempting signup with data:", data);

    // Username and Phone Number uniqueness checks removed from here.
    // Firebase handles email uniqueness. Username/Phone uniqueness will be primarily handled
    // by Firestore rules during profile update or by specific backend logic if needed.

    let firebaseUser: FirebaseUser;
    try {
      // console.log("AuthContext (signup): Calling Firebase createUserWithEmailAndPassword...");
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
      // console.log("AuthContext (signup): Firebase user created:", firebaseUser.uid);
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
        // console.log("AuthContext (signup): Updating Firebase Auth profile display name...");
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        // console.log("AuthContext (signup): Calling ensureFirestoreUserProfile to create Firestore document...");
        await ensureFirestoreUserProfile(firebaseUser.uid, firebaseUser, data);
        // onAuthStateChanged will now pick up the new user and Firestore profile
        toast({ title: "Signup Successful", description: "Welcome to ResearchSphere!" });
      } catch (profileError: any) {
        console.error("AuthContext (signup): Profile setup error after Firebase user creation:", profileError.message, profileError);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
        // Still proceed as user is created in Firebase Auth, onAuthStateChanged will handle next steps
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    // console.log("AuthContext (logout): Attempting logout.");
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      // onAuthStateChanged will clear user state
    } catch (error: any) {
      console.error("AuthContext (logout): Logout failed:", error.message, error);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
      setLoading(false); // Explicitly set loading false here if signout itself errors
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setLoading(false);
    setActiveSocialLoginProvider(null);

    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. If unintentional, please check your browser's popup settings and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000, 
          });
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
    // console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, toastMessage, firebaseError);
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 7000 });
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    // console.log(`AuthContext (processSocialLogin): Attempting ${providerName} login.`);
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged handles success
      toast({ title: `${providerName} Sign-In Successful`, description: "Welcome!" });
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) are handled by onAuthStateChanged or handleSocialLoginError
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    // console.log(`AuthContext (sendPasswordResetEmail): Sending password reset to ${emailAddress}`);
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const isUsernameTakenInFirestore = async (username: string, excludeUserId?: string): Promise<boolean> => {
    if (!firestoreDb) {
      console.error("AuthContext (isUsernameTakenInFirestore): Firestore not available.");
      return false; // Or throw error
    }
    // console.log(`AuthContext (isUsernameTakenInFirestore): Checking username '${username}'`, excludeUserId ? `excluding UID ${excludeUserId}` : '');
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, where("username", "==", username));
    try {
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return false;
      if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
      return true; // Username taken
    } catch (error: any) {
      console.error("AuthContext (isUsernameTakenInFirestore): Error checking username:", error.message, error.code);
      // Consider re-throwing or returning true to be safe, depending on desired behavior
      toast({variant: "destructive", title: "Validation Error", description: "Could not verify username uniqueness. Please try again."});
      return true; // Assume taken to prevent potential issues if check fails
    }
  };

  const isPhoneNumberTakenInFirestore = async (phoneNumber: string, excludeUserId?: string): Promise<boolean> => {
    if (!firestoreDb || !phoneNumber) {
      // console.error("AuthContext (isPhoneNumberTakenInFirestore): Firestore not available or no phone number provided.");
      return false;
    }
    // console.log(`AuthContext (isPhoneNumberTakenInFirestore): Checking phone '${phoneNumber}'`, excludeUserId ? `excluding UID ${excludeUserId}` : '');
    const usersRef = collection(firestoreDb, "users");
    const q = query(usersRef, where("phoneNumber", "==", phoneNumber));
    try {
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return false;
      if (excludeUserId) return querySnapshot.docs.some(doc => doc.id !== excludeUserId);
      return true; // Phone number taken
    } catch (error: any) {
      console.error("AuthContext (isPhoneNumberTakenInFirestore): Error checking phone number:", error.message, error.code);
      toast({variant: "destructive", title: "Validation Error", description: "Could not verify phone number uniqueness. Please try again."});
      return true; // Assume taken
    }
  };


 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      const errorMsg = "User not logged in or database service unavailable. Cannot update profile.";
      console.error("AuthContext (updateUserProfile):", errorMsg);
      toast({ variant: "destructive", title: "Error", description: errorMsg});
      throw new Error(errorMsg);
    }
    // console.log("AuthContext (updateUserProfile): Attempting to update profile for UID", user.id, "with data:", updatedData);
    setLoading(true);

    try {
      // Check username uniqueness if it's being changed
      if (updatedData.username && updatedData.username !== user.username) {
        // console.log(`AuthContext (updateUserProfile): Username changed. Checking uniqueness for '${updatedData.username}'...`);
        if (await isUsernameTakenInFirestore(updatedData.username, user.id)) {
          setLoading(false);
          const errorMsg = "Username already taken. Please choose another one.";
          // console.warn("AuthContext (updateUserProfile): " + errorMsg);
          throw new Error(errorMsg);
        }
      }
      // Check phone number uniqueness if it's being changed
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        // console.log(`AuthContext (updateUserProfile): Phone number changed. Checking uniqueness for '${updatedData.phoneNumber}'...`);
        if (await isPhoneNumberTakenInFirestore(updatedData.phoneNumber, user.id)) {
            setLoading(false);
            const errorMsg = "Phone number already in use. Please use a different one.";
            // console.warn("AuthContext (updateUserProfile): " + errorMsg);
            throw new Error(errorMsg);
        }
      }

      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };
      
      // Ensure 'isAdmin' is not part of the update payload from client
      if ('isAdmin' in updatePayloadFS) {
        delete (updatePayloadFS as any).isAdmin;
      }

      // console.log("AuthContext (updateUserProfile): Preparing to update Firebase Auth display name if changed...");
      if (firebaseAuth.currentUser && updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
          // console.log("AuthContext (updateUserProfile): Updating Firebase Auth display name to:", updatedData.displayName);
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }

      // console.log("AuthContext (updateUserProfile): Updating Firestore document with payload:", updatePayloadFS);
      await updateDoc(userDocRef, updatePayloadFS);
      // console.log("AuthContext (updateUserProfile): Firestore document updated. Fetching latest profile...");
      
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        // console.log("AuthContext (updateUserProfile): Successfully fetched updated profile:", updatedUserFromDb);
        setUser(updatedUserFromDb);
        setIsAdminUser(updatedUserFromDb.isAdmin === true);

        if (typeof window !== 'undefined') {
          const completingProfileFlag = localStorage.getItem('completingProfile') === 'true';
          if (completingProfileFlag) {
            const isProfileNowComplete = updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber;
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
        setLoading(false);
        const errorMsg = "Profile updated in Firestore, but failed to reload latest data into context.";
        console.error("AuthContext (updateUserProfile): " + errorMsg);
        throw new Error(errorMsg);
      }
    } catch(error: any) {
        setLoading(false);
        console.error("AuthContext (updateUserProfile): Error during profile update process:", error.message, error.code || error);
        // Specific errors like "Username already taken" are thrown directly
        // For other errors, re-throw or provide a generic message.
        if (error.message !== "Username already taken. Please choose another one." &&
            error.message !== "Phone number already in use. Please use a different one.") {
             // Generic error already handled by the form
        }
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

