
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
  type UserCredential,
  type User as FirebaseUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const MOCK_ADMIN_EMAIL = 'admin@example.com'; // Define a mock admin email

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
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
  if (typeof window === 'undefined') return null;
  const profileStr = localStorage.getItem(`userProfile_${uid}`);
  return profileStr ? JSON.parse(profileStr) : null;
};

// Helper to save mock user profile to localStorage
const saveMockUserProfile = (uid: string, profileData: Partial<User>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`userProfile_${uid}`, JSON.stringify(profileData));
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const router = useRouter();
  const pathname = usePathname();


  useEffect(() => {
    if (!firebaseAuth) {
      console.error("AuthContext: Firebase Auth service is not available. Aborting onAuthStateChanged setup.");
      toast({ variant: "destructive", title: "Auth Error", description: "Firebase Authentication service failed to initialize. Please refresh." });
      setLoading(false);
      return;
    }
     console.log("AuthContext: Setting up onAuthStateChanged listener.");

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext: onAuthStateChanged triggered. Firebase user UID:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        const localProfile = getMockUserProfile(firebaseUser.uid);
        const appUser: User = {
          id: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: localProfile?.displayName || firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL || localProfile?.isAdmin === true,
          username: localProfile?.username || null,
          role: localProfile?.role || null,
          phoneNumber: localProfile?.phoneNumber || firebaseUser.phoneNumber || null,
          institution: localProfile?.institution || null,
          researcherId: localProfile?.researcherId || null,
        };
        setUser(appUser);
        console.log("AuthContext: User hydrated from Firebase Auth & localStorage:", appUser);
        setShowLoginModal(false);

        const isProfileComplete = appUser.username && appUser.role;
        const completingProfileOnRefresh = localStorage.getItem('completingProfile') === 'true';
        const isProfileIncompleteFlag = localStorage.getItem('profileIncomplete') === 'true';

        if (!isProfileComplete && pathname !== '/profile/settings') {
          console.log("AuthContext: Profile incomplete, redirecting to /profile/settings?complete=true");
          localStorage.setItem('profileIncomplete', 'true');
          localStorage.setItem('completingProfile', 'true');
          router.push('/profile/settings?complete=true');
        } else if (isProfileComplete && (completingProfileOnRefresh || isProfileIncompleteFlag)) {
          console.log("AuthContext: Profile now complete, was previously incomplete or in completing state. Clearing flags.");
          localStorage.removeItem('profileIncomplete');
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
            console.log(`AuthContext: Redirecting to stored path: ${redirectPath}`);
            localStorage.removeItem('redirectAfterLogin');
            router.push(redirectPath);
          } else if (pathname === '/profile/settings' || pathname === '/login' || pathname === '/signup') {
            console.log("AuthContext: Profile complete, currently on settings/login/signup. Redirecting to /");
            router.push('/');
          } else {
            console.log("AuthContext: Profile complete. No specific redirect needed or already on target page.");
          }
        } else if (isProfileComplete && !completingProfileOnRefresh) {
          console.log("AuthContext: Profile complete. Checking for redirectAfterLogin.");
          localStorage.removeItem('profileIncomplete');
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          if (redirectPath && redirectPath !== pathname) {
            console.log(`AuthContext: Redirecting to stored path: ${redirectPath}`);
            localStorage.removeItem('redirectAfterLogin');
            router.push(redirectPath);
          } else {
            console.log("AuthContext: Profile complete. No redirectAfterLogin or already on target. Staying on current page:", pathname);
          }
        }
      } else {
        console.log("AuthContext: No Firebase user session found (firebaseUser is null). Clearing local user state.");
        setUser(null);
        localStorage.removeItem('profileIncomplete');
        // Don't remove redirectAfterLogin here, as it might be needed if modal was shown and then closed by user
        localStorage.removeItem('completingProfile');
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });
    return () => {
      console.log("AuthContext: Cleaning up onAuthStateChanged listener.");
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]); // Removed router from deps to avoid loop on redirects

  const login = async (email: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    console.log(`AuthContext (login): Attempting login for email: ${email}`);
    setLoading(true);
    setActiveSocialLoginProvider(null);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, pass);
      localStorage.setItem('redirectAfterLogin', '/');
      console.log(`AuthContext (login): Firebase login successful for ${email}. onAuthStateChanged will handle next steps.`);
      // onAuthStateChanged handles setting user and redirect
    } catch (error) {
      setLoading(false);
      const firebaseError = error as { code?: string; message?: string };
      let errorMessage = "An unknown error occurred during login.";
      if (firebaseError.code) {
        switch (firebaseError.code) {
          case 'auth/user-not-found':
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            errorMessage = 'Invalid email or password.';
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
      console.error(`AuthContext (login): Firebase login failed for ${email}. Error: ${errorMessage}`, firebaseError);
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    console.log(`AuthContext (signup): Attempting signup for email: ${data.email}, username: ${data.username}`);
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // Mock uniqueness checks for username and phone (if we were doing this without backend)
    // For now, Firebase Auth handles email uniqueness. Username/phone handled at profile completion.

    let userCredential: UserCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      console.log(`AuthContext (signup): Firebase Auth user created for ${data.email}. UID: ${userCredential.user.uid}`);
    } catch (authError: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup with Firebase Auth.";
      if (authError.code) {
        switch (authError.code) {
          case 'auth/email-already-in-use':
              errorMessage = 'This email address is already in use by another account.';
              break;
          // ... (other Firebase error codes)
          default:
              errorMessage = authError.message || errorMessage;
        }
      }
      console.error(`AuthContext (signup): Firebase Auth creation failed for ${data.email}. Error: ${errorMessage}`, authError);
      toast({ variant: "destructive", title: "Firebase Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    const firebaseUser = userCredential.user;
    if (firebaseUser) {
        try {
            await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
            console.log(`AuthContext (signup): Updated Firebase Auth display name for ${firebaseUser.uid} to ${data.fullName}`);
            // Save initial profile data to localStorage, onAuthStateChanged will pick it up
            const initialProfile: Partial<User> = {
              displayName: data.fullName,
              username: data.username,
              role: data.role,
              phoneNumber: data.phoneNumber,
              institution: data.institution,
              researcherId: data.researcherId,
              isAdmin: data.email === MOCK_ADMIN_EMAIL,
            };
            saveMockUserProfile(firebaseUser.uid, initialProfile);
            localStorage.setItem('redirectAfterLogin', '/');
            localStorage.setItem('completingProfile', 'true'); // Mark for profile completion flow
            // onAuthStateChanged will handle setting the user state and redirecting
        } catch (profileUpdateError) {
            console.warn("AuthContext (signup): Could not update Firebase Auth display name or save local profile:", profileUpdateError);
             toast({ variant: "destructive", title: "Signup Incomplete", description: "Account created, but profile setup had an issue. Please try updating your profile." });
        }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    console.log("AuthContext (logout): Attempting logout.");
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      console.log("AuthContext (logout): Firebase signOut successful.");
      // onAuthStateChanged will clear local state (setUser(null))
      localStorage.removeItem('redirectAfterLogin');
      localStorage.removeItem('profileIncomplete');
      localStorage.removeItem('completingProfile');
      // Remove all userProfile_UID items from localStorage
      if (typeof window !== 'undefined') {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('userProfile_')) {
            localStorage.removeItem(key);
          }
        });
      }
      router.push('/');
    } catch (error) {
      console.error("AuthContext (logout): Logout error:", error);
      toast({variant: "destructive", title: "Logout Failed", description: "Could not log out."});
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are allowed and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000,
          });
          return;
        // ... other specific error codes
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    console.error(`AuthContext (handleSocialLoginError - ${providerName}): Error: ${firebaseError.message}`, firebaseError);
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    toast({ title: `Initiating ${providerName} Sign-In`, description: `A popup window should appear. Please ensure popups are allowed.` });
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    console.log(`AuthContext (processSocialLogin): Initiating ${providerName} login.`);
    try {
      const result = await signInWithPopup(firebaseAuth, providerInstance);
      const firebaseUser = result.user;
      console.log(`AuthContext (processSocialLogin): ${providerName} signInWithPopup successful. User UID: ${firebaseUser.uid}`);
      // Save basic profile to localStorage; onAuthStateChanged will create the full User object.
      const initialProfile: Partial<User> = {
        displayName: firebaseUser.displayName,
        email: firebaseUser.email, // email is crucial here
        photoURL: firebaseUser.photoURL,
        isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL,
      };
      saveMockUserProfile(firebaseUser.uid, initialProfile);
      localStorage.setItem('redirectAfterLogin', '/');
      localStorage.setItem('completingProfile', 'true');
      // onAuthStateChanged handles setting user and redirect
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) are handled by onAuthStateChanged or handleSocialLoginError
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    console.log(`AuthContext (sendPasswordResetEmail): Sending reset email to ${emailAddress}`);
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser) {
      console.error("AuthContext (updateUserProfile): User not logged in.");
      throw new Error("User not logged in. Cannot update profile.");
    }
    console.log(`AuthContext (updateUserProfile): Updating mock profile for user ${user.id}. Data:`, updatedData);
    setLoading(true);

    try {
      const currentProfile = getMockUserProfile(user.id) || {};
      const newProfileData: User = {
        ...user, // Start with current user state
        ...currentProfile, // Overlay with stored profile
        ...updatedData, // Apply updates
        id: user.id,
        email: user.email, // email cannot be changed here
        photoURL: user.photoURL, // photoURL not updated here
        isAdmin: user.email === MOCK_ADMIN_EMAIL || currentProfile.isAdmin === true, // re-evaluate isAdmin
      };

      // Mock username/phone uniqueness check against localStorage (very basic)
      if (updatedData.username && updatedData.username !== user.username) {
        let isTaken = false;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
            const otherProfile = JSON.parse(localStorage.getItem(key) || '{}');
            if (otherProfile.username === updatedData.username) {
              isTaken = true;
              break;
            }
          }
        }
        if (isTaken) {
          throw new Error("Username already taken. Please choose another one.");
        }
      }
       if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        let isTaken = false;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
            const otherProfile = JSON.parse(localStorage.getItem(key) || '{}');
            if (otherProfile.phoneNumber === updatedData.phoneNumber) {
              isTaken = true;
              break;
            }
          }
        }
        if (isTaken) {
          throw new Error("Phone number already in use. Please use a different one.");
        }
      }


      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        console.log(`AuthContext (updateUserProfile): Updated Firebase Auth display name.`);
        newProfileData.displayName = updatedData.displayName; // Ensure it's updated in our object
      }

      saveMockUserProfile(user.id, newProfileData);
      setUser(newProfileData);
      console.log(`AuthContext (updateUserProfile): Local user state updated:`, newProfileData);

      if (localStorage.getItem('profileIncomplete') === 'true' || localStorage.getItem('completingProfile') === 'true') {
          if (newProfileData.username && newProfileData.role) {
              console.log("AuthContext (updateUserProfile): Profile completion detected after update, removing flags.");
              localStorage.removeItem('profileIncomplete');
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else {
                  router.push('/');
              }
          }
      }
      return newProfileData;
    } catch(error: any) {
      console.error("AuthContext (updateUserProfile): Error updating mock profile:", error);
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
        isSocialLoginInProgress: activeSocialLoginProvider !== null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
