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
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: null | 'google' | 'github'; // More specific type
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
      if (firebaseUser) {
        const localProfile = getMockUserProfile(firebaseUser.uid);
        
        const effectiveDisplayName = localProfile?.displayName || firebaseUser.displayName || "User";
        const effectivePhotoURL = localProfile?.photoURL || firebaseUser.photoURL || null;
        
        let appUser: User = {
          id: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: effectiveDisplayName,
          photoURL: effectivePhotoURL,
          isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL || localProfile?.isAdmin === true,
          username: localProfile?.username || null,
          role: localProfile?.role || null,
          phoneNumber: localProfile?.phoneNumber || null,
          institution: localProfile?.institution || null,
          researcherId: localProfile?.researcherId || null,
        };

        if ((firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL) && appUser.isAdmin !== true) {
            const adminProfile = { ...appUser, isAdmin: true, role: appUser.role || "Admin" };
            saveMockUserProfile(firebaseUser.uid, adminProfile);
            appUser = { ...appUser, ...adminProfile };
        }
        
        setUser(appUser);
        
        const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
        const wasCompletingProfile = localStorage.getItem('completingProfile') === 'true';

        if (!isProfileConsideredComplete && (firebaseUser.metadata.creationTime === firebaseUser.metadata.lastSignInTime || firebaseUser.providerData.some(pd => pd.providerId !== 'password') || wasCompletingProfile)) {
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
          } else if (isProfileConsideredComplete && (pathname === '/login' || pathname === '/signup' || (pathname === '/profile/settings' && !searchParams.get('complete')))) {
             router.push('/');
          }
        }
        setShowLoginModal(false); // Close modal if open
      } else {
        setUser(null);
        localStorage.removeItem('completingProfile');
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router]); // Added searchParams for conditional redirect from profile/settings

  const searchParams = usePathname() ? new URLSearchParams(window.location.search) : new URLSearchParams();


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
    // setLoading(false) is handled by onAuthStateChanged
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);

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
              email: data.email, 
              username: data.username,
              role: data.role,
              phoneNumber: data.phoneNumber,
              institution: data.institution,
              researcherId: data.researcherId,
              isAdmin: data.email === MOCK_ADMIN_EMAIL || data.email === ADMIN_CREATOR_EMAIL,
            };
            saveMockUserProfile(userCredential.uid, initialProfileData);
            // onAuthStateChanged will pick up the new user state, set user, and trigger profile completion redirect
            toast({ title: "Signup Successful!", description: "Please complete your profile."});
             // No router.push('/') here, onAuthStateChanged handles it
        } catch (profileUpdateError) {
            toast({ variant: "destructive", title: "Signup Incomplete", description: "Account created, but profile setup had an issue. Please try updating your profile." });
        }
    }
    // setLoading(false) is handled by onAuthStateChanged
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // setUser(null); // onAuthStateChanged will handle this
      localStorage.removeItem('redirectAfterLogin');
      localStorage.removeItem('profileIncomplete');
      localStorage.removeItem('completingProfile');
      router.push('/'); // Redirect to home on logout
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error: any) {
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
          toastMessage = `The ${providerName} sign-in popup was closed before completing. Please ensure popups are enabled and try again. If the issue persists, you might consider trying a different browser or network.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 10000, 
          });
          break; // Break here so it doesn't fall through
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
    setLoading(false); // Ensure loading is reset on error
    setActiveSocialLoginProvider(null); // Reset active provider on error
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
        isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL || localProfile?.isAdmin === true,
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
                throw new Error(errorMsg);
              }
            }
          }
        }
      }

      const currentLocalProfile = getMockUserProfile(user.id) || {};
      const newProfileData: User = {
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
        newProfileData.displayName = updatedData.displayName; 
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
                  router.push('/'); 
              }
          }
      }
      return newProfileData;
    } catch(error: any) {
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
        isSocialLoginInProgress: activeSocialLoginProvider,
    }}>
      {children}
    </AuthContext.Provider>
  );
};