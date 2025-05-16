
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
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to fetch user profile from Firestore
const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) {
    // console.warn("AuthContext (fetchUserProfileFromFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      // console.log(`AuthContext (fetchUserProfileFromFirestore): Raw isAdmin from Firestore for ${uid}:`, firestoreIsAdmin, `(type: ${typeof firestoreIsAdmin})`);
      const determinedIsAdmin = firestoreIsAdmin === true;

      return {
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
    } else {
      // console.warn(`AuthContext (fetchUserProfileFromFirestore): No user document found for UID ${uid}. This is normal for a new user.`);
      return null;
    }
  } catch (error: any) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching profile for UID ${uid}:`, error);
    toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};

// Helper to create or update user profile in Firestore
const createOrUpdateUserProfileInFirestore = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileData?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    // console.warn("AuthContext (createOrUpdateUserProfileInFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  try {
    const userSnap = await getDoc(userDocRef);
    const nowServerTimestamp = serverTimestamp();
    const isCreatorAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    let baseData: Partial<User> = {
      id: firebaseUid,
      email: firebaseUserObject.email,
      displayName: profileData?.fullName || firebaseUserObject.displayName || (profileData?.isSocialSignIn && firebaseUserObject.email ? firebaseUserObject.email.split('@')[0] : null) || "User",
      photoURL: firebaseUserObject.photoURL || null,
      username: profileData?.username || null,
      role: profileData?.role || (isCreatorAdminByEmail ? "Admin" : (profileData?.isSocialSignIn ? "Author" : "Author")), // Default to Author
      phoneNumber: profileData?.phoneNumber || null,
      institution: profileData?.institution || null,
      researcherId: profileData?.researcherId || null,
      isAdmin: isCreatorAdminByEmail || false,
    };

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string; };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData,
        ...baseData,
        updatedAt: nowServerTimestamp,
      };
      if (existingData.isAdmin === true && !isCreatorAdminByEmail) {
        dataToSave.isAdmin = true;
      }
      if (existingData.createdAt && !dataToSave.createdAt) {
        dataToSave.createdAt = existingData.createdAt;
      }
    } else {
      dataToSave = {
        userId: firebaseUid, // Ensure userId field is present for new docs
        ...baseData,
        createdAt: nowServerTimestamp,
        updatedAt: nowServerTimestamp,
      };
    }
    await setDoc(userDocRef, dataToSave, { merge: true });
    return fetchUserProfileFromFirestore(firebaseUid);
  } catch (error: any) {
    console.error(`AuthContext (createOrUpdateUserProfileInFirestore): Error for UID ${firebaseUid}:`, error);
    toast({ variant: "destructive", title: "Profile Sync Error", description: `Could not save your profile to Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const isSocialLoginInProgress = activeSocialLoginProvider !== null;

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  useEffect(() => {
    // This effect runs when Firebase Auth state might change or when navigating client-side
    if (typeof window === 'undefined' || !firebaseAuth) {
      setLoading(false);
      return;
    }
    if (!firestoreDb) {
      // console.warn("AuthContext: Firestore DB instance is not available in useEffect. Client-side features relying on Firestore for user profiles may be limited.");
      // setLoading(false); // still set loading false so app doesn't hang
      // return;
    }

    // console.log("AuthContext: Running onAuthStateChanged useEffect. Pathname:", pathname);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext: onAuthStateChanged triggered. FirebaseUser:", firebaseUser ? firebaseUser.uid : null);
      if (firebaseUser) {
        let appUser = await fetchUserProfileFromFirestore(firebaseUser.uid);

        if (!appUser) { // User authenticated with Firebase but no Firestore profile yet
          // console.log(`AuthContext: No Firestore profile for ${firebaseUser.uid}, creating one.`);
          appUser = await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });
        } else {
          // Profile exists, ensure isAdmin logic is correct
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);

          if (appUser.isAdmin !== finalIsAdmin) {
            // console.log(`AuthContext: Correcting isAdmin for ${firebaseUser.uid}. Was: ${appUser.isAdmin}, Now: ${finalIsAdmin}`);
            appUser.isAdmin = finalIsAdmin; // Correct the local appUser object
          }
        }

        if (appUser) {
          // console.log("AuthContext: Hydrated appUser:", appUser);
          setUser(appUser);
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          let completingProfileFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileFlag = localStorage.getItem('completingProfile');
          }
          
          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          const isCompletingProfilePage = pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true';

          if (!isProfileConsideredComplete && !isCompletingProfilePage) {
            // console.log("AuthContext: Profile incomplete, redirecting to settings.");
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else {
            if (isProfileConsideredComplete && typeof window !== 'undefined' && completingProfileFlag === 'true') {
              localStorage.removeItem('completingProfile');
            }

            // console.log(`AuthContext (Redirection Logic): Pathname: ${pathname}, redirectAfterLoginPath: ${redirectAfterLoginPath}, isAdmin: ${appUser.isAdmin}`);

            if (redirectAfterLoginPath) {
              // console.log(`AuthContext: redirectAfterLoginPath found: ${redirectAfterLoginPath}. Redirecting.`);
              router.push(redirectAfterLoginPath);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            } else if (appUser.isAdmin) {
              const onNonAdminEntryPoint = ['/login', '/signup', '/', '/profile/settings'].includes(pathname) || (pathname === '/profile/settings' && isCompletingProfilePage);
              const isAlreadyOnAdminDashboard = pathname === '/admin/dashboard';
              const isCurrentlyOnAnyAdminPage = pathname.startsWith('/admin/');

              // console.log(`AuthContext (Admin Redirection): onNonAdminEntryPoint: ${onNonAdminEntryPoint}, isAlreadyOnAdminDashboard: ${isAlreadyOnAdminDashboard}, isCurrentlyOnAnyAdminPage: ${isCurrentlyOnAnyAdminPage}`);

              if (onNonAdminEntryPoint && !isAlreadyOnAdminDashboard) {
                // Admin logged in from a non-admin page or just completed profile
                // console.log("AuthContext: Admin on non-admin entry or finished profile, redirecting to /admin/dashboard.");
                router.push('/admin/dashboard');
              } else if (!isCurrentlyOnAnyAdminPage && !onNonAdminEntryPoint) {
                // Admin is logged in, not on an admin page, and not on an entry point (e.g., manually typed a non-admin URL)
                // console.log("AuthContext: Admin on a general non-admin page, redirecting to /admin/dashboard.");
                router.push('/admin/dashboard');
              }
              // If isCurrentlyOnAnyAdminPage is true, AND onNonAdminEntryPoint is false, AND redirectAfterLoginPath is null, then DO NOTHING.
              // This means the admin is navigating within admin pages.
            } else { // Not an admin
              const onAuthPage = pathname === '/login' || pathname === '/signup';
              if ((onAuthPage || (pathname === '/profile/settings' && isCompletingProfilePage)) && pathname !== '/') {
                // console.log("AuthContext: Non-admin finished auth/profile, redirecting to /.");
                router.push('/');
              }
            }
          }
        } else {
          // console.error("AuthContext: Failed to fetch or create user profile in Firestore after Firebase auth. Logging out.");
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
        }
      } else { // firebaseUser is null
        // console.log("AuthContext: No Firebase user. Setting appUser to null.");
        setUser(null);
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
  }, [pathname, router, searchParamsFromHook]);


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
            // console.error("AuthContext (login):", errorMsg);
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = `User not found with username '${identifier}'.`;
          // console.warn("AuthContext (login):", errorMsg);
          toast({ variant: "destructive", title: "Login Failed", description: "Invalid email/username or password." });
          throw new Error("Invalid email/username or password.");
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        // console.error("AuthContext (login):", errorMsg, dbError);
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and redirecting
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

    const usersRef = collection(firestoreDb, "users");
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        const errorMsg = "Username is already taken. Please choose another one.";
        toast({ variant: "destructive", title: "Signup Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
     if (data.phoneNumber) { // Check only if phone number is provided
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            const errorMsg = "Phone number already in use. Please use a different one.";
            toast({ variant: "destructive", title: "Signup Failed", description: errorMsg });
            throw new Error(errorMsg);
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
        await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, data);
        // onAuthStateChanged will pick up the new user from Firebase Auth
        // and then fetch/confirm the Firestore profile, then redirect.
      } catch (profileError: any) {
        // console.error("AuthContext (signup): Error setting up Firestore profile or Firebase profile display name:", profileError);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
        // Still let onAuthStateChanged handle the user state
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will handle setting user to null and redirecting
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      setLoading(false);
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
          toastMessage = `The ${providerName} sign-in popup was closed before completing. Please ensure popups are allowed and try again. If the issue persists, your browser might be blocking them or there could be a network interruption.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000, 
          });
          return;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method.";
          break;
        case 'auth/operation-not-allowed':
            toastTitle = "Sign-In Method Disabled";
            toastMessage = `${providerName} sign-in is not enabled for this app.`;
            break;
        case 'auth/popup-blocked':
            toastTitle = "Popup Blocked";
            toastMessage = `Your browser blocked the ${providerName} sign-in popup. Please allow popups for this site.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      const result = await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle creating/fetching Firestore profile for result.user
      // and then redirecting appropriately.
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setActiveSocialLoginProvider(null) is now handled in the main onAuthStateChanged finally block
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      toast({ variant: "destructive", title: "Error", description: "User not logged in or database service unavailable."});
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const usersRef = collection(firestoreDb, "users");

      // Username Uniqueness Check
      if (updatedData.username && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        const conflictingUser = usernameSnap.docs.find(docSnap => docSnap.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Phone Number Uniqueness Check (only if provided and changed)
      if (updatedData.phoneNumber && updatedData.phoneNumber.trim() !== "" && updatedData.phoneNumber !== user.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        const conflictingUser = phoneSnap.docs.find(docSnap => docSnap.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }


      const updatePayloadFS: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };
      delete (updatePayloadFS as any).isAdmin;

      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      if (updatedData.photoURL !== undefined && updatedData.photoURL !== firebaseAuth.currentUser.photoURL) {
         await updateFirebaseProfile(firebaseAuth.currentUser, { photoURL: updatedData.photoURL });
      }

      await updateDoc(userDocRef, updatePayloadFS);
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb);
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
        return updatedUserFromDb;
      } else {
        throw new Error("Profile updated in Firestore, but failed to reload latest data into context.");
      }
    } catch(error: any) {
      // console.error("AuthContext (updateUserProfile): Error updating profile:", error);
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
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
        isSocialLoginInProgress,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
