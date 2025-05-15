
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
  getIdToken,
} from 'firebase/auth';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const MOCK_ADMIN_EMAIL = 'admin@example.com';
const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identifier: string, pass: string) => Promise<void>; // Identifier can be email or username
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

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext: onAuthStateChanged triggered. Firebase user UID:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        const localProfile = getMockUserProfile(firebaseUser.uid);
        const effectiveDisplayName = localProfile?.displayName || firebaseUser.displayName || "User";
        const effectivePhotoURL = localProfile?.photoURL || firebaseUser.photoURL || null;
        const effectivePhoneNumber = localProfile?.phoneNumber || firebaseUser.phoneNumber || null;

        // Update Firebase Auth profile if local changes are more recent or Firebase's are null
        // This is primarily for displayName and photoURL from social logins or initial signup
        if ((effectiveDisplayName && effectiveDisplayName !== firebaseUser.displayName) || (effectivePhotoURL && effectivePhotoURL !== firebaseUser.photoURL)) {
            try {
                await updateFirebaseProfile(firebaseUser, { displayName: effectiveDisplayName, photoURL: effectivePhotoURL });
                console.log("AuthContext: Synced local profile (displayName/photoURL) to Firebase Auth profile for UID:", firebaseUser.uid);
            } catch (profileSyncError) {
                console.warn("AuthContext: Error syncing local profile to Firebase Auth:", profileSyncError);
            }
        }


        const appUser: User = {
          id: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: effectiveDisplayName,
          photoURL: effectivePhotoURL,
          isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL || localProfile?.isAdmin === true || firebaseUser.email === ADMIN_CREATOR_EMAIL,
          username: localProfile?.username || null,
          role: localProfile?.role || null,
          phoneNumber: effectivePhoneNumber,
          institution: localProfile?.institution || null,
          researcherId: localProfile?.researcherId || null,
        };

        // If admin status determined by email, ensure it's saved to local profile
        if ((firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL) && localProfile?.isAdmin !== true) {
            saveMockUserProfile(firebaseUser.uid, { ...localProfile, isAdmin: true, role: localProfile?.role || "Admin" });
            appUser.isAdmin = true;
            if (!appUser.role) appUser.role = "Admin"; // Assign Admin role if newly made admin
        }


        setUser(appUser);
        console.log("AuthContext: Hydrated appUser for UID:", firebaseUser.uid, appUser);
        setShowLoginModal(false);

        const isProfileComplete = appUser.username && appUser.role && appUser.phoneNumber;
        const completingProfileOnRefresh = localStorage.getItem('completingProfile') === 'true';

        if (!isProfileComplete && pathname !== '/profile/settings') {
          localStorage.setItem('profileIncomplete', 'true');
          localStorage.setItem('completingProfile', 'true');
          router.push('/profile/settings?complete=true');
        } else if (isProfileComplete && (completingProfileOnRefresh || localStorage.getItem('profileIncomplete') === 'true')) {
          localStorage.removeItem('profileIncomplete');
          localStorage.removeItem('completingProfile');
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          if (redirectPath && redirectPath !== pathname) {
            localStorage.removeItem('redirectAfterLogin');
            router.push(redirectPath);
          } else if (pathname === '/profile/settings' || pathname === '/login' || pathname === '/signup') {
            router.push('/');
          }
        } else if (isProfileComplete) {
          const redirectPath = localStorage.getItem('redirectAfterLogin');
          if (redirectPath && redirectPath !== pathname) {
            localStorage.removeItem('redirectAfterLogin');
            router.push(redirectPath);
          }
        }

      } else {
        setUser(null);
        // Do not clear redirectAfterLogin here, modal might have set it.
        // localStorage.removeItem('profileIncomplete'); // Keep if needed for next login
        localStorage.removeItem('completingProfile');
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });
    return () => {
      unsubscribe();
    };
  }, [router, pathname]); // router and pathname added to ensure effect re-runs on navigation

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    // Check if identifier is a username
    if (!identifier.includes('@')) { // Simple check; could be more robust
      console.log("AuthContext (login): Identifier appears to be a username:", identifier);
      let foundEmailForUsername: string | null = null;
      if (typeof window !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('userProfile_')) {
            try {
              const profile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (profile.username === identifier && profile.email) {
                foundEmailForUsername = profile.email;
                break;
              }
            } catch (e) {
              console.warn("AuthContext (login): Error parsing user profile from localStorage", e);
            }
          }
        }
      }
      if (foundEmailForUsername) {
        console.log(`AuthContext (login): Found email '${foundEmailForUsername}' for username '${identifier}'. Proceeding with this email.`);
        emailToLogin = foundEmailForUsername;
      } else {
        setLoading(false);
        const errorMsg = "User not found with this username. Please check the username or try logging in with email.";
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        console.error(`AuthContext (login): Username '${identifier}' not found in local profiles.`);
        throw new Error(errorMsg);
      }
    }


    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      localStorage.setItem('redirectAfterLogin', '/'); // Default redirect after successful login
      // onAuthStateChanged handles setting user and actual redirect
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
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);

    // Mock uniqueness checks for username and phone (these are also checked in API if backend were active)
    if (typeof window !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('userProfile_')) {
          try {
            const profile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
            if (profile.username === data.username) {
              setLoading(false);
              const errorMsg = "Username is already taken. Please choose another one.";
              toast({variant: "destructive", title: "Signup Failed", description: errorMsg});
              throw new Error(errorMsg);
            }
            if (data.phoneNumber && profile.phoneNumber === data.phoneNumber) {
              setLoading(false);
              const errorMsg = "Phone number is already in use. Please choose another one.";
              toast({variant: "destructive", title: "Signup Failed", description: errorMsg});
              throw new Error(errorMsg);
            }
          } catch (e) { /* ignore parsing errors for this check */ }
        }
      }
    }

    let userCredential: UserCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
    } catch (authError: any) {
      setLoading(false);
      let errorMessage = "An unknown error occurred during signup with Firebase Auth.";
      if (authError.code) {
        switch (authError.code) {
          case 'auth/email-already-in-use':
              errorMessage = 'This email address is already in use by another account.';
              break;
          default:
              errorMessage = authError.message || errorMessage;
        }
      }
      toast({ variant: "destructive", title: "Firebase Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    const firebaseUser = userCredential.user;
    if (firebaseUser) {
        try {
            await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
            const initialProfile: Partial<User> = {
              displayName: data.fullName,
              username: data.username,
              role: data.role,
              phoneNumber: data.phoneNumber,
              institution: data.institution,
              researcherId: data.researcherId,
              isAdmin: data.email === MOCK_ADMIN_EMAIL || data.email === ADMIN_CREATOR_EMAIL,
            };
            saveMockUserProfile(firebaseUser.uid, initialProfile);
            localStorage.setItem('redirectAfterLogin', '/');
            localStorage.setItem('completingProfile', 'true');
            // onAuthStateChanged will handle setting the user state and redirecting
        } catch (profileUpdateError) {
            toast({ variant: "destructive", title: "Signup Incomplete", description: "Account created, but profile setup had an issue. Please try updating your profile." });
        }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      setUser(null); // Clear local state immediately
      localStorage.removeItem('redirectAfterLogin');
      localStorage.removeItem('profileIncomplete');
      localStorage.removeItem('completingProfile');
      if (typeof window !== 'undefined') {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('userProfile_')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
      }
      router.push('/');
    } catch (error) {
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are enabled and try again. Some browsers or extensions might block popups automatically.`;
           toast({
            title: toastTitle,
            description: React.createElement('div', null,
              React.createElement('p', null, toastMessage),
              React.createElement('p', {className: "mt-2 text-xs"}, "If issues persist, you might try the 'Sign in with redirect' method if available, or ensure no browser extensions are interfering.")
            ),
            duration: 15000,
          });
          return;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in using a provider associated with this email address.";
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
    toast({
      title: `Initiating ${providerName} Sign-In`,
      description: React.createElement('div', null,
        React.createElement('p', null, "A popup window should appear."),
        React.createElement('p', {className: "text-xs mt-1"}, "Please ensure popups are allowed in your browser for this site.")
      ),
      duration: 7000
    });

    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      const result = await signInWithPopup(firebaseAuth, providerInstance);
      const firebaseUser = result.user;
      const localProfile = getMockUserProfile(firebaseUser.uid); // Check if profile exists

      // For social logins, the basic profile (displayName, email, photoURL) comes from Firebase.
      // Username, role etc. need to be completed if not present in localProfile.
      const initialProfile: Partial<User> = {
        displayName: firebaseUser.displayName,
        email: firebaseUser.email,
        photoURL: firebaseUser.photoURL,
        isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL || localProfile?.isAdmin === true,
        username: localProfile?.username || null, // Preserve if exists
        role: localProfile?.role || null, // Preserve if exists
        phoneNumber: localProfile?.phoneNumber || null, // Preserve if exists
        institution: localProfile?.institution || null, // Preserve if exists
        researcherId: localProfile?.researcherId || null, // Preserve if exists
      };
      saveMockUserProfile(firebaseUser.uid, initialProfile);
      localStorage.setItem('redirectAfterLogin', '/'); // Default redirect

      // Determine if profile needs completion
      const needsCompletion = !initialProfile.username || !initialProfile.role || !initialProfile.phoneNumber;
      if (needsCompletion) {
          localStorage.setItem('completingProfile', 'true');
          // onAuthStateChanged will handle the redirect to profile settings
      }
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
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser) {
      throw new Error("User not logged in. Cannot update profile.");
    }
    setLoading(true);

    try {
      // Mock username/phone uniqueness check against localStorage
      if (typeof window !== 'undefined') {
        if (updatedData.username && updatedData.username !== user.username) {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}');
              if (otherProfile.username === updatedData.username) {
                setLoading(false);
                const errorMsg = "Username already taken. Please choose another one.";
                toast({ variant: "destructive", title: "Update Failed", description: errorMsg });
                throw new Error(errorMsg);
              }
            }
          }
        }
        if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}');
              if (otherProfile.phoneNumber && otherProfile.phoneNumber === updatedData.phoneNumber) {
                setLoading(false);
                const errorMsg = "Phone number already in use. Please use a different one.";
                toast({ variant: "destructive", title: "Update Failed", description: errorMsg });
                throw new Error(errorMsg);
              }
            }
          }
        }
      }

      const currentProfile = getMockUserProfile(user.id) || {};
      const newProfileData: User = {
        ...user, // Start with current user state from context
        ...currentProfile, // Overlay with potentially more complete stored profile
        ...updatedData, // Apply updates
        // Ensure non-updatable fields are preserved from original user state
        id: user.id,
        email: user.email,
        photoURL: user.photoURL, // photoURL typically not updated this way
        isAdmin: user.isAdmin, // isAdmin cannot be changed by user
      };

      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        newProfileData.displayName = updatedData.displayName;
      }

      saveMockUserProfile(user.id, newProfileData);
      setUser(newProfileData); // Update context state

      if (localStorage.getItem('profileIncomplete') === 'true' || localStorage.getItem('completingProfile') === 'true') {
          if (newProfileData.username && newProfileData.role && newProfileData.phoneNumber) { // Now includes phoneNumber
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
      // Errors from uniqueness checks above are already toasted.
      // This catches other potential errors.
      if (error.message !== "Username already taken. Please choose another one." && error.message !== "Phone number already in use. Please use a different one.") {
          toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      }
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
    }}>
      {children}
    </AuthContext.Provider>
  );
};
