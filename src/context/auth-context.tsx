
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import {
  auth as firebaseAuth,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider,
  db as firestoreDb // Import Firestore instance
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
  Timestamp
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

// Mock admin emails for dynamic admin creation or direct login
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
  activeSocialLoginProvider: 'google' | 'github' | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to fetch user profile from Firestore
const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (fetchUserProfileFromFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    // console.log(`AuthContext (fetchUserProfileFromFirestore): Fetching Firestore profile for UID ${uid}.`);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      // console.log(`AuthContext (fetchUserProfileFromFirestore): Raw isAdmin from Firestore for ${uid}:`, firestoreIsAdmin, `(type: ${typeof firestoreIsAdmin})`);
      const determinedIsAdmin = firestoreIsAdmin === true;

      const userProfile: User = {
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
      // console.log(`AuthContext (fetchUserProfileFromFirestore): User doc found for ${uid}. Hydrated profile:`, JSON.parse(JSON.stringify(userProfile)));
      return userProfile;
    } else {
      // console.warn(`AuthContext (fetchUserProfileFromFirestore): No user document found in Firestore for UID ${uid}.`);
      return null;
    }
  } catch (error) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching user profile from Firestore for UID ${uid}:`, error);
    toast({ variant: "destructive", title: "Profile Load Error", description: "Could not load your profile from the database.", duration: 7000 });
    return null;
  }
};

// Helper to create or update user profile in Firestore
const createOrUpdateUserProfileInFirestore = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  additionalData?: Partial<SignupFormValues> & { isSocialSignIn?: boolean }
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (createOrUpdateUserProfileInFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);

  try {
    const userSnap = await getDoc(userDocRef);
    let profileDataToSave: Partial<User> & { updatedAt: any; createdAt?: any };

    const isNewlyCreatedAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      profileDataToSave = {
        displayName: firebaseUserObject.displayName || additionalData?.fullName || existingData.displayName || "User",
        photoURL: firebaseUserObject.photoURL || existingData.photoURL || null,
        email: firebaseUserObject.email, // Keep email in sync with Firebase Auth
        // Only update these if provided, crucial for profile completion flow
        ...(additionalData?.username && { username: additionalData.username }),
        ...(additionalData?.role && { role: additionalData.role }),
        ...(additionalData?.phoneNumber && { phoneNumber: additionalData.phoneNumber }),
        ...(additionalData?.institution && { institution: additionalData.institution }),
        ...(additionalData?.researcherId && { researcherId: additionalData.researcherId }),
        // Preserve existing isAdmin unless it's the creator email and profile is new-ish (or being fixed)
        isAdmin: existingData.isAdmin || isNewlyCreatedAdminByEmail || false,
        updatedAt: serverTimestamp(),
      };
      // console.log(`AuthContext (createOrUpdateUserProfileInFirestore): Updating existing Firestore profile for ${firebaseUid}. Payload:`, profileDataToSave);
      await updateDoc(userDocRef, profileDataToSave);
    } else {
      // New user document
      profileDataToSave = {
        id: firebaseUid,
        email: firebaseUserObject.email,
        displayName: firebaseUserObject.displayName || additionalData?.fullName || (additionalData?.isSocialSignIn ? firebaseUserObject.email?.split('@')[0] : "User"),
        photoURL: firebaseUserObject.photoURL || null,
        username: additionalData?.username || null,
        role: additionalData?.role || (isNewlyCreatedAdminByEmail ? "Admin" : null),
        phoneNumber: additionalData?.phoneNumber || null,
        institution: additionalData?.institution || null,
        researcherId: additionalData?.researcherId || null,
        isAdmin: isNewlyCreatedAdminByEmail || false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      // console.log(`AuthContext (createOrUpdateUserProfileInFirestore): Creating new Firestore profile for ${firebaseUid}. Payload:`, profileDataToSave);
      await setDoc(userDocRef, profileDataToSave);
    }
    
    // Fetch the just-written document to get consistent data including server timestamps
    const savedSnap = await getDoc(userDocRef);
    if (savedSnap.exists()) {
      return fetchUserProfileFromFirestore(firebaseUid); // Use the main fetcher to ensure consistent conversion
    }
    return null;

  } catch (error) {
    console.error(`AuthContext (createOrUpdateUserProfileInFirestore): Error creating/updating Firestore profile for ${firebaseUid}:`, error);
    toast({ variant: "destructive", title: "Profile Sync Error", description: "Could not save your profile to the database.", duration: 7000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);

  const router = useRouter();
  const pathname = usePathname();
  const nextSearchParams = useNextSearchParams();

  useEffect(() => {
    // console.log("AuthContext: useEffect for onAuthStateChanged running.");
    if (!firebaseAuth) {
      console.error("AuthContext: Firebase Auth service is not available.");
      toast({ variant: "destructive", title: "Authentication Error", description: "Firebase Authentication service failed to initialize. Please refresh." });
      setLoading(false);
      return;
    }
     if (!firestoreDb) {
      console.error("CRITICAL: AuthContext - Firestore DB instance (db) is not available. User profile operations will fail.");
      toast({ variant: "destructive", title: "Database Error", description: "User database service failed to initialize. Profile features may not work.", duration: 10000 });
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
        toast({
            variant: "destructive",
            title: "Network Error",
            description: "You appear to be offline. Some features may not be available.",
            duration: 7000
        });
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext (onAuthStateChanged): Firebase auth state changed. Firebase user UID:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        let appUser = await fetchUserProfileFromFirestore(firebaseUser.uid);

        if (!appUser) {
          // If no profile in Firestore, create one (e.g., for social login first-timers or if DB was wiped)
          // This also handles the case for direct Firebase Auth signups if profile creation failed initially.
          // console.log(`AuthContext (onAuthStateChanged): No Firestore profile for ${firebaseUser.uid}, attempting to create one.`);
          appUser = await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, { isSocialSignIn: firebaseUser.providerData.some(p => p.providerId !== 'password') });
        } else {
          // Ensure isAdmin flag from Firestore is primary, but also check special emails for safety (e.g., if admin manually created in Auth but not Firestore yet)
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          // console.log(`AuthContext (onAuthStateChanged): Raw isAdmin from localProfile for ${firebaseUser.uid}:`, rawIsAdminFromProfile, `(type: ${typeof rawIsAdminFromProfile})`);
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);
          // console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);
          
          if (appUser.isAdmin !== finalIsAdmin) {
            // console.log(`AuthContext (onAuthStateChanged): isAdmin mismatch for ${firebaseUser.uid}. Firestore: ${appUser.isAdmin}, Calculated: ${finalIsAdmin}. Updating Firestore.`);
            appUser.isAdmin = finalIsAdmin; // Update local appUser immediately
            if (firestoreDb) {
              try {
                await updateDoc(doc(firestoreDb, "users", firebaseUser.uid), { isAdmin: finalIsAdmin, updatedAt: serverTimestamp() });
              } catch (updateError) {
                console.error(`AuthContext (onAuthStateChanged): Failed to update isAdmin flag in Firestore for ${firebaseUser.uid}:`, updateError);
              }
            }
          }
        }
        
        // console.log(`AuthContext (onAuthStateChanged): Hydrated appUser for ${firebaseUser.uid}:`, JSON.parse(JSON.stringify(appUser)));

        if (appUser) {
          setUser(appUser);
          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          
          if (typeof window !== 'undefined') {
            const profileCompleteParam = nextSearchParams.get('complete');
            const isCompletingProfileFlag = localStorage.getItem('completingProfile') === 'true';

            if (!isProfileConsideredComplete && pathname !== '/profile/settings') {
              // console.log(`AuthContext (onAuthStateChanged): Profile incomplete for ${appUser.id}. Redirecting to /profile/settings?complete=true`);
              localStorage.setItem('completingProfile', 'true');
              router.push('/profile/settings?complete=true');
            } else if (isProfileConsideredComplete && isCompletingProfileFlag) {
              // console.log(`AuthContext (onAuthStateChanged): Profile now complete for ${appUser.id}. Removing flag.`);
              localStorage.removeItem('completingProfile');
            }

            const redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            if (redirectAfterLoginPath && redirectAfterLoginPath !== pathname && redirectAfterLoginPath !== '/profile/settings') {
              // console.log(`AuthContext (onAuthStateChanged): Found redirectAfterLogin: ${redirectAfterLoginPath}. Redirecting.`);
              localStorage.removeItem('redirectAfterLogin');
              router.push(redirectAfterLoginPath);
            } else if (isProfileConsideredComplete && (pathname === '/login' || pathname === '/signup' || (pathname === '/profile/settings' && !profileCompleteParam))) {
              // console.log(`AuthContext (onAuthStateChanged): User logged in and profile complete. Current path ${pathname} is auth page or non-complete profile settings. Redirecting to home.`);
              router.push('/');
            }
          }
          setShowLoginModal(false);
        } else {
          console.error("AuthContext (onAuthStateChanged): Failed to fetch or create user profile in Firestore. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
        }
      } else {
        // console.log("AuthContext (onAuthStateChanged): No Firebase user found (logged out).");
        setUser(null);
         if (typeof window !== 'undefined') {
           localStorage.removeItem('completingProfile'); 
           // Optionally, do not clear redirectAfterLogin if you want them to land there after next login
         }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => unsubscribe();
  }, [pathname, router, nextSearchParams]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    if (!firestoreDb) throw new Error("Database service not available for login.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    // console.log(`AuthContext (login): Attempting login with identifier: '${identifier}'`);

    if (!identifier.includes('@')) {
      // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      // console.log(`AuthContext (login): Firestore query for username '${identifier}':`, q);
      try {
        const querySnapshot = await getDocs(q);
        // console.log(`AuthContext (login): Username query snapshot empty: ${querySnapshot.empty}`);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          // console.log(`AuthContext (login): Found user doc for username '${identifier}'. Data:`, userDoc);
          if (userDoc.email) {
            emailToLogin = userDoc.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}' from Firestore.`);
          } else {
             setLoading(false);
             const errorMsg = `User profile incomplete (missing email) for username '${identifier}'.`;
             // console.warn(`AuthContext (login): ${errorMsg}`);
             toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
             throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = `User not found with username '${identifier}'. Check username or try logging in with email.`;
          // console.warn(`AuthContext (login): ${errorMsg}`);
          toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
          throw new Error(errorMsg);
        }
      } catch (dbError) {
        setLoading(false);
        console.error("AuthContext (login): Error querying Firestore for username:", dbError);
        const errorMsg = "Error during username lookup. Please try again or use email.";
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    
    console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setUser and redirects
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
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Authentication or Database service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // console.log("AuthContext (signup): Starting signup process. Data:", data);

    // Uniqueness checks for username and phone number against Firestore
    const usersRef = collection(firestoreDb, "users");
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        const errorMsg = "Username is already taken. Please choose another one.";
        // console.warn(`AuthContext (signup): ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }
    if (data.phoneNumber) {
      const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
      const phoneSnap = await getDocs(qPhone);
      if (!phoneSnap.empty) {
        setLoading(false);
        const errorMsg = "Phone number is already in use. Please use a different one.";
        // console.warn(`AuthContext (signup): ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    let firebaseUser: FirebaseUser;
    try {
      // console.log("AuthContext (signup): Calling Firebase createUserWithEmailAndPassword for email:", data.email);
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
      // console.log("AuthContext (signup): Firebase user created successfully. UID:", firebaseUser.uid);
    } catch (authError: any) {
      setLoading(false);
      setActiveSocialLoginProvider(null);
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = authError.message || errorMessage;
      }
      // console.error("AuthContext (signup): Firebase user creation error:", errorMessage, authError);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUser) {
      try {
        // console.log("AuthContext (signup): Attempting to update Firebase profile displayName for UID:", firebaseUser.uid, "to:", data.fullName);
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        // console.log("AuthContext (signup): Firebase profile displayName updated.");
        // console.log("AuthContext (signup): Attempting to create Firestore profile for UID:", firebaseUser.uid);
        await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, data);
        // console.log("AuthContext (signup): Firestore profile creation/update successful for UID:", firebaseUser.uid);
        // onAuthStateChanged will handle setting user state and redirection
      } catch (profileError: any) {
        setLoading(false); // Ensure loading is stopped if profile sync fails
        console.error("AuthContext (signup): Error creating/updating Firestore profile after Firebase user creation:", profileError);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
        // User is still created in Firebase Auth, onAuthStateChanged will attempt to fetch/create profile again.
        // We don't throw here, to allow onAuthStateChanged to proceed.
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    // console.log("AuthContext (logout): Attempting logout.");
    try {
      await signOut(firebaseAuth);
      // setUser(null) will be handled by onAuthStateChanged
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      // console.log("AuthContext (logout): Logout successful.");
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error: any) {
      console.error("AuthContext (logout): Logout error:", error);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      // setLoading(false) will be handled by onAuthStateChanged
    }
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
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are enabled if you have a blocker, and try again. If the issue persists, your browser might be closing it too quickly.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000, 
          });
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Try that method or use a different email.";
          toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
          break;
        default:
          toastMessage = firebaseError.message || toastMessage;
          toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
      }
    } else {
        toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    }
    console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, error);
    // setLoading(false) and setActiveSocialLoginProvider(null) will be handled by onAuthStateChanged
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
      // console.log(`AuthContext (processSocialLogin - ${providerName}): signInWithPopup successful. Waiting for onAuthStateChanged.`);
      // onAuthStateChanged will handle fetching/creating Firestore profile and setting user state
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    // console.log(`AuthContext (sendPasswordResetEmail): Sending password reset to ${emailAddress}`);
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      console.error("AuthContext (updateUserProfile): User not logged in, Firebase currentUser not available, or Firestore DB not available.");
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);
    // console.log("AuthContext (updateUserProfile): Attempting to update profile for UID:", user.id, "Data:", updatedData);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayload: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };

      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username !== user.username) {
        // console.log("AuthContext (updateUserProfile): Checking username uniqueness for:", updatedData.username);
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        const conflictingUser = usernameSnap.docs.find(doc => doc.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          // console.warn("AuthContext (updateUserProfile): Username already taken.");
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        // console.log("AuthContext (updateUserProfile): Checking phone number uniqueness for:", updatedData.phoneNumber);
        if(updatedData.phoneNumber.trim() !== "") { // Only check if phone number is not empty
            const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
            const phoneSnap = await getDocs(qPhone);
            const conflictingUser = phoneSnap.docs.find(doc => doc.id !== user.id);
            if (conflictingUser) {
                setLoading(false);
                // console.warn("AuthContext (updateUserProfile): Phone number already in use.");
                throw new Error("Phone number already in use. Please use a different one.");
            }
        }
      }

      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        // console.log("AuthContext (updateUserProfile): Updating Firebase Auth displayName to:", updatedData.displayName);
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      
      // Remove isAdmin from client-side update payload to prevent self-escalation
      if ('isAdmin' in updatePayload) {
        // console.log("AuthContext (updateUserProfile): Attempt to update isAdmin found, removing from payload.");
        delete (updatePayload as any).isAdmin;
      }
      
      // console.log("AuthContext (updateUserProfile): Updating Firestore document with payload:", updatePayload);
      await updateDoc(userDocRef, updatePayload);

      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id); // Re-fetch to get server-generated timestamps and ensure consistency

      if (updatedUserFromDb) {
        // console.log("AuthContext (updateUserProfile): Profile update successful. New user state:", updatedUserFromDb);
        setUser(updatedUserFromDb); // Update context state
        
        // Check for profile completion after update
        if (typeof window !== 'undefined') {
          const isCompletingProfileFlag = localStorage.getItem('completingProfile') === 'true' || nextSearchParams.get('complete') === 'true';
          if (isCompletingProfileFlag) {
            const isProfileNowComplete = updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber;
            if (isProfileNowComplete) {
              // console.log("AuthContext (updateUserProfile): Profile now complete after update. Removing flag and redirecting if necessary.");
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname !== '/') {
                  router.push('/');
              }
            }
          }
        }
        return updatedUserFromDb;
      } else {
        // console.error("AuthContext (updateUserProfile): Failed to re-fetch profile from Firestore after update.");
        throw new Error("Profile updated, but failed to reload latest data.");
      }

    } catch(error: any) {
      console.error("AuthContext (updateUserProfile): Error during profile update:", error);
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error; 
    } finally {
        setLoading(false);
    }
  };

  const isAdmin = user?.isAdmin === true;

  return (
    <AuthContext.Provider value={{
        user, loading, login, signup, logout,
        loginWithGoogle, loginWithGitHub,
        sendPasswordResetEmail, updateUserProfile,
        showLoginModal, setShowLoginModal, isAdmin,
        isSocialLoginInProgress: activeSocialLoginProvider !== null,
        activeSocialLoginProvider,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

