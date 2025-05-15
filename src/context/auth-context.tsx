
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import {
  auth as firebaseAuth,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider,
  db as firestoreDb // Renamed to avoid confusion with local 'db' variables
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


// Mock admin email for initial admin setup during testing
const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Can be changed or removed for production
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
  activeSocialLoginProvider: 'google' | 'github' | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);


const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (fetchUserProfileFromFirestore): Firestore DB instance is not available.");
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
      return userProfile;
    } else {
      // console.warn(`AuthContext (fetchUserProfileFromFirestore): No Firestore profile found for UID ${uid}.`);
      return null;
    }
  } catch (error) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching Firestore profile for UID ${uid}:`, error);
    toast({ variant: "destructive", title: "Profile Load Error", description: "Could not load your profile from the database.", duration: 7000 });
    return null;
  }
};

const createOrUpdateUserProfileInFirestore = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser, // For email, displayName, photoURL fallbacks
  profileData?: Partial<SignupFormValues & {isSocialSignIn?: boolean}>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (createOrUpdateUserProfileInFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  try {
    const userSnap = await getDoc(userDocRef);
    const now = serverTimestamp();
    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any; id?: string };

    const isCreatorAdmin = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    const baseData: Partial<User> = {
      userId: firebaseUid, // Ensure userId is explicitly set
      email: firebaseUserObject.email,
      displayName: profileData?.fullName || firebaseUserObject.displayName || (profileData?.isSocialSignIn ? firebaseUserObject.email?.split('@')[0] : "User") || "User",
      photoURL: firebaseUserObject.photoURL || null,
      username: profileData?.username || null,
      role: profileData?.role || (isCreatorAdmin ? "Admin" : null), // Default role for admin creator
      phoneNumber: profileData?.phoneNumber || null,
      institution: profileData?.institution || null,
      researcherId: profileData?.researcherId || null,
      isAdmin: isCreatorAdmin || false, // Default isAdmin for creator or normal user
    };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData, // Preserve existing fields
        ...baseData,     // Apply new/updated base data
        updatedAt: now,
      };
      // Ensure isAdmin isn't accidentally reverted if already true, unless it's the creator admin email initially setting it
      if (existingData.isAdmin === true && !isCreatorAdmin) {
        dataToSave.isAdmin = true;
      }
      // console.log("AuthContext (createOrUpdateUserProfileInFirestore): Updating existing Firestore profile for", firebaseUid);
      await updateDoc(userDocRef, dataToSave);
    } else {
      dataToSave = {
        id: firebaseUid, // Set the ID for new documents
        ...baseData,
        createdAt: now,
        updatedAt: now,
      };
      // console.log("AuthContext (createOrUpdateUserProfileInFirestore): Creating new Firestore profile for", firebaseUid);
      await setDoc(userDocRef, dataToSave);
    }
    return fetchUserProfileFromFirestore(firebaseUid);
  } catch (error) {
    console.error(`AuthContext (createOrUpdateUserProfileInFirestore): Error for ${firebaseUid}:`, error);
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
      toast({ variant: "destructive", title: "Authentication Error", description: "Firebase Authentication service failed to initialize. Please refresh." });
      setLoading(false);
      return;
    }
    if (!firestoreDb) {
      toast({ variant: "destructive", title: "Database Error", description: "Firestore service failed to initialize. Profile features may not work correctly.", duration: 10000 });
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
        toast({
            variant: "destructive",
            title: "Network Error",
            description: "You appear to be offline. Some features may not be available.",
            duration: 7000
        });
    }
    // console.log("AuthContext: Main useEffect triggered. Pathname:", pathname);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      // console.log("AuthContext onAuthStateChanged: Firebase user:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        let appUser = await fetchUserProfileFromFirestore(firebaseUser.uid);

        if (!appUser) {
          // console.log(`AuthContext onAuthStateChanged: No existing Firestore profile for ${firebaseUser.uid}, attempting to create one.`);
          appUser = await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });
        } else {
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          // console.log(`AuthContext (onAuthStateChanged): Raw isAdmin from Firestore profile for ${firebaseUser.uid}:`, rawIsAdminFromProfile, `(type: ${typeof rawIsAdminFromProfile})`);
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);
          // console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);
          if (appUser.isAdmin !== finalIsAdmin) {
            // console.log(`AuthContext onAuthStateChanged: Admin status mismatch for ${firebaseUser.uid}. Firestore: ${appUser.isAdmin}, Determined: ${finalIsAdmin}. Updating appUser state.`);
            appUser.isAdmin = finalIsAdmin;
          }
        }
        
        // console.log("AuthContext onAuthStateChanged: Hydrated appUser:", appUser);

        if (appUser) {
          setUser(appUser);
          setShowLoginModal(false); // Close modal if it was open

          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          let redirectPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectPath = localStorage.getItem('redirectAfterLogin');
          }
          const isAuthPage = pathname === '/login' || pathname === '/signup';
          const isCompletingProfilePage = pathname === '/profile/settings' && nextSearchParams.get('complete') === 'true';

          // console.log(`AuthContext onAuthStateChanged: Redirection checks for ${appUser.email}. Path: ${pathname}, RedirectPath: ${redirectPath}, isAdmin: ${appUser.isAdmin}, ProfileComplete: ${isProfileConsideredComplete}, IsAuthPage: ${isAuthPage}, IsCompletingProfile: ${isCompletingProfilePage}`);
          
          if (!isProfileConsideredComplete && pathname !== '/profile/settings') {
            // console.log(`AuthContext onAuthStateChanged: Profile incomplete. Redirecting to /profile/settings?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else {
            if (isProfileConsideredComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
              localStorage.removeItem('completingProfile');
            }

            if (redirectPath) {
                // console.log(`AuthContext onAuthStateChanged: Found redirectAfterLogin path: '${redirectPath}'. Redirecting.`);
                router.push(redirectPath);
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            } else if (appUser.isAdmin) {
                if ((isAuthPage || isCompletingProfilePage || pathname === '/') && !pathname.startsWith('/admin/')) {
                    // console.log(`AuthContext onAuthStateChanged: Admin logged in from non-admin context ('${pathname}'). Redirecting to /admin/dashboard.`);
                    router.push('/admin/dashboard');
                } else {
                    // console.log(`AuthContext onAuthStateChanged: Admin already in admin area or no specific redirect needed. Path: '${pathname}'.`);
                }
            } else { // Not an admin
                if ((isAuthPage || isCompletingProfilePage) && pathname !== '/') {
                    // console.log(`AuthContext onAuthStateChanged: Non-admin on auth/profile completion page ('${pathname}'). Redirecting to /.`);
                    router.push('/');
                } else {
                    // console.log(`AuthContext onAuthStateChanged: Non-admin, no specific redirect. Path: '${pathname}'.`);
                }
            }
          }
        } else {
          console.error("AuthContext onAuthStateChanged: Failed to fetch or create Firestore profile for authenticated Firebase user. Logging out.");
          if (firebaseAuth) await signOut(firebaseAuth); // Ensure firebaseAuth is not null
          setUser(null);
        }
      } else { // No firebaseUser
        setUser(null);
        if (typeof window !== 'undefined') {
           localStorage.removeItem('completingProfile');
           localStorage.removeItem('redirectAfterLogin');
        }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null); // Reset social login provider state
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router, nextSearchParams]); // Added nextSearchParams


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Authentication or Database service not available.");
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
             const errorMsg = `User profile incomplete (missing email) for username '${identifier}'.`;
             console.error("AuthContext (login): " + errorMsg);
             toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
             throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = `User not found with username '${identifier}'. Check username or try logging in with email.`;
          // console.warn("AuthContext (login): " + errorMsg);
          toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
          throw new Error(errorMsg);
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}. Please try again or use email.`;
        console.error("AuthContext (login): " + errorMsg, dbError);
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    // console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
    
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      toast({ title: "Login Successful", description: "Welcome back!" });
      // onAuthStateChanged handles setUser and redirects
    } catch (error) {
      setLoading(false); // Ensure loading is false on error
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
    // setLoading(false) will be handled by onAuthStateChanged
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Authentication or Database service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    // console.log("AuthContext (signup): Attempting signup with data:", { ...data, password: "REDACTED" });

    const usersRef = collection(firestoreDb, "users");
    // Check username uniqueness
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        const errorMsg = "Username is already taken. Please choose another one.";
        // console.warn("AuthContext (signup): " + errorMsg);
        throw new Error(errorMsg);
      }
    }
    // Check phone number uniqueness
    if (data.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            const errorMsg = "Phone number is already in use. Please use a different one.";
            // console.warn("AuthContext (signup): " + errorMsg);
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
      console.error("AuthContext (signup): Firebase signup error:", errorMessage, authError);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUser) {
      try {
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, data);
        toast({ title: "Signup Successful", description: "Welcome! Please complete your profile if prompted." });
        // onAuthStateChanged handles setting user and redirecting
      } catch (profileError: any) {
        console.error(`AuthContext (signup): Error setting up Firestore profile for ${firebaseUser.uid} after signup:`, profileError.message);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
         // Still, let onAuthStateChanged handle the main user state update.
      }
    }
    // setLoading(false) will be handled by onAuthStateChanged
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/'); // Redirect to home after logout
    } catch (error: any) {
      console.error("AuthContext (logout): Logout failed:", error.message);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      setLoading(false); // Ensure loading is false after logout attempt
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
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 7000,
          });
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method.";
          toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
          break;
        default:
          toastMessage = firebaseError.message || toastMessage;
          toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
      }
    } else {
        toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    }
    console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, firebaseError);
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
      toast({ title: "Social Login Successful", description: `Welcome via ${providerName}!` });
      // onAuthStateChanged will handle profile creation/fetching and redirect
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) will be handled by onAuthStateChanged
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      // console.error("AuthContext (updateUserProfile): User not logged in or Firebase services unavailable.");
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };

      const usersRef = collection(firestoreDb, "users");
      // Username uniqueness check
      if (updatedData.username && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        const conflictingUser = usernameSnap.docs.find(doc => doc.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      // Phone number uniqueness check
      if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        if(updatedData.phoneNumber.trim() !== "") {
            const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
            const phoneSnap = await getDocs(qPhone);
            const conflictingUser = phoneSnap.docs.find(doc => doc.id !== user.id);
            if (conflictingUser) {
                setLoading(false);
                throw new Error("Phone number already in use. Please use a different one.");
            }
        }
      }

      // Update Firebase Auth display name if it changed
      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      
      // Prevent client-side update of isAdmin
      if ('isAdmin' in updatePayloadFS) {
        delete (updatePayloadFS as any).isAdmin;
      }
      
      await updateDoc(userDocRef, updatePayloadFS);
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Update local user state
        
        // Handle redirection after profile completion
        if (typeof window !== 'undefined') {
          const isCompletingProfileFlag = localStorage.getItem('completingProfile') === 'true' || nextSearchParams.get('complete') === 'true';
          if (isCompletingProfileFlag) {
            const isProfileNowComplete = updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber;
            if (isProfileNowComplete) {
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname !== '/') {
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
      console.error("AuthContext (updateUserProfile): Error during profile update:", error.message, error);
      throw error; // Re-throw to be caught by form
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
        activeSocialLoginProvider,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

