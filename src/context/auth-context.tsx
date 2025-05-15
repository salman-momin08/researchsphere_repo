
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
// Removed Firestore imports as user data is now managed via API to MongoDB
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';

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
  getIdToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const router = useRouter();
  const pathname = usePathname();

  const fetchUserProfileFromAPI = async (firebaseUid: string, idToken: string): Promise<User | null> => {
    try {
      const response = await fetch(`/api/users/${firebaseUid}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (response.ok) {
        const profileData = await response.json();
        console.log(`AuthContext: User profile fetched from MongoDB for UID ${firebaseUid}:`, JSON.stringify(profileData, null, 2));
        return {
            id: profileData._id, 
            email: profileData.email,
            displayName: profileData.displayName,
            username: profileData.username,
            photoURL: profileData.photoURL,
            phoneNumber: profileData.phoneNumber,
            institution: profileData.institution,
            role: profileData.role,
            researcherId: profileData.researcherId,
            isAdmin: profileData.isAdmin === true, 
        } as User;
      } else if (response.status === 404) {
        console.log(`AuthContext: No user profile found in MongoDB for UID ${firebaseUid}. Will attempt to create.`);
        return null; 
      } else {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`AuthContext: Error fetching user profile from API for UID ${firebaseUid}:`, response.status, errorData.message);
        toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from the database (${response.status}).`, duration: 7000 });
        return null;
      }
    } catch (error: any) {
      console.error(`AuthContext: Network or other error fetching user profile from API for UID ${firebaseUid}:`, error);
      toast({ variant: "destructive", title: "Profile Load Error", description: "A network error occurred while loading your profile.", duration: 7000 });
      return null;
    }
  };

  const createUserProfileInAPI = async (firebaseUser: FirebaseUser, idToken: string, initialData?: Partial<User>): Promise<User | null> => {
    const isInitialAdmin = firebaseUser.email === ADMIN_CREATOR_EMAIL;
    const profilePayload: Partial<User> = {
      id: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: initialData?.displayName || firebaseUser.displayName,
      photoURL: firebaseUser.photoURL || null,
      username: initialData?.username || null, 
      role: initialData?.role || null,         
      phoneNumber: initialData?.phoneNumber || firebaseUser.phoneNumber || null,
      institution: initialData?.institution || null,
      researcherId: initialData?.researcherId || null,
      isAdmin: isInitialAdmin,
    };

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(profilePayload),
      });

      const responseData = await response.json();
      if (response.ok) {
        console.log(`AuthContext: New user profile CREATED in MongoDB for ${firebaseUser.uid} with isAdmin: ${isInitialAdmin}. API Response:`, responseData);
        const createdUser = responseData.user;
        return {
            id: createdUser._id,
            email: createdUser.email,
            displayName: createdUser.displayName,
            username: createdUser.username,
            photoURL: createdUser.photoURL,
            phoneNumber: createdUser.phoneNumber,
            institution: createdUser.institution,
            role: createdUser.role,
            researcherId: createdUser.researcherId,
            isAdmin: createdUser.isAdmin === true,
        } as User;
      } else {
        console.error(`AuthContext: Error creating user profile in API for UID ${firebaseUser.uid}:`, response.status, responseData.message);
        toast({ variant: "destructive", title: "Profile Setup Error", description: responseData.message || "Could not set up your profile in the database.", duration: 7000 });
        return null;
      }
    } catch (error: any) {
      console.error(`AuthContext: Network or other error creating user profile in API for UID ${firebaseUser.uid}:`, error);
      toast({ variant: "destructive", title: "Profile Setup Error", description: "A network error occurred while setting up your profile.", duration: 7000 });
      return null;
    }
  };
  
  const getCurrentIdToken = async (): Promise<string | null> => {
    if (firebaseAuth?.currentUser) {
      try {
        return await getIdToken(firebaseAuth.currentUser, true); 
      } catch (error) {
        console.error("Error getting ID token:", error);
        return null;
      }
    }
    return null;
  };


  useEffect(() => {
    if (!firebaseAuth) {
      console.error("AuthContext: Firebase Auth service is not available.");
      setLoading(false);
      return;
    }
     // Firestore specific check (optional, depends on how db is initialized)
    const { db: firestoreDb } = require('@/lib/firebase'); // Assuming db is exported from firebase.ts
    if (!firestoreDb) {
        toast({
            variant: "destructive",
            title: "Database Connection Error",
            description: "Firestore service is not available. Please check your Firebase configuration and ensure Firestore is enabled in your project.",
            duration: 10000
        });
        // setLoading(false); // Might still set loading false, but user interaction with DB will fail
    }


    console.log("AuthContext: Setting up onAuthStateChanged listener.");
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext: onAuthStateChanged triggered. Firebase user:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        const idToken = await getCurrentIdToken();
        if (!idToken) {
            console.error("AuthContext: Could not get ID token for authenticated user. Aborting profile fetch.");
            setUser(null);
            setLoading(false);
            setActiveSocialLoginProvider(null);
            return;
        }

        let appUser = await fetchUserProfileFromAPI(firebaseUser.uid, idToken);
        const rawDocData = appUser ? { ...appUser } : null; 
        console.log(`AuthContext: User doc found for ${firebaseUser.uid}. Raw Firestore data:`, JSON.stringify(rawDocData, null, 2));
        console.log(`AuthContext: isAdmin field from Firestore for ${firebaseUser.uid}:`, rawDocData?.isAdmin, `(type: ${typeof rawDocData?.isAdmin})`);


        if (!appUser) { 
          console.log(`AuthContext: Attempting to create MongoDB profile for new Firebase Auth user ${firebaseUser.uid}`);
          appUser = await createUserProfileInAPI(firebaseUser, idToken, {
            displayName: firebaseUser.displayName, 
            username: null, // Social logins won't provide username at this stage
            role: null,     // Or a default role if applicable
          });
        }
        
        if (appUser) {
            let mongoUpdates: Partial<User> = {};
            if (firebaseUser.displayName && firebaseUser.displayName !== appUser.displayName && !appUser.displayName) {
                mongoUpdates.displayName = firebaseUser.displayName;
            }
             if (firebaseUser.photoURL && firebaseUser.photoURL !== appUser.photoURL && !appUser.photoURL) {
                mongoUpdates.photoURL = firebaseUser.photoURL;
            }
            if (Object.keys(mongoUpdates).length > 0) {
                try {
                    // No direct API call here as updateUserProfile is meant for user-initiated updates
                    // and might have different logic. If auto-syncing basic Firebase info is needed,
                    // it implies the createUserProfileInAPI or fetchUserProfileFromAPI should handle this.
                    // For now, we assume the initial fetch/create is sufficient.
                    // If this sync is critical, we'd need a dedicated internal sync function.
                    console.log(`AuthContext: Firebase Auth details (displayName/photoURL) might need sync to MongoDB for ${appUser.id}. Current appUser:`, appUser);
                } catch (syncError) {
                     console.error(`AuthContext: Error syncing Firebase Auth details to MongoDB for ${appUser.id}:`, syncError);
                }
            }

            const finalAppUser = {
              ...appUser,
              isAdmin: appUser.isAdmin === true, // Ensure boolean
            };

            console.log(`AuthContext: Hydrated appUser for ${finalAppUser.id} (resulting isAdmin: ${finalAppUser.isAdmin}):`, JSON.stringify(finalAppUser, null, 2));
            setUser(finalAppUser);
            setShowLoginModal(false);

            const isProfileComplete = finalAppUser.username && finalAppUser.role;
            const completingProfile = localStorage.getItem('completingProfile') === 'true';

            if (!isProfileComplete && pathname !== '/profile/settings') {
              localStorage.setItem('profileIncomplete', 'true');
              router.push('/profile/settings?complete=true');
            } else if (isProfileComplete && completingProfile) {
                localStorage.removeItem('profileIncomplete');
                localStorage.removeItem('completingProfile');
                const redirectPath = localStorage.getItem('redirectAfterLogin');
                 if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                    localStorage.removeItem('redirectAfterLogin');
                    router.push(redirectPath);
                } else {
                    router.push('/'); // Default to home if no specific redirect
                }
            } else if (isProfileComplete && !completingProfile) {
                localStorage.removeItem('profileIncomplete');
                const redirectPath = localStorage.getItem('redirectAfterLogin');
                if (redirectPath && redirectPath !== pathname) {
                    localStorage.removeItem('redirectAfterLogin');
                    router.push(redirectPath);
                }
                 // If no redirectPath, user stays on the current page (page refresh scenario)
            }


        } else {
            console.error("AuthContext: Failed to fetch or create user profile in MongoDB. Logging out Firebase user.");
            if (firebaseAuth) await signOut(firebaseAuth); 
            setUser(null);
        }

      } else {
        console.log("AuthContext: No Firebase user session found.");
        setUser(null);
        localStorage.removeItem('profileIncomplete');
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('completingProfile');
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });
    return () => {
      console.log("AuthContext: Cleaning up onAuthStateChanged listener.");
      unsubscribe();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, pathname]); // Removed direct dependency on pathname to avoid loops on every route change if not needed. Re-add if specific path-dependent logic is inside.


  const login = async (email: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, pass);
      // onAuthStateChanged handles successful login flow (setting user, redirecting)
      localStorage.setItem('redirectAfterLogin', '/');
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
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    setLoading(true);
    
    // Check username uniqueness with API
    try {
        const usernameCheckResponse = await fetch(`/api/users/check-username?username=${encodeURIComponent(data.username)}`);
        if (usernameCheckResponse.ok) {
            const { isTaken } = await usernameCheckResponse.json();
            if (isTaken) {
                setLoading(false);
                throw new Error("Username already taken. Please choose another one.");
            }
        } else {
             setLoading(false);
             throw new Error("Could not verify username uniqueness. Please try again.");
        }
    } catch(error: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Signup Error", description: error.message });
        throw error;
    }
    // Check phone number uniqueness if provided
    if (data.phoneNumber) {
        try {
            const phoneCheckResponse = await fetch(`/api/users/check-phone?phone=${encodeURIComponent(data.phoneNumber)}`);
            if (phoneCheckResponse.ok) {
                const { isTaken } = await phoneCheckResponse.json();
                if (isTaken) {
                    setLoading(false);
                    throw new Error("Phone number already in use. Please use a different one.");
                }
            } else {
                setLoading(false);
                throw new Error("Could not verify phone number uniqueness. Please try again.");
            }
        } catch(error: any) {
            setLoading(false);
            toast({ variant: "destructive", title: "Signup Error", description: error.message });
            throw error;
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
          case 'auth/invalid-email':
              errorMessage = 'The email address is not valid.';
              break;
          case 'auth/operation-not-allowed':
              errorMessage = 'Email/password accounts are not enabled.';
              break;
          case 'auth/weak-password':
              errorMessage = 'The password is too weak.';
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
        } catch (profileUpdateError) {
            console.warn("AuthContext: Could not update Firebase Auth display name during signup:", profileUpdateError);
            toast({ variant: "default", title: "Profile Info", description: "Could not set display name in Firebase Auth immediately." });
        }
        
        const idToken = await getCurrentIdToken();
        if (idToken) {
            const createdApiUser = await createUserProfileInAPI(firebaseUser, idToken, {
              displayName: data.fullName,
              username: data.username,
              role: data.role,
              phoneNumber: data.phoneNumber,
              institution: data.institution,
              researcherId: data.researcherId,
            });
            if (!createdApiUser) {
                console.warn(`AuthContext: Signup for Firebase Auth user ${firebaseUser.uid} done, but MongoDB profile creation via API failed/returned null.`);
            }
            localStorage.setItem('redirectAfterLogin', '/'); // Redirect to home after signup
        } else {
            console.error("AuthContext: Signup - Could not get ID token after Firebase Auth user creation. MongoDB profile creation deferred to onAuthStateChanged.");
        }
        // onAuthStateChanged will handle the final state setting and redirection.
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // setUser(null) is handled by onAuthStateChanged
      localStorage.removeItem('redirectAfterLogin');
      localStorage.removeItem('profileIncomplete');
      localStorage.removeItem('completingProfile');
      router.push('/'); 
      // Explicitly setting user to null here to ensure immediate UI update before onAuthStateChanged might fire
      setUser(null);
    } catch (error) {
      console.error("Logout error:", error);
      toast({variant: "destructive", title: "Logout Failed", description: "Could not log out."});
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
          toastMessage = `The ${providerName} sign-in popup was closed before completing. If you have popup blockers, please disable them for this site. Alternatively, you can try the redirect-based sign-in if popups continue to be an issue.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000, 
          });
          // No longer return here, let finally block handle state reset
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = 'Account Conflict';
          toastMessage = `An account already exists with the same email address but different sign-in credentials. Try signing in with the original method associated with this email.`;
          break;
        case 'auth/auth-domain-config-required':
          toastTitle = 'Configuration Error';
          toastMessage = `Firebase auth domain configuration is missing. Please contact support.`;
          break;
        case 'auth/operation-not-allowed':
          toastTitle = 'Login Method Disabled';
          toastMessage = `${providerName} sign-in is not enabled for this app. Please contact support.`;
          break;
        case 'auth/popup-blocked':
          toastTitle = 'Popup Blocked';
          toastMessage = `The ${providerName} sign-in popup was blocked by your browser. Please allow popups for this site and try again.`;
          break;
        case 'auth/unauthorized-domain':
           toastTitle = 'Domain Not Authorized';
           toastMessage = `This domain is not authorized for ${providerName} sign-in. Please contact support.`;
           break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    // Ensure loading states are reset in a finally block of the calling function
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    toast({ title: `Initiating ${providerName} Sign-In`, description: `A popup window should appear.` });
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      localStorage.setItem('redirectAfterLogin', '/'); // Redirect to home after social login
      localStorage.setItem('completingProfile', 'true'); // Flag to potentially redirect to profile completion
      // onAuthStateChanged will handle the rest
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      // Reset loading states regardless of success or failure, onAuthStateChanged will manage final state
      // setLoading(false); // onAuthStateChanged will set loading to false eventually
      setActiveSocialLoginProvider(null); // Reset the specific provider lock
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
      setLoading(false);
      throw new Error("User not logged in. Cannot update profile.");
    }
    const idToken = await getCurrentIdToken();
    if (!idToken) {
        setLoading(false);
        throw new Error("Could not get authentication token. Please try again.");
    }
    setLoading(true);

    // If username is being updated, check for uniqueness first
    if (updatedData.username && updatedData.username !== user.username) {
        try {
            const usernameCheckResponse = await fetch(`/api/users/check-username?username=${encodeURIComponent(updatedData.username)}&userId=${user.id}`);
            if (usernameCheckResponse.ok) {
                const { isTaken } = await usernameCheckResponse.json();
                if (isTaken) {
                    setLoading(false);
                    throw new Error("Username already taken. Please choose another one.");
                }
            } else {
                 setLoading(false);
                 throw new Error("Could not verify username uniqueness for update. Please try again.");
            }
        } catch(error: any) {
            setLoading(false);
            throw error; // Rethrow to be caught by the main try-catch
        }
    }
    // If phone number is being updated, check for uniqueness first
    if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
         try {
            const phoneCheckResponse = await fetch(`/api/users/check-phone?phone=${encodeURIComponent(updatedData.phoneNumber)}&userId=${user.id}`);
            if (phoneCheckResponse.ok) {
                const { isTaken } = await phoneCheckResponse.json();
                if (isTaken) {
                    setLoading(false);
                    throw new Error("Phone number already in use. Please use a different one.");
                }
            } else {
                 setLoading(false);
                 throw new Error("Could not verify phone number uniqueness for update. Please try again.");
            }
        } catch(error: any) {
            setLoading(false);
            throw error; // Rethrow to be caught by the main try-catch
        }
    }


    try {
      const payload = { ...updatedData };
      // Ensure isAdmin is not sent from client
      if ('isAdmin' in payload) {
        delete (payload as any).isAdmin;
      }


      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(payload),
      });
      
      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData.message || "Failed to update profile via API.");
      }
      
      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        try {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        } catch (authProfileError) {
          console.warn("AuthContext: Could not update Firebase Auth display name during profile update:", authProfileError);
        }
      }
      
      const updatedUserFromApi = responseData.user;
      const finalUpdatedUser: User = {
        id: updatedUserFromApi._id,
        email: user.email, 
        displayName: updatedUserFromApi.displayName,
        username: updatedUserFromApi.username,
        photoURL: user.photoURL, 
        phoneNumber: updatedUserFromApi.phoneNumber,
        institution: updatedUserFromApi.institution,
        role: updatedUserFromApi.role,
        researcherId: updatedUserFromApi.researcherId,
        isAdmin: user.isAdmin, 
      };

      setUser(finalUpdatedUser); 
      setLoading(false);

      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (finalUpdatedUser.username && finalUpdatedUser.role) { 
              localStorage.removeItem('profileIncomplete');
              localStorage.removeItem('completingProfile'); // Also clear this flag
              // Redirect logic now handled by onAuthStateChanged or the profile page itself
          }
      }
      return finalUpdatedUser;
    } catch(error: any) {
      setLoading(false);
      console.error("Error updating profile via API:", error);
      throw new Error(error.message || "Failed to update profile.");
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
        getIdToken: getCurrentIdToken
    }}>
      {children}
    </AuthContext.Provider>
  );
};
