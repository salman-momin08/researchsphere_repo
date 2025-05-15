
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import {
  auth as firebaseAuth,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider,
  db as firestoreDb // Ensure db is imported
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
  isSocialLoginInProgress: boolean; // Simplified boolean for general UI disabling
  activeSocialLoginProvider: 'google' | 'github' | null; // For specific button disabling
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
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      console.log(`AuthContext (fetchUserProfileFromFirestore): Raw isAdmin from Firestore for ${uid}:`, firestoreIsAdmin, `(type: ${typeof firestoreIsAdmin})`);
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
        isAdmin: determinedIsAdmin, // Use strict boolean
        createdAt: docData.createdAt instanceof Timestamp ? docData.createdAt.toDate().toISOString() : docData.createdAt,
        updatedAt: docData.updatedAt instanceof Timestamp ? docData.updatedAt.toDate().toISOString() : docData.updatedAt,
      };
      return userProfile;
    } else {
      console.warn(`AuthContext (fetchUserProfileFromFirestore): No Firestore profile found for UID ${uid}. Will attempt to create one.`);
      return null;
    }
  } catch (error) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching Firestore profile for UID ${uid}:`, error);
    toast({ variant: "destructive", title: "Profile Load Error", description: "Could not load your profile from the database.", duration: 7000 });
    return null;
  }
};

// Helper to create or update user profile in Firestore (used on first login/signup)
const createOrUpdateUserProfileInFirestore = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  signupData?: Partial<SignupFormValues & {isSocialSignIn?: boolean}>
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (createOrUpdateUserProfileInFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  try {
    const userSnap = await getDoc(userDocRef);
    const now = serverTimestamp();
    let profileDataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    const isNewlyCreatedAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      // User document exists, update it (e.g., photoURL from social, or profile completion)
      const existingData = userSnap.data() as User;
      profileDataToSave = {
        userId: firebaseUid, // Ensure userId is part of the update if needed by rules
        displayName: firebaseUserObject.displayName || signupData?.fullName || existingData.displayName || "User",
        photoURL: firebaseUserObject.photoURL || existingData.photoURL || null,
        email: firebaseUserObject.email,
        username: signupData?.username || existingData.username || null,
        role: signupData?.role || existingData.role || (isNewlyCreatedAdminByEmail ? "Admin" : null),
        phoneNumber: signupData?.phoneNumber || existingData.phoneNumber || null,
        institution: signupData?.institution || existingData.institution || null,
        researcherId: signupData?.researcherId || existingData.researcherId || null,
        isAdmin: existingData.isAdmin || isNewlyCreatedAdminByEmail || false,
        updatedAt: now,
      };
      console.log("AuthContext (createOrUpdateUserProfileInFirestore): Updating existing Firestore profile for", firebaseUid, profileDataToSave);
      await updateDoc(userDocRef, profileDataToSave);
    } else {
      // User document does not exist, create it
      profileDataToSave = {
        id: firebaseUid,
        userId: firebaseUid, // Ensure userId is part of the create if needed by rules
        email: firebaseUserObject.email,
        displayName: firebaseUserObject.displayName || signupData?.fullName || (signupData?.isSocialSignIn ? firebaseUserObject.email?.split('@')[0] : "User"),
        photoURL: firebaseUserObject.photoURL || null,
        username: signupData?.username || null,
        role: signupData?.role || (isNewlyCreatedAdminByEmail ? "Admin" : null),
        phoneNumber: signupData?.phoneNumber || null,
        institution: signupData?.institution || null,
        researcherId: signupData?.researcherId || null,
        isAdmin: isNewlyCreatedAdminByEmail || false,
        createdAt: now,
        updatedAt: now,
      };
      console.log("AuthContext (createOrUpdateUserProfileInFirestore): Creating new Firestore profile for", firebaseUid, profileDataToSave);
      await setDoc(userDocRef, profileDataToSave);
    }
    // Fetch the (potentially newly created or updated) profile to ensure consistency
    return fetchUserProfileFromFirestore(firebaseUid);
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
  const nextSearchParams = useNextSearchParams(); // Renamed to avoid conflict

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
    console.log("AuthContext useEffect running. Pathname:", pathname);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext onAuthStateChanged: Firebase user:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        let appUser = await fetchUserProfileFromFirestore(firebaseUser.uid);

        if (!appUser) {
          // This can happen on first social login or if Firestore doc was deleted
          console.log(`AuthContext onAuthStateChanged: No existing Firestore profile for ${firebaseUser.uid}, attempting to create one.`);
          appUser = await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, { isSocialSignIn: firebaseUser.providerData.some(p => p.providerId !== 'password') });
        } else {
          // Ensure isAdmin is correctly set from Firestore data or email override
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          console.log(`AuthContext (onAuthStateChanged): Raw isAdmin from Firestore profile for ${firebaseUser.uid}:`, rawIsAdminFromProfile, `(type: ${typeof rawIsAdminFromProfile})`);
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true); // Strict boolean check
          console.log(`AuthContext (onAuthStateChanged): Determined isAdmin for ${firebaseUser.uid}: ${finalIsAdmin}`);

          if (appUser.isAdmin !== finalIsAdmin) {
            console.log(`AuthContext onAuthStateChanged: Admin status mismatch for ${firebaseUser.uid}. Firestore: ${appUser.isAdmin}, Determined: ${finalIsAdmin}. Updating appUser state.`);
            appUser.isAdmin = finalIsAdmin;
            // No need to update Firestore here for isAdmin, it should be source of truth or set on creation.
          }
        }
        
        console.log("AuthContext onAuthStateChanged: Hydrated appUser:", appUser);
        if (appUser) {
          setUser(appUser);
          setShowLoginModal(false); // Close login modal if it was open

          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          const profileCompleteParam = nextSearchParams.get('complete');
          const isCompletingProfileAfterLogin = (pathname === '/profile/settings' && profileCompleteParam === 'true');
          const isAuthPage = pathname === '/login' || pathname === '/signup';
          
          let redirectPath: string | null = null;
          if (typeof window !== 'undefined') {
            redirectPath = localStorage.getItem('redirectAfterLogin');
          }

          console.log(`AuthContext onAuthStateChanged: Redirection checks for ${appUser.email}. Pathname: ${pathname}, RedirectPath: ${redirectPath}, IsAdmin: ${appUser.isAdmin}, ProfileComplete: ${isProfileConsideredComplete}, IsAuthPage: ${isAuthPage}, IsCompletingProfile: ${isCompletingProfileAfterLogin}`);

          if (!isProfileConsideredComplete && pathname !== '/profile/settings') {
            console.log(`AuthContext onAuthStateChanged: Profile incomplete for ${appUser.email}. Redirecting to /profile/settings?complete=true`);
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else {
            if (isProfileConsideredComplete && typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true') {
              localStorage.removeItem('completingProfile');
            }

            if (appUser.isAdmin) {
              const cameFromNonAdminContextOrAuthPage = isAuthPage || pathname === '/' || isCompletingProfileAfterLogin;
              console.log(`AuthContext (Admin Redirect Logic): cameFromNonAdminContextOrAuthPage = ${cameFromNonAdminContextOrAuthPage}`);

              if (redirectPath) { // A specific path was requested before login
                if (pathname !== redirectPath) {
                  console.log(`AuthContext (Admin Redirect Logic): Has redirectPath ('${redirectPath}'). Redirecting.`);
                  router.push(redirectPath);
                }
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              } else if (cameFromNonAdminContextOrAuthPage) {
                // No specific redirectPath, but user came from login/signup/home/profile-completion.
                if (pathname !== '/admin/dashboard' && !pathname.startsWith('/admin/')) { // Avoid redundant push or pushing if already deeper in admin
                   console.log(`AuthContext (Admin Redirect Logic): Came from non-admin context ('${pathname}'). Redirecting to /admin/dashboard.`);
                   router.push('/admin/dashboard');
                } else {
                   console.log(`AuthContext (Admin Redirect Logic): Came from non-admin context but already in admin area ('${pathname}') or on dashboard. No redirect to dashboard.`);
                }
              } else {
                // No specific redirectPath, and not coming from a non-admin entry point.
                // User is already authenticated, admin, and navigating within the app (or refreshed an admin page).
                console.log(`AuthContext (Admin Redirect Logic): Already authenticated & in-app ('${pathname}'). No automatic redirect to /admin/dashboard.`);
              }
            } else { // Not an admin
              if (redirectPath && redirectPath !== pathname) {
                console.log(`AuthContext (User Redirect Logic): Has redirectPath ('${redirectPath}'). Redirecting.`);
                router.push(redirectPath);
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              } else if (isAuthPage || (pathname === '/profile/settings' && !profileCompleteParam)) {
                 // If on login/signup or profile settings (not completing), redirect to home for non-admins.
                console.log(`AuthContext (User Redirect Logic): On auth page or profile settings ('${pathname}'). Redirecting to /.`);
                router.push('/');
                if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
              } else {
                console.log(`AuthContext (User Redirect Logic): No specific redirect needed for path '${pathname}'.`);
              }
            }
          }
        } else {
          console.error("AuthContext onAuthStateChanged: Failed to fetch or create Firestore profile for authenticated Firebase user. Logging out.");
          if (firebaseAuth) await signOut(firebaseAuth); // Sign out from Firebase if Firestore profile fails
          setUser(null);
        }
      } else {
        setUser(null);
        if (typeof window !== 'undefined') {
           localStorage.removeItem('completingProfile'); // Clear this flag on logout
         }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null); // Reset after auth state change
    });

    return () => unsubscribe();
  }, [pathname, router, nextSearchParams]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    if (!firestoreDb) throw new Error("Database service not available for login.");
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
             const errorMsg = `User profile incomplete (missing email) for username '${identifier}'.`;
             console.error("AuthContext (login): " + errorMsg);
             toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
             throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = `User not found with username '${identifier}'. Check username or try logging in with email.`;
          console.warn("AuthContext (login): " + errorMsg);
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
    
    try {
      console.log(`AuthContext (login): Calling Firebase signInWithEmailAndPassword with resolved email: '${emailToLogin}'`);
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
    // setLoading(false) is handled by onAuthStateChanged
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Authentication or Database service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    console.log("AuthContext (signup): Attempting signup with data:", { ...data, password: "REDACTED" });

    const usersRef = collection(firestoreDb, "users");
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        const errorMsg = "Username is already taken. Please choose another one.";
        console.warn("AuthContext (signup): " + errorMsg);
        throw new Error(errorMsg);
      }
    }
    if (data.phoneNumber) { // Ensure phone number is checked
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            const errorMsg = "Phone number is already in use. Please use a different one.";
            console.warn("AuthContext (signup): " + errorMsg);
            throw new Error(errorMsg);
        }
    }


    let firebaseUser: FirebaseUser;
    try {
      console.log(`AuthContext (signup): Calling Firebase createUserWithEmailAndPassword for email: ${data.email}`);
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
      console.log(`AuthContext (signup): Firebase user created successfully: ${firebaseUser.uid}`);
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
        console.log(`AuthContext (signup): Updating Firebase profile display name for ${firebaseUser.uid} to: ${data.fullName}`);
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        // Create Firestore profile using the helper (onAuthStateChanged will also try, but good to do it here too)
        const { password, confirmPassword, confirmEmail, termsAccepted, ...profileDataForFirestore } = data;
        console.log(`AuthContext (signup): Creating Firestore profile for ${firebaseUser.uid} with data:`, profileDataForFirestore);
        await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, profileDataForFirestore);
      } catch (profileError: any) {
        // Firebase user created, but Firestore profile had issues. onAuthStateChanged will attempt recovery.
        console.error(`AuthContext (signup): Error setting up Firestore profile for ${firebaseUser.uid} after signup:`, profileError.message);
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
        // Do not throw here, let onAuthStateChanged handle it
      }
    }
    // setLoading(false) is handled by onAuthStateChanged
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    console.log("AuthContext (logout): Attempting logout.");
    setLoading(true); // For perceived responsiveness
    try {
      await signOut(firebaseAuth);
      // setUser(null) and redirect handled by onAuthStateChanged
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/'); // Explicit redirect to home on logout
    } catch (error: any) {
      console.error("AuthContext (logout): Logout failed:", error.message);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
      setLoading(false); // Reset loading if logout fails
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setLoading(false); // Ensure loading is stopped on error
    setActiveSocialLoginProvider(null); // Reset active provider

    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing. Please ensure popups are enabled and try again. If the issue persists, you can also try signing up with email/password.`;
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
    console.error(`AuthContext (handleSocialLoginError - ${providerName}):`, firebaseError);
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
      // onAuthStateChanged will handle user state and profile creation/fetching
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) are handled by onAuthStateChanged or handleSocialLoginError
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    console.log(`AuthContext (sendPasswordResetEmail): Sending reset email to: ${emailAddress}`);
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      console.error("AuthContext (updateUserProfile): User not logged in or Firebase services unavailable.");
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);
    console.log(`AuthContext (updateUserProfile): Attempting to update profile for ${user.id} with data:`, updatedData);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayloadFS: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };

      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username !== user.username) {
        console.log(`AuthContext (updateUserProfile): Checking username uniqueness for '${updatedData.username}' (excluding user ${user.id})`);
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        const conflictingUser = usernameSnap.docs.find(doc => doc.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          const errorMsg = "Username already taken. Please choose another one.";
          console.warn("AuthContext (updateUserProfile): " + errorMsg);
          throw new Error(errorMsg);
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        if(updatedData.phoneNumber.trim() !== "") {
            console.log(`AuthContext (updateUserProfile): Checking phone number uniqueness for '${updatedData.phoneNumber}' (excluding user ${user.id})`);
            const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
            const phoneSnap = await getDocs(qPhone);
            const conflictingUser = phoneSnap.docs.find(doc => doc.id !== user.id);
            if (conflictingUser) {
                setLoading(false);
                const errorMsg = "Phone number already in use. Please use a different one.";
                console.warn("AuthContext (updateUserProfile): " + errorMsg);
                throw new Error(errorMsg);
            }
        }
      }

      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        console.log(`AuthContext (updateUserProfile): Updating Firebase Auth display name to '${updatedData.displayName}'`);
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      
      // Ensure isAdmin cannot be updated by client
      if ('isAdmin' in updatePayloadFS) {
        console.warn("AuthContext (updateUserProfile): Attempt to update 'isAdmin' field by client was ignored.");
        delete (updatePayloadFS as any).isAdmin;
      }
      
      console.log(`AuthContext (updateUserProfile): Updating Firestore document ${user.id} with payload:`, updatePayloadFS);
      await updateDoc(userDocRef, updatePayloadFS);
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);
      console.log(`AuthContext (updateUserProfile): Successfully updated. Fetched updated profile:`, updatedUserFromDb);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Update context state
        
        if (typeof window !== 'undefined') {
          const isCompletingProfileFlag = localStorage.getItem('completingProfile') === 'true' || nextSearchParams.get('complete') === 'true';
          if (isCompletingProfileFlag) {
            const isProfileNowComplete = updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber;
            if (isProfileNowComplete) {
              console.log("AuthContext (updateUserProfile): Profile now complete. Removing 'completingProfile' flag.");
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  console.log(`AuthContext (updateUserProfile): Profile complete, redirecting to stored path: ${redirectPath}`);
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname !== '/') { // If no specific redirect, go to default based on role
                  const defaultRedirect = updatedUserFromDb.isAdmin ? '/admin/dashboard' : '/';
                  console.log(`AuthContext (updateUserProfile): Profile complete, redirecting to default: ${defaultRedirect}`);
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
      // Error already thrown by uniqueness checks or will be Firestore error
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
        isSocialLoginInProgress: activeSocialLoginProvider !== null, // True if any social login is active
        activeSocialLoginProvider, // Specific provider for button state
    }}>
      {children}
    </AuthContext.Provider>
  );
};
