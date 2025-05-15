
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

  const getCurrentIdToken = async (): Promise<string | null> => {
    if (firebaseAuth?.currentUser) {
      try {
        const token = await getIdToken(firebaseAuth.currentUser, true);
        console.log("AuthContext (getCurrentIdToken): Token fetched successfully.");
        return token;
      } catch (error) {
        console.error("AuthContext (getCurrentIdToken): Error getting ID token:", error);
        return null;
      }
    }
    console.warn("AuthContext (getCurrentIdToken): No current user, cannot get ID token.");
    return null;
  };

  const fetchUserProfileFromAPI = async (firebaseUid: string, idToken: string): Promise<User | null> => {
    console.log(`AuthContext (fetchUserProfileFromAPI): Fetching profile for UID ${firebaseUid} using token (first 20 chars): ${idToken.substring(0,20)}...`);
    try {
      const response = await fetch(`/api/users/${firebaseUid}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (response.ok) {
        const profileData = await response.json();
        console.log(`AuthContext (fetchUserProfileFromAPI): User profile fetched from MongoDB for UID ${firebaseUid}. Raw data:`, JSON.stringify(profileData, null, 2));
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
        console.log(`AuthContext (fetchUserProfileFromAPI): No user profile found in MongoDB for UID ${firebaseUid}. Will attempt to create.`);
        return null; 
      } else {
        const errorText = await response.text(); // Get raw text in case JSON parsing fails
        console.error(`AuthContext (fetchUserProfileFromAPI): Error fetching user profile from API for UID ${firebaseUid}. Status: ${response.status}. Response: ${errorText}`);
        toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from the database (${response.status}).`, duration: 7000 });
        return null;
      }
    } catch (error: any) {
      console.error(`AuthContext (fetchUserProfileFromAPI): Network or other error fetching user profile from API for UID ${firebaseUid}:`, error);
      toast({ variant: "destructive", title: "Profile Load Error", description: "A network error occurred while loading your profile.", duration: 7000 });
      return null;
    }
  };

  const createUserProfileInAPI = async (firebaseUser: FirebaseUser, idToken: string, initialData?: Partial<User>): Promise<User | null> => {
    console.log(`AuthContext (createUserProfileInAPI): Creating MongoDB profile for new Firebase Auth user ${firebaseUser.uid} using token (first 20 chars): ${idToken.substring(0,20)}...`);
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
    console.log("AuthContext (createUserProfileInAPI): Profile payload for API:", profilePayload);

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
        console.log(`AuthContext (createUserProfileInAPI): New user profile CREATED in MongoDB for ${firebaseUser.uid}. API Response:`, responseData);
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
        console.error(`AuthContext (createUserProfileInAPI): Error creating user profile in API for UID ${firebaseUser.uid}. Status: ${response.status}. API Response:`, responseData);
        toast({ variant: "destructive", title: "Profile Setup Error", description: responseData.message || "Could not set up your profile in the database.", duration: 7000 });
        return null;
      }
    } catch (error: any) {
      console.error(`AuthContext (createUserProfileInAPI): Network or other error creating user profile in API for UID ${firebaseUser.uid}:`, error);
      toast({ variant: "destructive", title: "Profile Setup Error", description: "A network error occurred while setting up your profile.", duration: 7000 });
      return null;
    }
  };
  
  useEffect(() => {
    if (!firebaseAuth) {
      console.error("AuthContext: Firebase Auth service is not available. Aborting onAuthStateChanged setup.");
      setLoading(false);
      return;
    }

    console.log("AuthContext: Setting up onAuthStateChanged listener.");
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext: onAuthStateChanged triggered. Firebase user UID:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        const idToken = await getCurrentIdToken();
        if (!idToken) {
            console.error("AuthContext: Could not get ID token for authenticated Firebase user. Cannot proceed with profile fetch/create.");
            setUser(null);
            setLoading(false);
            setActiveSocialLoginProvider(null);
            return;
        }

        let appUser = await fetchUserProfileFromAPI(firebaseUser.uid, idToken);
        
        if (!appUser && firebaseUser.uid) { 
          console.log(`AuthContext: No existing MongoDB profile for UID ${firebaseUser.uid}. Attempting to create one.`);
          appUser = await createUserProfileInAPI(firebaseUser, idToken, {
            displayName: firebaseUser.displayName, 
            username: null,
            role: null,     
          });
        }
        
        if (appUser) {
            const finalAppUser: User = {
              id: appUser.id,
              email: appUser.email,
              displayName: appUser.displayName,
              username: appUser.username,
              photoURL: firebaseUser.photoURL || appUser.photoURL, // Prioritize fresh photoURL from Firebase Auth
              isAdmin: appUser.isAdmin === true, 
              phoneNumber: appUser.phoneNumber,
              institution: appUser.institution,
              role: appUser.role,
              researcherId: appUser.researcherId,
            };
            console.log(`AuthContext: Successfully hydrated appUser for ${finalAppUser.id} (isAdmin: ${finalAppUser.isAdmin}). User object:`, JSON.stringify(finalAppUser, null, 2));
            setUser(finalAppUser);
            setShowLoginModal(false);

            const isProfileComplete = finalAppUser.username && finalAppUser.role;
            const completingProfile = localStorage.getItem('completingProfile') === 'true';

            if (!isProfileComplete && pathname !== '/profile/settings') {
              console.log("AuthContext: Profile incomplete, redirecting to /profile/settings?complete=true");
              localStorage.setItem('profileIncomplete', 'true');
              router.push('/profile/settings?complete=true');
            } else if (isProfileComplete && completingProfile) {
                console.log("AuthContext: Profile complete and was completing. Clearing flags.");
                localStorage.removeItem('profileIncomplete');
                localStorage.removeItem('completingProfile');
                const redirectPath = localStorage.getItem('redirectAfterLogin');
                if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                    console.log(`AuthContext: Redirecting to stored path: ${redirectPath}`);
                    localStorage.removeItem('redirectAfterLogin');
                    router.push(redirectPath);
                } else if (pathname === '/profile/settings' || pathname === '/login' || pathname === '/signup'){
                    console.log("AuthContext: Profile complete, currently on settings/login/signup. Redirecting to /");
                    router.push('/');
                } else {
                    console.log("AuthContext: Profile complete. No specific redirect needed or already on target page.");
                }
            } else if (isProfileComplete && !completingProfile) {
                console.log("AuthContext: Profile complete. Checking for redirectAfterLogin.");
                localStorage.removeItem('profileIncomplete');
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
            console.error("AuthContext: Failed to fetch or create user profile in MongoDB. Logging out Firebase user (UID:", firebaseUser.uid, ").");
            if (firebaseAuth) await signOut(firebaseAuth).catch(e => console.error("AuthContext: Error during signOut after profile failure:", e)); 
            setUser(null);
        }
      } else {
        console.log("AuthContext: No Firebase user session found (firebaseUser is null). Clearing local user state.");
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
  }, [router, pathname]); 


  const login = async (email: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    console.log(`AuthContext (login): Attempting login for email: ${email}`);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, pass);
      // onAuthStateChanged handles successful login flow (setting user, API sync, redirecting)
      localStorage.setItem('redirectAfterLogin', '/'); // Default redirect to home page
      console.log(`AuthContext (login): Firebase login successful for ${email}. onAuthStateChanged will handle next steps.`);
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
    // setLoading(false) is handled by onAuthStateChanged
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    console.log(`AuthContext (signup): Attempting signup for email: ${data.email}, username: ${data.username}`);
    setLoading(true);
    
    const idTokenForChecks = await getCurrentIdToken(); // Get token if already logged in (unlikely in signup, but good for generic check calls)

    try {
        const usernameCheckResponse = await fetch(`/api/users/check-username?username=${encodeURIComponent(data.username)}`, {
             headers: idTokenForChecks ? { 'Authorization': `Bearer ${idTokenForChecks}` } : {}
        });
        if (usernameCheckResponse.ok) {
            const { isTaken } = await usernameCheckResponse.json();
            if (isTaken) {
                setLoading(false);
                console.warn(`AuthContext (signup): Username ${data.username} is already taken.`);
                throw new Error("Username already taken. Please choose another one.");
            }
        } else {
             setLoading(false);
             const errorText = await usernameCheckResponse.text();
             console.error(`AuthContext (signup): Username uniqueness check API call failed. Status: ${usernameCheckResponse.status}, Response: ${errorText}`);
             throw new Error("Could not verify username uniqueness. Please try again.");
        }
    } catch(error: any) {
        setLoading(false);
        toast({ variant: "destructive", title: "Signup Error", description: error.message });
        throw error;
    }

    if (data.phoneNumber) {
        try {
            const phoneCheckResponse = await fetch(`/api/users/check-phone?phone=${encodeURIComponent(data.phoneNumber)}`, {
                headers: idTokenForChecks ? { 'Authorization': `Bearer ${idTokenForChecks}` } : {}
            });
            if (phoneCheckResponse.ok) {
                const { isTaken } = await phoneCheckResponse.json();
                if (isTaken) {
                    setLoading(false);
                    console.warn(`AuthContext (signup): Phone number ${data.phoneNumber} is already taken.`);
                    throw new Error("Phone number already in use. Please use a different one.");
                }
            } else {
                setLoading(false);
                const errorText = await phoneCheckResponse.text();
                console.error(`AuthContext (signup): Phone number uniqueness check API call failed. Status: ${phoneCheckResponse.status}, Response: ${errorText}`);
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
      console.log(`AuthContext (signup): Firebase Auth user created for ${data.email}. UID: ${userCredential.user.uid}`);
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
      console.error(`AuthContext (signup): Firebase Auth creation failed for ${data.email}. Error: ${errorMessage}`, authError);
      toast({ variant: "destructive", title: "Firebase Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
    
    const firebaseUser = userCredential.user;
    if (firebaseUser) {
        try {
            await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
            console.log(`AuthContext (signup): Updated Firebase Auth display name for ${firebaseUser.uid} to ${data.fullName}`);
        } catch (profileUpdateError) {
            console.warn("AuthContext (signup): Could not update Firebase Auth display name during signup:", profileUpdateError);
            // Non-critical, proceed with MongoDB profile creation
        }
        
        // Get a fresh token for the newly created user for API calls
        const idToken = await getIdToken(firebaseUser, true); 
        if (idToken) {
            console.log(`AuthContext (signup): Got ID token for new user ${firebaseUser.uid}. Proceeding to create MongoDB profile.`);
            // createUserProfileInAPI will be called by onAuthStateChanged
        } else {
            console.error("AuthContext (signup): Could not get ID token for newly created Firebase user. MongoDB profile creation will be handled by onAuthStateChanged if token becomes available.");
        }
        localStorage.setItem('redirectAfterLogin', '/'); 
        // onAuthStateChanged handles the final state setting and redirection.
    }
    // setLoading(false) handled by onAuthStateChanged
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    console.log("AuthContext (logout): Attempting logout.");
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      console.log("AuthContext (logout): Firebase signOut successful. onAuthStateChanged will clear local state.");
      localStorage.removeItem('redirectAfterLogin');
      localStorage.removeItem('profileIncomplete');
      localStorage.removeItem('completingProfile');
      router.push('/'); 
      setUser(null); // Explicitly clear user state immediately for faster UI update
    } catch (error) {
      console.error("AuthContext (logout): Logout error:", error);
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
          toastMessage = `The ${providerName} sign-in popup was closed or cancelled. If you have popup blockers, please disable them for this site and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000, 
          });
          break; // Break here, specific handling for this case
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
           toastMessage = `This domain is not authorized for ${providerName} sign-in. Please check your Firebase project's authorized domains settings.`;
           break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    if (firebaseError.code !== 'auth/popup-closed-by-user' && firebaseError.code !== 'auth/cancelled-popup-request') {
      toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    }
    console.error(`AuthContext (handleSocialLoginError - ${providerName}): Error: ${firebaseError.message}`, firebaseError);
    // Reset loading states in the calling function's finally block
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    toast({ title: `Initiating ${providerName} Sign-In`, description: `A popup window should appear. Please ensure popups are allowed for this site.` });
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    console.log(`AuthContext (processSocialLogin): Initiating ${providerName} login.`);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      console.log(`AuthContext (processSocialLogin): ${providerName} signInWithPopup successful. onAuthStateChanged will handle next steps.`);
      localStorage.setItem('redirectAfterLogin', '/');
      localStorage.setItem('completingProfile', 'true'); 
    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      // setLoading(false) and setActiveSocialLoginProvider(null) are handled by onAuthStateChanged's final block
    }
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
      console.error("AuthContext (updateUserProfile): User not logged in or Firebase currentUser not available.");
      setLoading(false);
      throw new Error("User not logged in. Cannot update profile.");
    }
    const idToken = await getCurrentIdToken();
    if (!idToken) {
        console.error("AuthContext (updateUserProfile): Could not get authentication token.");
        setLoading(false);
        throw new Error("Could not get authentication token. Please try again.");
    }
    console.log(`AuthContext (updateUserProfile): Updating profile for user ${user.id}. Data:`, updatedData);
    setLoading(true);

    const payload = { ...updatedData };
    if ('isAdmin' in payload) {
      console.warn("AuthContext (updateUserProfile): Attempt to update isAdmin field ignored.");
      delete (payload as any).isAdmin;
    }
    
    if (payload.username && payload.username !== user.username) {
        try {
            const usernameCheckResponse = await fetch(`/api/users/check-username?username=${encodeURIComponent(payload.username)}&userId=${user.id}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (usernameCheckResponse.ok) {
                const { isTaken } = await usernameCheckResponse.json();
                if (isTaken) {
                    setLoading(false);
                    console.warn(`AuthContext (updateUserProfile): Username ${payload.username} is already taken.`);
                    throw new Error("Username already taken. Please choose another one.");
                }
            } else {
                 setLoading(false);
                 const errorText = await usernameCheckResponse.text();
                 console.error(`AuthContext (updateUserProfile): Username uniqueness check API call failed. Status: ${usernameCheckResponse.status}, Response: ${errorText}`);
                 throw new Error("Could not verify username uniqueness for update. Please try again.");
            }
        } catch(error: any) {
            setLoading(false);
            throw error; 
        }
    }
    if (payload.phoneNumber && payload.phoneNumber !== user.phoneNumber) {
         try {
            const phoneCheckResponse = await fetch(`/api/users/check-phone?phone=${encodeURIComponent(payload.phoneNumber)}&userId=${user.id}`,{
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (phoneCheckResponse.ok) {
                const { isTaken } = await phoneCheckResponse.json();
                if (isTaken) {
                    setLoading(false);
                    console.warn(`AuthContext (updateUserProfile): Phone number ${payload.phoneNumber} is already taken.`);
                    throw new Error("Phone number already in use. Please use a different one.");
                }
            } else {
                 setLoading(false);
                 const errorText = await phoneCheckResponse.text();
                 console.error(`AuthContext (updateUserProfile): Phone number uniqueness check API call failed. Status: ${phoneCheckResponse.status}, Response: ${errorText}`);
                 throw new Error("Could not verify phone number uniqueness for update. Please try again.");
            }
        } catch(error: any) {
            setLoading(false);
            throw error;
        }
    }

    try {
      console.log(`AuthContext (updateUserProfile): Sending PUT request to /api/users/${user.id} with payload:`, payload);
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
        console.error(`AuthContext (updateUserProfile): API error updating profile. Status: ${response.status}. Response:`, responseData);
        throw new Error(responseData.message || "Failed to update profile via API.");
      }
      
      console.log(`AuthContext (updateUserProfile): Profile updated successfully via API. Response:`, responseData);
      
      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        try {
          await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
          console.log(`AuthContext (updateUserProfile): Updated Firebase Auth display name for ${firebaseAuth.currentUser.uid}.`);
        } catch (authProfileError) {
          console.warn("AuthContext (updateUserProfile): Could not update Firebase Auth display name during profile update:", authProfileError);
        }
      }
      
      const updatedUserFromApi = responseData.user;
      const finalUpdatedUser: User = {
        id: updatedUserFromApi._id,
        email: user.email, 
        displayName: updatedUserFromApi.displayName,
        username: updatedUserFromApi.username,
        photoURL: firebaseAuth.currentUser.photoURL || user.photoURL, // Prefer fresh photoURL
        phoneNumber: updatedUserFromApi.phoneNumber,
        institution: updatedUserFromApi.institution,
        role: updatedUserFromApi.role,
        researcherId: updatedUserFromApi.researcherId,
        isAdmin: user.isAdmin, 
      };

      setUser(finalUpdatedUser); 
      setLoading(false);
      console.log(`AuthContext (updateUserProfile): Local user state updated:`, finalUpdatedUser);

      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (finalUpdatedUser.username && finalUpdatedUser.role) { 
              console.log("AuthContext (updateUserProfile): Profile completion detected, removing flags.");
              localStorage.removeItem('profileIncomplete');
              localStorage.removeItem('completingProfile'); 
          }
      }
      return finalUpdatedUser;
    } catch(error: any) {
      setLoading(false);
      console.error("AuthContext (updateUserProfile): Error updating profile:", error);
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
