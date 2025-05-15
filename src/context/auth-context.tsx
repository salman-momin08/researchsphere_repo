
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
  type User as FirebaseUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'; // Kept for potential future use if specific alerts are needed here
import { Info } from 'lucide-react'; // Kept for potential future use

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

const getMockUserProfile = (uid: string): Partial<User> | null => {
  if (typeof window === 'undefined') return null;
  const profileStr = localStorage.getItem(`userProfile_${uid}`);
  return profileStr ? JSON.parse(profileStr) : null;
};

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
      console.log("AuthContext: onAuthStateChanged triggered. Firebase user UID:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        const localProfile = getMockUserProfile(firebaseUser.uid);
        const effectiveDisplayName = localProfile?.displayName || firebaseUser.displayName || "User";
        const effectivePhotoURL = localProfile?.photoURL || firebaseUser.photoURL || null;
        const effectivePhoneNumber = localProfile?.phoneNumber || null; // Prioritize localProfile for phone as Firebase doesn't always have it

        const isNewlyCreatedUser = firebaseUser.metadata.creationTime === firebaseUser.metadata.lastSignInTime;
        const isSocialLoginUser = firebaseUser.providerData.some(pd => pd.providerId !== 'password');

        let appUser: User = {
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

        if ((effectiveDisplayName && effectiveDisplayName !== firebaseUser.displayName && !localProfile?.displayName) || 
            (effectivePhotoURL && effectivePhotoURL !== firebaseUser.photoURL && !localProfile?.photoURL)) {
            try {
                await updateFirebaseProfile(firebaseUser, { displayName: effectiveDisplayName, photoURL: effectivePhotoURL });
                console.log("AuthContext: Synced Firebase Auth profile (displayName/photoURL) from social provider for UID:", firebaseUser.uid);
                if (localProfile) {
                    saveMockUserProfile(firebaseUser.uid, { ...localProfile, displayName: effectiveDisplayName, photoURL: effectivePhotoURL });
                } else {
                     saveMockUserProfile(firebaseUser.uid, { displayName: effectiveDisplayName, photoURL: effectivePhotoURL, email: firebaseUser.email });
                }
            } catch (profileSyncError) {
                console.warn("AuthContext: Error syncing social profile to Firebase Auth:", profileSyncError);
            }
        } else if (localProfile) { // Ensure local profile takes precedence for display name if it exists
            appUser.displayName = localProfile.displayName || appUser.displayName;
        }


        if ((firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL) && localProfile?.isAdmin !== true) {
            const adminProfile = { ...localProfile, isAdmin: true, role: localProfile?.role || "Admin" };
            saveMockUserProfile(firebaseUser.uid, adminProfile);
            appUser = { ...appUser, ...adminProfile };
        }
        
        console.log("AuthContext: Raw localProfile from localStorage for UID", firebaseUser.uid, ":", localProfile);
        console.log("AuthContext: Effective appUser state for UID", firebaseUser.uid, ":", appUser);

        setUser(appUser);
        setShowLoginModal(false);

        const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
        const wasCompletingProfile = localStorage.getItem('completingProfile') === 'true';

        if (!isProfileConsideredComplete && (isNewlyCreatedUser || isSocialLoginUser || wasCompletingProfile)) {
          localStorage.setItem('profileIncomplete', 'true');
          localStorage.setItem('completingProfile', 'true');
          if (pathname !== '/profile/settings') {
            router.push('/profile/settings?complete=true');
          }
        } else {
          localStorage.removeItem('profileIncomplete');
          localStorage.removeItem('completingProfile');
          const redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
          if (redirectAfterLoginPath && redirectAfterLoginPath !== pathname) {
            localStorage.removeItem('redirectAfterLogin');
            router.push(redirectAfterLoginPath);
          } else if (pathname === '/login' || pathname === '/signup' || pathname === '/profile/settings') {
            // If profile is complete and user is on an auth page, redirect to home
            router.push('/');
          }
        }
      } else {
        setUser(null);
        localStorage.removeItem('completingProfile'); // Clear if logged out
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => unsubscribe();
  }, [router, pathname]);

  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
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
        emailToLogin = foundEmailForUsername;
      } else {
        setLoading(false);
        const errorMsg = "User not found with this username. Check username or try logging in with email.";
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
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

    if (typeof window !== 'undefined') {
        // Check username uniqueness
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
                if (data.phoneNumber && profile.phoneNumber && profile.phoneNumber === data.phoneNumber) {
                     setLoading(false);
                     const errorMsg = "Phone number is already in use. Please use a different one.";
                     toast({variant: "destructive", title: "Signup Failed", description: errorMsg});
                     throw new Error(errorMsg);
                }
            } catch (e) { /* ignore */ }
            }
        }
    }


    let userCredential: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      userCredential = cred.user;
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
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (userCredential) {
        try {
            await updateFirebaseProfile(userCredential, { displayName: data.fullName });
            const initialProfileData: Partial<User> = {
              displayName: data.fullName,
              email: data.email, // Store email for username lookup
              username: data.username,
              role: data.role,
              phoneNumber: data.phoneNumber,
              institution: data.institution,
              researcherId: data.researcherId,
              isAdmin: data.email === MOCK_ADMIN_EMAIL || data.email === ADMIN_CREATOR_EMAIL,
            };
            saveMockUserProfile(userCredential.uid, initialProfileData);
            // onAuthStateChanged will pick up the new user state, set user, and trigger profile completion redirect
            toast({ title: "Signup Successful!", description: "Welcome to ResearchSphere! Please complete your profile."});
        } catch (profileUpdateError) {
            toast({ variant: "destructive", title: "Signup Incomplete", description: "Account created, but profile setup had an issue. Please try updating your profile." });
             // User is created in Firebase Auth, but local mock profile might be incomplete.
             // onAuthStateChanged will still run.
        }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      //setUser(null); // onAuthStateChanged will handle this
      localStorage.removeItem('redirectAfterLogin');
      localStorage.removeItem('profileIncomplete');
      localStorage.removeItem('completingProfile');
      // Optionally, clear all userProfile_ items from localStorage if desired,
      // but Firebase Auth state is the primary source of truth.
      router.push('/');
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
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
          toastMessage = `The ${providerName} sign-in process was cancelled or the popup was closed. Please try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 7000, // Shorter duration for this specific informational error
          });
          return;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Try that method or use a different email.";
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
      const firebaseUser = result.user;
      const localProfile = getMockUserProfile(firebaseUser.uid);

      const initialProfile: Partial<User> = {
        displayName: firebaseUser.displayName,
        email: firebaseUser.email,
        photoURL: firebaseUser.photoURL,
        isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL || localProfile?.isAdmin === true,
        // Preserve existing mock profile details if they exist
        username: localProfile?.username || null,
        role: localProfile?.role || null,
        phoneNumber: localProfile?.phoneNumber || null,
        institution: localProfile?.institution || null,
        researcherId: localProfile?.researcherId || null,
      };
      saveMockUserProfile(firebaseUser.uid, initialProfile);
      // onAuthStateChanged handles setting user and redirect/profile completion logic
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setLoading(false) and setActiveSocialLoginProvider(null) handled by onAuthStateChanged or error handler
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
      if (typeof window !== 'undefined') {
        if (updatedData.username && updatedData.username !== user.username) {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (otherProfile.username === updatedData.username) {
                setLoading(false);
                const errorMsg = "Username already taken. Please choose another one.";
                // toast({ variant: "destructive", title: "Update Failed", description: errorMsg }); // Error handled by form
                throw new Error(errorMsg);
              }
            }
          }
        }
        if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (otherProfile.phoneNumber && otherProfile.phoneNumber === updatedData.phoneNumber) {
                setLoading(false);
                const errorMsg = "Phone number already in use. Please use a different one.";
                // toast({ variant: "destructive", title: "Update Failed", description: errorMsg }); // Error handled by form
                throw new Error(errorMsg);
              }
            }
          }
        }
      }

      const currentLocalProfile = getMockUserProfile(user.id) || {};
      const newProfileData: User = {
        ...user, // Start with current context user state
        ...currentLocalProfile, // Overlay with stored local profile
        ...updatedData, // Apply updates from form
        id: user.id,
        email: user.email,
        photoURL: user.photoURL, // photoURL typically not updated this way
        isAdmin: user.isAdmin, // isAdmin cannot be changed by user via this form
      };

      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        newProfileData.displayName = updatedData.displayName; // Ensure it's updated in our user object
      }

      saveMockUserProfile(user.id, newProfileData);
      setUser(newProfileData);

      if (localStorage.getItem('profileIncomplete') === 'true' || localStorage.getItem('completingProfile') === 'true') {
          if (newProfileData.username && newProfileData.role && newProfileData.phoneNumber) {
              localStorage.removeItem('profileIncomplete');
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else {
                  router.push('/'); // Default to home if profile complete
              }
          }
      }
      return newProfileData;
    } catch(error: any) {
      if (error.message !== "Username already taken. Please choose another one." && error.message !== "Phone number already in use. Please use a different one.") {
          toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      }
      throw error; // Re-throw for form to handle
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
