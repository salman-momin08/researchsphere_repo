
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import {
  auth as firebaseAuth,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider
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
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'; // Keep for ProtectedRoute
import { Info } from 'lucide-react'; // Keep for ProtectedRoute

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
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to get mock user profile from localStorage
const getMockUserProfile = (uid: string): Partial<User> | null => {
  if (typeof window !== 'undefined') {
    const profileStr = localStorage.getItem(`userProfile_${uid}`);
    try {
      return profileStr ? JSON.parse(profileStr) : null;
    } catch (e) {
      console.error("AuthContext: Error parsing user profile from localStorage for UID", uid, e);
      localStorage.removeItem(`userProfile_${uid}`);
      return null;
    }
  }
  return null;
};

// Helper to save mock user profile to localStorage
const saveMockUserProfile = (uid: string, profileData: Partial<User>) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`userProfile_${uid}`, JSON.stringify(profileData));
  }
};

// Combined fetch/create for mock user profiles
const fetchOrCreateMockUserProfile = async (
  firebaseUser: FirebaseUser,
  signupData?: SignupFormValues
): Promise<Partial<User>> => {
  let localProfile = getMockUserProfile(firebaseUser.uid);

  if (localProfile) {
    console.log(`AuthContext: Found existing local profile for ${firebaseUser.uid}`, localProfile);
    // Ensure admin status is re-evaluated if email matches mock admin emails
    const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
    if (isAdminByEmail && localProfile.isAdmin !== true) {
      console.log(`AuthContext: Email ${firebaseUser.email} matches admin email, but local profile isAdmin is not true. Updating.`);
      localProfile.isAdmin = true;
      localProfile.role = localProfile.role || "Admin"; // Assign Admin role if not already set
      saveMockUserProfile(firebaseUser.uid, localProfile);
    }
    return localProfile;
  }

  // If no local profile, create one (common for first-time social login or fresh signup)
  console.log(`AuthContext: No local profile found for ${firebaseUser.uid}. Creating one.`);
  const isExplicitAdminCreator = firebaseUser.email === ADMIN_CREATOR_EMAIL;
  const isAdminByGeneralEmail = firebaseUser.email === MOCK_ADMIN_EMAIL;

  const newProfile: Partial<User> = {
    id: firebaseUser.uid,
    displayName: signupData?.fullName || firebaseUser.displayName,
    email: firebaseUser.email,
    photoURL: firebaseUser.photoURL,
    username: signupData?.username || null, // Ensure username from signup form is saved
    role: signupData?.role || (isExplicitAdminCreator || isAdminByGeneralEmail ? "Admin" : null),
    phoneNumber: signupData?.phoneNumber || null,
    institution: signupData?.institution || null,
    researcherId: signupData?.researcherId || null,
    isAdmin: isExplicitAdminCreator || isAdminByGeneralEmail || false,
  };
  console.log(`AuthContext: Created new local profile data for ${firebaseUser.uid}:`, newProfile);
  saveMockUserProfile(firebaseUser.uid, newProfile);
  return newProfile;
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
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
        toast({
            variant: "destructive",
            title: "Network Error",
            description: "You appear to be offline. Some features may not be available.",
            duration: 7000
        });
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      setLoading(true); // Set loading true while processing auth state
      if (firebaseUser) {
        console.log(`AuthContext (onAuthStateChanged): Firebase user detected: ${firebaseUser.uid}, Email: ${firebaseUser.email}`);
        // Fetch or create local mock profile. Pass undefined for signupData initially.
        const localProfile = await fetchOrCreateMockUserProfile(firebaseUser);
        console.log(`AuthContext (onAuthStateChanged): Local profile for ${firebaseUser.uid}:`, localProfile);

        const effectiveDisplayName = localProfile?.displayName || firebaseUser.displayName || "User";
        const effectivePhotoURL = localProfile?.photoURL || firebaseUser.photoURL || null;

        const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL;
        const isAdminInProfile = localProfile?.isAdmin === true;
        const finalIsAdmin = isAdminByEmail || isAdminInProfile;

        console.log(`AuthContext (onAuthStateChanged): Admin check for ${firebaseUser.email} - isAdminByEmail: ${isAdminByEmail}, isAdminInProfile: ${isAdminInProfile}, finalIsAdmin: ${finalIsAdmin}`);

        let appUser: User = {
          id: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: effectiveDisplayName,
          photoURL: effectivePhotoURL,
          isAdmin: finalIsAdmin,
          username: localProfile?.username || null,
          role: localProfile?.role || (finalIsAdmin ? "Admin" : null), // Default role to Admin if isAdmin
          phoneNumber: localProfile?.phoneNumber || null,
          institution: localProfile?.institution || null,
          researcherId: localProfile?.researcherId || null,
        };
        console.log(`AuthContext (onAuthStateChanged): Hydrated appUser for ${firebaseUser.uid}:`, appUser);

        setUser(appUser);

        const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
        const profileCompleteParam = nextSearchParams.get('complete');

        if (typeof window !== 'undefined') {
            if (!isProfileConsideredComplete && pathname !== '/profile/settings') {
                localStorage.setItem('completingProfile', 'true'); // Flag for profile completion
                console.log("AuthContext (onAuthStateChanged): Profile incomplete, redirecting to /profile/settings?complete=true");
                router.push('/profile/settings?complete=true');
            } else if (isProfileConsideredComplete && localStorage.getItem('completingProfile')) {
                localStorage.removeItem('completingProfile'); // Clear flag
            }

            const redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            if (redirectAfterLoginPath && redirectAfterLoginPath !== pathname) {
                console.log(`AuthContext (onAuthStateChanged): redirectAfterLoginPath found: ${redirectAfterLoginPath}. Redirecting.`);
                localStorage.removeItem('redirectAfterLogin');
                router.push(redirectAfterLoginPath);
            } else if (isProfileConsideredComplete && (pathname === '/login' || pathname === '/signup' || (pathname === '/profile/settings' && !profileCompleteParam))) {
                console.log("AuthContext (onAuthStateChanged): Profile complete and on auth page, redirecting to /");
                router.push('/');
            }
        }
        setShowLoginModal(false);
      } else {
        console.log("AuthContext (onAuthStateChanged): No Firebase user.");
        setUser(null);
         if (typeof window !== 'undefined') {
           localStorage.removeItem('completingProfile'); // Clear if user logs out
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

    console.log(`AuthContext (login): Attempting login with identifier: '${identifier}'`);

    if (!identifier.includes('@')) {
      console.log(`AuthContext (login): Identifier '${identifier}' treated as username. Looking up email...`);
      let foundEmailForUsername: string | null = null;
      if (typeof window !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('userProfile_')) {
            try {
              const profile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (profile.username === identifier && profile.email) {
                foundEmailForUsername = profile.email;
                console.log(`AuthContext (login): Found email '${foundEmailForUsername}' for username '${identifier}' from localStorage.`);
                break;
              }
            } catch (e) {
              console.warn("AuthContext (login): Error parsing user profile from localStorage for key", key, e);
            }
          }
        }
      }
      if (foundEmailForUsername) {
        emailToLogin = foundEmailForUsername;
        console.log(`AuthContext (login): Using email '${emailToLogin}' for login.`);
      } else {
        setLoading(false);
        const errorMsg = "User not found with this username. Check username or try logging in with email.";
        console.error(`AuthContext (login): No email found for username '${identifier}'.`);
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged handles setting user and redirect
      console.log(`AuthContext (login): Firebase signInWithEmailAndPassword successful for '${emailToLogin}'. Awaiting onAuthStateChanged.`);
    } catch (error) {
      setLoading(false);
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
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    console.log("AuthContext (signup): Attempting signup with data:", data);

    if (typeof window !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_')) {
            try {
                const profile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
                if (profile.username && profile.username === data.username) {
                  setLoading(false);
                  const errorMsg = "Username is already taken. Please choose another one.";
                  console.error("AuthContext (signup): Username conflict:", errorMsg);
                  throw new Error(errorMsg);
                }
                if (data.phoneNumber && profile.phoneNumber && profile.phoneNumber === data.phoneNumber) {
                     setLoading(false);
                     const errorMsg = "Phone number is already in use. Please use a different one.";
                     console.error("AuthContext (signup): Phone number conflict:", errorMsg);
                     throw new Error(errorMsg);
                }
            } catch (e) { /* ignore parsing errors */ }
            }
        }
    }

    let userCredentialFirebase: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      userCredentialFirebase = cred.user;
      console.log("AuthContext (signup): Firebase user created successfully:", userCredentialFirebase.uid);
    } catch (authError: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code) {
        switch (authError.code) {
          case 'auth/email-already-in-use':
              errorMessage = 'This email address is already in use.';
              break;
          default:
              errorMessage = authError.message || errorMessage;
        }
      }
      console.error("AuthContext (signup): Firebase user creation error:", errorMessage, authError);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (userCredentialFirebase) {
        try {
            await updateFirebaseProfile(userCredentialFirebase, { displayName: data.fullName });
            console.log("AuthContext (signup): Firebase profile displayName updated for:", userCredentialFirebase.uid);
            // Pass signupData to fetchOrCreateMockUserProfile to correctly initialize local profile
            await fetchOrCreateMockUserProfile(userCredentialFirebase, data);
            // onAuthStateChanged will pick up the new user state
            toast({ title: "Signup Successful!", description: "Please complete your profile if prompted."});
        } catch (profileUpdateError: any) {
            console.error("AuthContext (signup): Error updating Firebase profile or creating local profile:", profileUpdateError);
            toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileUpdateError.message}. Please try updating your profile.` });
        }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    console.log("AuthContext (logout): Attempting logout.");
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (user && typeof window !== 'undefined') {
          localStorage.removeItem(`userProfile_${user.id}`);
          console.log(`AuthContext (logout): Removed local profile for ${user.id}.`);
      }
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      router.push('/'); // Redirect to home after logout
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error: any) {
      console.error("AuthContext (logout): Logout error:", error);
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
        setLoading(false);
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
          toastMessage = `The ${providerName} sign-in popup was closed. If this was unintentional, please check your browser's popup blocker settings for this site and try again. If issues persist, try a different browser or check your network.`;
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
    setLoading(false);
    setActiveSocialLoginProvider(null);
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    console.log(`AuthContext (processSocialLogin): Attempting login with ${providerName}.`);
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      const result = await signInWithPopup(firebaseAuth, providerInstance);
      const firebaseUser = result.user;
      console.log(`AuthContext (processSocialLogin): Firebase user signed in via ${providerName}: ${firebaseUser.uid}`);
      // Ensure local profile is created/updated. Pass undefined for signupData.
      await fetchOrCreateMockUserProfile(firebaseUser);
      // onAuthStateChanged handles setting the main user state and profile completion redirect
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading and setActiveSocialLoginProvider are handled by onAuthStateChanged or handleSocialLoginError
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    console.log(`AuthContext (sendPasswordResetEmail): Sending reset email to: ${emailAddress}`);
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser) {
      console.error("AuthContext (updateUserProfile): User not logged in or Firebase currentUser not available.");
      throw new Error("User not logged in. Cannot update profile.");
    }
    setLoading(true);
    console.log("AuthContext (updateUserProfile): Attempting to update profile with data:", updatedData);

    try {
      if (typeof window !== 'undefined') {
        if (updatedData.username && updatedData.username !== user.username) {
           console.log(`AuthContext (updateUserProfile): Checking username uniqueness for '${updatedData.username}'.`);
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (otherProfile.username === updatedData.username) {
                setLoading(false);
                const errorMsg = "Username already taken. Please choose another one.";
                console.error("AuthContext (updateUserProfile): Username conflict:", errorMsg);
                throw new Error(errorMsg);
              }
            }
          }
        }
        if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
           console.log(`AuthContext (updateUserProfile): Checking phone number uniqueness for '${updatedData.phoneNumber}'.`);
           for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (otherProfile.phoneNumber && otherProfile.phoneNumber === updatedData.phoneNumber) {
                setLoading(false);
                const errorMsg = "Phone number already in use. Please use a different one.";
                 console.error("AuthContext (updateUserProfile): Phone number conflict:", errorMsg);
                throw new Error(errorMsg);
              }
            }
          }
        }
      }

      const currentLocalProfile = getMockUserProfile(user.id) || {};
      const newProfileDataForStorage: User = {
        ...user,
        ...currentLocalProfile,
        ...updatedData,
        id: user.id,
        email: user.email,
        photoURL: user.photoURL,
        isAdmin: user.isAdmin,
      };

      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        newProfileDataForStorage.displayName = updatedData.displayName;
        console.log("AuthContext (updateUserProfile): Firebase profile displayName updated.");
      }

      saveMockUserProfile(user.id, newProfileDataForStorage);
      setUser(newProfileDataForStorage);
      console.log("AuthContext (updateUserProfile): Local profile and context state updated:", newProfileDataForStorage);

      if (typeof window !== 'undefined' && (localStorage.getItem('completingProfile') === 'true' || nextSearchParams.get('complete') === 'true')) {
          if (newProfileDataForStorage.username && newProfileDataForStorage.role && newProfileDataForStorage.phoneNumber) {
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  console.log("AuthContext (updateUserProfile): Profile complete, redirecting to stored path:", redirectPath);
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname !== '/') {
                  console.log("AuthContext (updateUserProfile): Profile complete, redirecting to /");
                  router.push('/');
              }
          } else {
            console.log("AuthContext (updateUserProfile): Profile updated, but still incomplete. Staying on profile page.");
          }
      }
      return newProfileDataForStorage;
    } catch(error: any) {
      console.error("AuthContext (updateUserProfile): Error during profile update:", error);
      if (error.message !== "Username already taken. Please choose another one." && error.message !== "Phone number already in use. Please use a different one.") {
          toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      }
      throw error;
    } finally {
        setLoading(false);
    }
  };

  const isAdmin = user?.isAdmin === true;
  // console.log(`AuthContext: isAdmin status computed as: ${isAdmin} for user:`, user?.email);

  return (
    <AuthContext.Provider value={{
        user, loading, login, signup, logout,
        loginWithGoogle, loginWithGitHub,
        sendPasswordResetEmail, updateUserProfile,
        showLoginModal, setShowLoginModal, isAdmin,
        isSocialLoginInProgress: activeSocialLoginProvider !== null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

