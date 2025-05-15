
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
            id: profileData._id, // MongoDB uses _id
            email: profileData.email,
            displayName: profileData.displayName,
            username: profileData.username,
            photoURL: profileData.photoURL,
            phoneNumber: profileData.phoneNumber,
            institution: profileData.institution,
            role: profileData.role,
            researcherId: profileData.researcherId,
            isAdmin: profileData.isAdmin === true, // Ensure boolean
        } as User;
      } else if (response.status === 404) {
        console.log(`AuthContext: No user profile found in MongoDB for UID ${firebaseUid}. Will attempt to create.`);
        return null; // No profile yet, needs creation
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

  const createUserProfileInAPI = async (firebaseUser: FirebaseUser, idToken: string, initialRole?: User['role'], initialUsername?: string): Promise<User | null> => {
    const isInitialAdmin = firebaseUser.email === ADMIN_CREATOR_EMAIL;
    const profilePayload: Partial<User> = {
      id: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL || null,
      username: initialUsername || null, // From signup form or null for social
      role: initialRole || null,         // From signup form or null for social
      phoneNumber: firebaseUser.phoneNumber || null,
      institution: null,
      researcherId: null,
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
        // Return the structure expected by the client, usually API returns the created user
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
        return await getIdToken(firebaseAuth.currentUser, true); // Force refresh
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

        if (!appUser) { // Profile doesn't exist in MongoDB, create it
          // For social logins, initialRole and initialUsername would be null
          // For email/password signup, these should have been passed during signup flow if it directly called createUserProfileInAPI
          // However, to keep signup simple, we can let onAuthStateChanged handle profile creation too.
          console.log(`AuthContext: Attempting to create MongoDB profile for new Firebase Auth user ${firebaseUser.uid}`);
          appUser = await createUserProfileInAPI(firebaseUser, idToken, null, null); 
        }
        
        if (appUser) {
            // Sync Firebase Auth displayName/photoURL to MongoDB if they differ and MongoDB is null
            // This is usually for social logins updating their Firebase profile picture later
            let mongoUpdates: Partial<User> = {};
            if (firebaseUser.displayName && firebaseUser.displayName !== appUser.displayName && !appUser.displayName) {
                mongoUpdates.displayName = firebaseUser.displayName;
            }
             if (firebaseUser.photoURL && firebaseUser.photoURL !== appUser.photoURL && !appUser.photoURL) {
                mongoUpdates.photoURL = firebaseUser.photoURL;
            }
            if (Object.keys(mongoUpdates).length > 0) {
                try {
                    const updateResponse = await fetch(`/api/users/${appUser.id}`, {
                        method: 'PUT',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`
                        },
                        body: JSON.stringify(mongoUpdates)
                    });
                    if(updateResponse.ok) {
                        const updatedProfile = await updateResponse.json();
                        appUser = { ...appUser, ...updatedProfile.user, id: updatedProfile.user._id };
                         console.log(`AuthContext: Synced Firebase Auth details to MongoDB for ${appUser.id}`);
                    } else {
                         console.warn(`AuthContext: Failed to sync Firebase Auth displayName/photoURL to MongoDB for ${appUser.id}`);
                    }
                } catch (syncError) {
                     console.error(`AuthContext: Error syncing Firebase Auth details to MongoDB for ${appUser.id}:`, syncError);
                }
            }

            console.log(`[AuthContext] Hydrated appUser for ${appUser.id} (resulting isAdmin: ${appUser.isAdmin}):`, JSON.stringify(appUser, null, 2));
            setUser(appUser);
            setShowLoginModal(false);

            const isProfileComplete = appUser.username && appUser.role;
            if (!isProfileComplete && pathname !== '/profile/settings') {
              localStorage.setItem('profileIncomplete', 'true');
              router.push('/profile/settings?complete=true');
            } else if (isProfileComplete) {
              localStorage.removeItem('profileIncomplete');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname) { // Avoid redirecting to the same page
                localStorage.removeItem('redirectAfterLogin');
                router.push(redirectPath);
              }
            }
        } else {
            // Failed to fetch or create profile in MongoDB
            console.error("AuthContext: Failed to fetch or create user profile in MongoDB. Logging out Firebase user.");
            if (firebaseAuth) await signOut(firebaseAuth); // Sign out from Firebase to prevent broken state
            setUser(null);
        }

      } else {
        // No Firebase user
        console.log("AuthContext: No Firebase user session found.");
        setUser(null);
        localStorage.removeItem('profileIncomplete');
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
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, pass);
      // onAuthStateChanged will handle setUser and redirects
    } catch (error) {
      // ... (error handling as before)
      const firebaseError = error as { code?: string; message?: string };
      let errorMessage = "An unknown error occurred during login.";
      if (firebaseError.code) {
        switch (firebaseError.code) {
          case 'auth/user-not-found':
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            errorMessage = 'Invalid email or password.';
            break;
          // ... other cases
          default:
            errorMessage = firebaseError.message || errorMessage;
        }
      }
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    
    // Initial Firebase Auth user creation
    let userCredential: UserCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
    } catch (authError: any) {
      // ... (Firebase auth error handling as before)
      let errorMessage = "An unknown error occurred during signup with Firebase Auth.";
      if (authError.code) {
        switch (authError.code) {
          case 'auth/email-already-in-use':
              errorMessage = 'This email address is already in use by another account.';
              break;
          // ... other cases
          default:
              errorMessage = authError.message || errorMessage;
        }
      }
      throw new Error(errorMessage);
    }
    
    const firebaseUser = userCredential.user;
    if (firebaseUser) {
        try {
            await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        } catch (profileUpdateError) {
            console.warn("AuthContext: Could not update Firebase Auth display name during signup:", profileUpdateError);
        }
        
        // Now, ensure profile is created in MongoDB via API, onAuthStateChanged will also attempt this.
        // This direct call is for immediate profile setup with signup form data.
        const idToken = await getCurrentIdToken();
        if (idToken) {
            const createdApiUser = await createUserProfileInAPI(firebaseUser, idToken, data.role, data.username);
            if (!createdApiUser) {
                 // If API creation failed here, onAuthStateChanged might still succeed if it's a race condition
                 // or if the issue was temporary. If it consistently fails, user might be logged into Firebase Auth
                 // but without a MongoDB profile.
                console.warn(`AuthContext: Signup completed for Firebase Auth user ${firebaseUser.uid}, but MongoDB profile creation via API failed or returned null. onAuthStateChanged will re-attempt.`);
                // Do not throw error here, let onAuthStateChanged handle the final user state
            }
            // onAuthStateChanged will now pick up this new Firebase user and handle the final state setting and redirection.
        } else {
            console.error("AuthContext: Signup - Could not get ID token after Firebase Auth user creation. MongoDB profile creation skipped for now.");
            // Let onAuthStateChanged try to recover.
        }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    try {
      await signOut(firebaseAuth);
      // setUser(null) and router.push('/') will be handled by onAuthStateChanged
      localStorage.removeItem('redirectAfterLogin');
      localStorage.removeItem('profileIncomplete');
      router.push('/'); 
    } catch (error) {
      console.error("Logout error:", error);
      toast({variant: "destructive", title: "Logout Failed", description: "Could not log out."});
    }
  };
  
  const handleSocialLoginError = (error: any, providerName: string) => {
    // ... (existing detailed error handling and toast messages)
    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing.`;
           toast({
            title: toastTitle,
            description: ( /* ... existing detailed description ... */ ),
            duration: 15000, 
          });
          return; 
        // ... other cases
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    setActiveSocialLoginProvider(null); 
    setLoading(false); 
  };

  const loginWithProvider = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    toast({ title: `Initiating ${providerName} Sign-In`, description: `A popup window should appear.` });
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
      // onAuthStateChanged will handle the rest
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => loginWithProvider(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => loginWithProvider(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>): Promise<User | null> => {
    if (!user || !firebaseAuth?.currentUser) {
      throw new Error("User not logged in. Cannot update profile.");
    }
    const idToken = await getCurrentIdToken();
    if (!idToken) {
        throw new Error("Could not get authentication token. Please try again.");
    }

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(updatedData),
      });
      
      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData.message || "Failed to update profile via API.");
      }
      
      // Update Firebase Auth display name if it changed
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
        email: user.email, // email is not changed here
        displayName: updatedUserFromApi.displayName,
        username: updatedUserFromApi.username,
        photoURL: user.photoURL, // photoURL typically managed by Firebase Auth or separate upload
        phoneNumber: updatedUserFromApi.phoneNumber,
        institution: updatedUserFromApi.institution,
        role: updatedUserFromApi.role,
        researcherId: updatedUserFromApi.researcherId,
        isAdmin: user.isAdmin, // isAdmin is not changed here
      };

      setUser(finalUpdatedUser); 

      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (finalUpdatedUser.username && finalUpdatedUser.role) { 
              localStorage.removeItem('profileIncomplete');
          }
      }
      return finalUpdatedUser;
    } catch(error: any) {
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
