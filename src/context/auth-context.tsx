
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
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getMockUserProfile = (uid: string): Partial<User> | null => {
  if (typeof window === 'undefined') return null;
  const profileStr = localStorage.getItem(`userProfile_${uid}`);
  try {
    return profileStr ? JSON.parse(profileStr) : null;
  } catch (e) {
    console.error("AuthContext: Error parsing user profile from localStorage for UID", uid, e);
    localStorage.removeItem(`userProfile_${uid}`); // Remove corrupted data
    return null;
  }
};

const saveMockUserProfile = (uid: string, profileData: Partial<User>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`userProfile_${uid}`, JSON.stringify(profileData));
};

// Helper to fetch user profile (mocked with localStorage)
const fetchMockUserProfile = async (uid: string): Promise<Partial<User> | null> => {
  return getMockUserProfile(uid);
};

// Helper to create/update user profile (mocked with localStorage)
const upsertMockUserProfile = async (uid: string, data: Partial<User>): Promise<Partial<User>> => {
  const existingProfile = getMockUserProfile(uid) || {};
  const updatedProfile = { ...existingProfile, ...data, id: uid }; // ensure id is part of profile
  saveMockUserProfile(uid, updatedProfile);
  return updatedProfile;
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const router = useRouter();
  const pathname = usePathname();
  const nextSearchParams = useNextSearchParams(); // Use the hook

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
        let localProfile = await fetchMockUserProfile(firebaseUser.uid);

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

        // Special handling for admin creator email during initial signup/login
        if (firebaseUser.email === ADMIN_CREATOR_EMAIL && !appUser.isAdmin) {
            const adminProfileData = { ...appUser, isAdmin: true, role: appUser.role || "Admin" };
            localProfile = await upsertMockUserProfile(firebaseUser.uid, adminProfileData);
            appUser = { ...appUser, ...localProfile, isAdmin: true, role: localProfile.role || "Admin" };
        } else if (firebaseUser.email === MOCK_ADMIN_EMAIL && !appUser.isAdmin) {
            // If it's the generic admin email and they aren't marked as admin in localStorage, ensure they are.
            const adminProfileData = { ...appUser, isAdmin: true, role: appUser.role || "Admin" };
            localProfile = await upsertMockUserProfile(firebaseUser.uid, adminProfileData);
            appUser = { ...appUser, ...localProfile, isAdmin: true, role: localProfile.role || "Admin" };
        }


        setUser(appUser);

        const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
        const wasNewlyCreated = firebaseUser.metadata.creationTime === firebaseUser.metadata.lastSignInTime;
        const wasSocialLogin = firebaseUser.providerData.some(pd => pd.providerId !== 'password' && pd.providerId !== 'emailLink'); // More robust check for social
        const profileCompleteParam = nextSearchParams.get('complete');


        if (!isProfileConsideredComplete && (wasNewlyCreated || wasSocialLogin || (profileCompleteParam === 'true'))) {
          if (pathname !== '/profile/settings') {
            router.push('/profile/settings?complete=true');
          }
        } else {
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
        setUser(null);
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

    if (!identifier.includes('@')) { // Assuming it's a username
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
              // console.warn("AuthContext (login): Error parsing user profile from localStorage", e);
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

    // Client-side uniqueness check for username and phone against mock localStorage
    if (typeof window !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_')) {
            try {
                const profile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
                if (profile.username === data.username) {
                  setLoading(false);
                  const errorMsg = "Username is already taken. Please choose another one.";
                  // toast({variant: "destructive", title: "Signup Failed", description: errorMsg});
                  throw new Error(errorMsg);
                }
                if (data.phoneNumber && profile.phoneNumber && profile.phoneNumber === data.phoneNumber) { // Ensure phoneNumber is defined before checking
                     setLoading(false);
                     const errorMsg = "Phone number is already in use. Please use a different one.";
                    //  toast({variant: "destructive", title: "Signup Failed", description: errorMsg});
                     throw new Error(errorMsg);
                }
            } catch (e) { /* ignore parsing errors for other keys */ }
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
              id: userCredential.uid, // Important to set id here
              displayName: data.fullName,
              email: data.email,
              username: data.username,
              role: data.role,
              phoneNumber: data.phoneNumber,
              institution: data.institution,
              researcherId: data.researcherId,
              isAdmin: data.email === MOCK_ADMIN_EMAIL || data.email === ADMIN_CREATOR_EMAIL,
            };
            await upsertMockUserProfile(userCredential.uid, initialProfileData);
            // onAuthStateChanged will pick up the new user state and trigger profile completion redirect if needed
            toast({ title: "Signup Successful!", description: "Please complete your profile if prompted."});
        } catch (profileUpdateError: any) {
            toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileUpdateError.message}. Please try updating your profile.` });
        }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // setUser(null) and localStorage removal for user profile is handled by onAuthStateChanged indirectly
      // Clearing specific items on explicit logout:
      if (user) { // Clear profile of the logged-out user
          localStorage.removeItem(`userProfile_${user.id}`);
      }
      localStorage.removeItem('redirectAfterLogin');
      router.push('/');
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. Please ensure popups are enabled for this site and try again. If you continue to experience issues, try a different browser or check your network connection.`;
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
      const result = await signInWithPopup(firebaseAuth, providerInstance);
      const firebaseUser = result.user;
      let localProfile = await fetchMockUserProfile(firebaseUser.uid);

      if (!localProfile) { // New user via social login, create a basic profile
        const initialProfile: Partial<User> = {
          id: firebaseUser.uid,
          displayName: firebaseUser.displayName,
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL,
          isAdmin: firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL,
          // username, role, phoneNumber will be null until profile completion
        };
        localProfile = await upsertMockUserProfile(firebaseUser.uid, initialProfile);
      } else { // Existing user, ensure their admin status is correct if they use special emails
         if ((firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL) && !localProfile.isAdmin) {
            localProfile = await upsertMockUserProfile(firebaseUser.uid, { ...localProfile, isAdmin: true, role: localProfile.role || "Admin" });
        }
      }
      // onAuthStateChanged handles setting the main user state and profile completion redirect
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

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser) {
      throw new Error("User not logged in. Cannot update profile.");
    }
    setLoading(true);

    try {
      // Client-side uniqueness check against mock localStorage
      if (typeof window !== 'undefined') {
        if (updatedData.username && updatedData.username !== user.username) {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (otherProfile.username === updatedData.username) {
                setLoading(false);
                const errorMsg = "Username already taken. Please choose another one.";
                // toast({variant: "destructive", title: "Update Failed", description: errorMsg}); // Handled by form
                throw new Error(errorMsg);
              }
            }
          }
        }
        if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) { // Ensure phoneNumber is defined
           for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('userProfile_') && key !== `userProfile_${user.id}`) {
              const otherProfile = JSON.parse(localStorage.getItem(key) || '{}') as Partial<User>;
              if (otherProfile.phoneNumber && otherProfile.phoneNumber === updatedData.phoneNumber) {
                setLoading(false);
                const errorMsg = "Phone number already in use. Please use a different one.";
                // toast({variant: "destructive", title: "Update Failed", description: errorMsg}); // Handled by form
                throw new Error(errorMsg);
              }
            }
          }
        }
      }


      const currentLocalProfile = await fetchMockUserProfile(user.id) || {};
      const newProfileDataForStorage: User = { // This is for localStorage
        ...user, // Start with current app user state
        ...currentLocalProfile, // Overlay with potentially more complete localStorage data
        ...updatedData, // Apply the new updates
        // Ensure core fields are not accidentally overwritten to undefined if not in updatedData
        id: user.id,
        email: user.email,
        photoURL: user.photoURL,
        isAdmin: user.isAdmin, // isAdmin cannot be changed by user update
      };

      // Update Firebase Auth profile (only displayName)
      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        newProfileDataForStorage.displayName = updatedData.displayName;
      }

      await upsertMockUserProfile(user.id, newProfileDataForStorage);
      setUser(newProfileDataForStorage); // Update context state

      // Profile completion logic after update
      if (localStorage.getItem('profileIncomplete') === 'true' || nextSearchParams.get('complete') === 'true') {
          if (newProfileDataForStorage.username && newProfileDataForStorage.role && newProfileDataForStorage.phoneNumber) {
              localStorage.removeItem('profileIncomplete');
              // No need to remove 'completingProfile' as it's not used anymore here
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname !== '/') { // Avoid pushing to / if already there
                  router.push('/');
              }
          }
      }
      return newProfileDataForStorage;
    } catch(error: any) {
      // Errors for username/phone uniqueness are thrown and caught by form.
      // Other errors will be re-thrown here.
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
