
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'; // Keep for specific alerts
import { Info } from 'lucide-react'; // Keep for specific alerts


const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Used if creating an admin directly in Firebase Auth console
const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com'; // Special email for dynamic admin creation

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
  activeSocialLoginProvider: 'google' | 'github' | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to fetch user profile from Firestore
const fetchUserProfileFromFirestore = async (firebaseUid: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (fetchUserProfileFromFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      // console.log(`AuthContext (fetchUserProfileFromFirestore): User doc found for ${firebaseUid}. Raw Firestore data:`, userSnap.data());
      return userSnap.data() as User;
    } else {
      // console.log(`AuthContext (fetchUserProfileFromFirestore): No user document found in Firestore for UID ${firebaseUid}.`);
      return null;
    }
  } catch (error) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching user profile from Firestore for UID ${firebaseUid}:`, error);
    toast({ variant: "destructive", title: "Profile Load Error", description: "Could not load your profile from the database.", duration: 7000 });
    return null;
  }
};

// Helper to create or update user profile in Firestore
const createOrUpdateUserProfileInFirestore = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  additionalData?: Partial<SignupFormValues> & { isAdminFlag?: boolean }
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (createOrUpdateUserProfileInFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);

  try {
    const userSnap = await getDoc(userDocRef);
    let profileData: User;

    const isNewlyCreatedAdmin = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || (additionalData?.isAdminFlag);
    const isGeneralAdminByEmail = firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      // User document exists, update it
      const existingData = userSnap.data() as User;
      const updatePayload: Partial<User> & { updatedAt: any } = { // Ensure updatedAt is part of the type
        displayName: firebaseUserObject.displayName || additionalData?.fullName || existingData.displayName || "User",
        photoURL: firebaseUserObject.photoURL || existingData.photoURL || null,
        // Only update these if provided in additionalData (e.g., during profile completion after social login)
        ...(additionalData?.username && { username: additionalData.username }),
        ...(additionalData?.role && { role: additionalData.role }),
        ...(additionalData?.phoneNumber && { phoneNumber: additionalData.phoneNumber }),
        ...(additionalData?.institution && { institution: additionalData.institution }),
        ...(additionalData?.researcherId && { researcherId: additionalData.researcherId }),
        // Admin status should ideally be managed by admins, but handle initial creator admin
        isAdmin: existingData.isAdmin || isNewlyCreatedAdmin || isGeneralAdminByEmail || false,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(userDocRef, updatePayload);
      profileData = { ...existingData, ...updatePayload, updatedAt: new Date().toISOString() } as User; // Simulate serverTimestamp for client state
      // console.log(`AuthContext (createOrUpdateUserProfileInFirestore): Updated Firestore profile for ${firebaseUid}:`, profileData);
    } else {
      // User document doesn't exist, create it
      profileData = {
        id: firebaseUid,
        email: firebaseUserObject.email,
        displayName: firebaseUserObject.displayName || additionalData?.fullName || "User",
        photoURL: firebaseUserObject.photoURL || null,
        username: additionalData?.username || null,
        role: additionalData?.role || (isNewlyCreatedAdmin || isGeneralAdminByEmail ? "Admin" : null),
        phoneNumber: additionalData?.phoneNumber || null,
        institution: additionalData?.institution || null,
        researcherId: additionalData?.researcherId || null,
        isAdmin: isNewlyCreatedAdmin || isGeneralAdminByEmail || false,
        createdAt: new Date().toISOString(), // Simulate serverTimestamp for client state
        updatedAt: new Date().toISOString(), // Simulate serverTimestamp for client state
      };
      await setDoc(userDocRef, { ...profileData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      // console.log(`AuthContext (createOrUpdateUserProfileInFirestore): Created Firestore profile for ${firebaseUid}:`, profileData);
    }
    return profileData;
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
    if (!firebaseAuth) {
      console.error("AuthContext: Firebase Auth service is not available. Aborting onAuthStateChanged setup.");
      toast({ variant: "destructive", title: "Authentication Error", description: "Firebase Authentication service failed to initialize. Please refresh." });
      setLoading(false);
      return;
    }
     if (!firestoreDb) {
      console.error("CRITICAL: AuthContext - Firestore DB instance (db) is not available. User profile operations will fail.");
      toast({ variant: "destructive", title: "Database Error", description: "User database service failed to initialize. Profile features may not work.", duration: 10000 });
      // Continue loading if auth is available, but profile features will be broken
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
          // console.log(`AuthContext (onAuthStateChanged): No Firestore profile for ${firebaseUser.uid}, attempting to create one.`);
          appUser = await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser);
        } else {
          // Ensure isAdmin flag from Firestore is definitive, but also check special emails.
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const finalIsAdmin = appUser.isAdmin || isAdminByEmail;
          if (appUser.isAdmin !== finalIsAdmin) { // If there's a mismatch, update Firestore.
            appUser.isAdmin = finalIsAdmin;
            if (firestoreDb) await updateDoc(doc(firestoreDb, "users", firebaseUser.uid), { isAdmin: finalIsAdmin, updatedAt: serverTimestamp() });
          }
          // console.log(`AuthContext (onAuthStateChanged): Hydrated appUser for ${firebaseUser.uid} from Firestore:`, JSON.parse(JSON.stringify(appUser)));
        }


        if (appUser) {
          setUser(appUser);
          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          const profileCompleteParam = typeof window !== 'undefined' ? nextSearchParams.get('complete') : null;

          if (typeof window !== 'undefined') {
            if (!isProfileConsideredComplete && pathname !== '/profile/settings') {
              localStorage.setItem('completingProfile', 'true');
              router.push('/profile/settings?complete=true');
            } else if (isProfileConsideredComplete && localStorage.getItem('completingProfile') === 'true') {
              localStorage.removeItem('completingProfile');
            }

            const redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            if (redirectAfterLoginPath && redirectAfterLoginPath !== pathname) {
              localStorage.removeItem('redirectAfterLogin');
              router.push(redirectAfterLoginPath);
            } else if (isProfileConsideredComplete && (pathname === '/login' || pathname === '/signup' || (pathname === '/profile/settings' && !profileCompleteParam))) {
              router.push('/');
            }
          }
          setShowLoginModal(false);
        } else {
          console.error("AuthContext: Failed to fetch or create user profile in Firestore. Logging out Firebase user.");
          if (firebaseAuth) await signOut(firebaseAuth); // Log out the Firebase user if DB profile fails
          setUser(null);
        }
      } else {
        setUser(null);
         if (typeof window !== 'undefined') {
           localStorage.removeItem('completingProfile'); // Ensure this is cleared on logout
         }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => unsubscribe();
  }, [pathname, router, nextSearchParams]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      // console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email in Firestore...`);
      if (!firestoreDb) {
         setLoading(false);
         const errorMsg = "Database service not available for username lookup.";
         toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
         throw new Error(errorMsg);
      }
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
            // console.log(`AuthContext (login): Found email '${emailToLogin}' for username '${identifier}' from Firestore.`);
          } else {
             setLoading(false);
             const errorMsg = "User profile incomplete (missing email) for this username.";
             toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
             throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = "User not found with this username. Check username or try logging in with email.";
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

    try {
      // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
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
      // console.error("AuthContext (login): Firebase login error:", errorMessage, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Authentication or Database service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // Uniqueness checks for username and phone number against Firestore
    const usersRef = collection(firestoreDb, "users");
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        throw new Error("Username is already taken. Please choose another one.");
      }
    }
    if (data.phoneNumber) {
      const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
      const phoneSnap = await getDocs(qPhone);
      if (!phoneSnap.empty) {
        setLoading(false);
        throw new Error("Phone number is already in use. Please use a different one.");
      }
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
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUser) {
      try {
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        // createOrUpdateUserProfileInFirestore will be called by onAuthStateChanged if profile doesn't exist
        // but we can pass signupData to it via a temporary mechanism or directly call it if needed for immediate effect.
        // For now, rely on onAuthStateChanged to pick it up. We are passing isAdminFlag for the creator email.
        const isAdminByCreatorEmail = firebaseUser.email === ADMIN_CREATOR_EMAIL;
        await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, { ...data, isAdminFlag: isAdminByCreatorEmail });
        // onAuthStateChanged will handle setting user state and redirection
      } catch (profileError: any) {
        // This error is now primarily about Firestore profile creation
        console.error("AuthContext (signup): Error creating Firestore profile:", profileError);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.` });
        // User is still created in Firebase Auth, onAuthStateChanged will attempt to fetch/create profile again.
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // setUser(null) will be handled by onAuthStateChanged
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error: any) {
      console.error("AuthContext (logout): Logout error:", error);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      setLoading(false); // Ensure loading is set to false even if signOut itself doesn't trigger onAuthStateChanged immediately
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
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are enabled and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 8000,
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
    // console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, error);
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
      // onAuthStateChanged will handle fetching/creating Firestore profile and setting user state
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      console.error("AuthContext (updateUserProfile): User not logged in, Firebase currentUser not available, or Firestore DB not available.");
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayload: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };

      // Uniqueness checks for username and phone number against Firestore
      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        if (!usernameSnap.empty && usernameSnap.docs[0].id !== user.id) {
          setLoading(false);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty && phoneSnap.docs[0].id !== user.id) {
          setLoading(false);
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }

      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        updatePayload.displayName = updatedData.displayName; // Ensure it's in Firestore payload too
      }
      // Do not allow 'isAdmin' to be changed by this function. It's managed by admins or special signup.
      if ('isAdmin' in updatePayload) delete (updatePayload as any).isAdmin;


      await updateDoc(userDocRef, updatePayload);

      const updatedUserSnapshot = await getDoc(userDocRef); // Re-fetch to get server-generated timestamps
      const updatedUserFromDb = updatedUserSnapshot.data() as User;

      setUser(updatedUserFromDb); // Update context state

      if (typeof window !== 'undefined' && (localStorage.getItem('completingProfile') === 'true' || nextSearchParams.get('complete') === 'true')) {
          if (updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber) {
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
      return updatedUserFromDb;
    } catch(error: any) {
      console.error("AuthContext (updateUserProfile): Error during profile update:", error);
      throw error; // Re-throw for the form to catch
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
