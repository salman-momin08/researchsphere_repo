
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import {
  auth as firebaseAuth,
  db,
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
  // signInWithRedirect, // Kept for reference if needed later
  // getRedirectResult // Kept for reference if needed later
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => Promise<void>;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isSocialLoginInProgress, setIsSocialLoginInProgress] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Commented out getRedirectResult logic as we are primarily using signInWithPopup
  // useEffect(() => {
  //   if (!firebaseAuth) return;
  //   getRedirectResult(firebaseAuth)
  //     .then((result) => {
  //       if (result) {
  //         setIsSocialLoginInProgress(true);
  //         processSocialLogin(result);
  //       }
  //     })
  //     .catch((error) => {
  //       console.error("Error getting redirect result:", error);
  //       toast({ variant: "destructive", title: "Social Login Error", description: error.message || "Failed to complete social login."});
  //     })
  //     .finally(() => {
  //       // This might be too early if processSocialLogin is async and handles its own states
  //       // setIsSocialLoginInProgress(false); 
  //     });
  // }, []);


  useEffect(() => {
    if (!firebaseAuth) {
      console.error("Firebase Auth is not initialized. Check Firebase configuration.");
      setLoading(false);
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "Firebase services are not available. Please try again later or contact support.",
        duration: 10000,
      });
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          let appUser: User;

          if (userDocSnap.exists()) {
            const docData = userDocSnap.data();
            appUser = {
              id: userDocSnap.id,
              ...docData,
              isAdmin: docData.isAdmin || false, // Explicitly default isAdmin
              email: firebaseUser.email, // Ensure email is fresh from auth provider
              displayName: firebaseUser.displayName || docData.displayName, // Prefer auth provider, fallback to DB
              photoURL: firebaseUser.photoURL || docData.photoURL, // Prefer auth provider, fallback to DB
            } as User;

            let firestoreUpdates: Partial<User> = {};
            if (firebaseUser.displayName && firebaseUser.displayName !== docData.displayName) {
              firestoreUpdates.displayName = firebaseUser.displayName;
            }
            if (firebaseUser.photoURL && firebaseUser.photoURL !== docData.photoURL) {
              firestoreUpdates.photoURL = firebaseUser.photoURL;
            }
            if (firebaseUser.email && firebaseUser.email !== docData.email) {
                 firestoreUpdates.email = firebaseUser.email;
            }

            if (Object.keys(firestoreUpdates).length > 0) {
              try {
                await updateDoc(userDocRef, firestoreUpdates);
                appUser = { ...appUser, ...firestoreUpdates };
              } catch (updateError: any) {
                console.error("Error syncing Firebase Auth profile to Firestore:", updateError);
                let userMessage = "Could not sync your profile data. Some information might be outdated.";
                 if (updateError.code === 'permission-denied' || updateError.message?.includes('permission-denied') || updateError.message?.includes('Missing or insufficient permissions')) {
                    userMessage = "Permission denied while syncing your profile. Some information might be outdated. Please check your internet connection or contact support.";
                }
                toast({variant: "destructive", title: "Profile Sync Error", description: userMessage, duration: 7000 });
              }
            }
            
          } else {
             appUser = {
              id: firebaseUser.uid,
              userId: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              isAdmin: false,
              username: null,
              role: null,
              phoneNumber: firebaseUser.phoneNumber || null,
              institution: null,
              researcherId: null,
            };
            try {
                await setDoc(userDocRef, appUser);
            } catch (dbError: any) {
                console.error("Error creating user document in Firestore (onAuthStateChanged):", dbError);
                let userMessage = "Could not initialize your profile. Please try again or contact support.";
                if (dbError.code === 'permission-denied' || dbError.message?.includes('permission-denied') || dbError.message?.includes('Missing or insufficient permissions')) {
                    userMessage = "Permission denied while setting up your profile. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
                }
                toast({variant: "destructive", title: "Profile Setup Error", description: userMessage, duration: 10000 });
                if (firebaseAuth) await signOut(firebaseAuth);
                setUser(null); // Explicitly set user to null on error
                setLoading(false); // Ensure loading state is cleared
                return; // Exit if profile setup fails
            }
          }
          setUser(appUser); // Set user after successful fetch/creation
          const isProfileComplete = appUser.username && appUser.role;
          if (!isProfileComplete) {
            localStorage.setItem('profileIncomplete', 'true');
            if (pathname !== '/profile/settings') {
                  router.push('/profile/settings?complete=true');
            }
          } else {
            localStorage.removeItem('profileIncomplete');
          }

        } catch (error: any) {
            console.error("Error fetching/creating user document in Firestore onAuthStateChanged:", error);
            let userMessage = "Could not load your profile. Please try again or contact support.";
            if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
                userMessage = "Permission denied while accessing your profile. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
            }
            toast({variant: "destructive", title: "Profile Load Error", description: userMessage, duration: 10000 });
            if (firebaseAuth) await signOut(firebaseAuth);
            setUser(null);
        }
      } else {
        setUser(null);
        localStorage.removeItem('profileIncomplete');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router, pathname]);


  const handleSuccessfulLogin = (appUser: User) => {
    const userWithDefaultAdmin = { ...appUser, isAdmin: appUser.isAdmin || false };
    setUser(userWithDefaultAdmin);
    // setLoading(false); // Loading is typically handled by onAuthStateChanged or specific login flows
    setShowLoginModal(false);

    const isProfileComplete = userWithDefaultAdmin.username && userWithDefaultAdmin.role;
    if (!isProfileComplete) {
      localStorage.setItem('profileIncomplete', 'true');
      router.push('/profile/settings?complete=true');
    } else {
      localStorage.removeItem('profileIncomplete');
      const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
      localStorage.removeItem('redirectAfterLogin');
      router.push(redirectPath);
    }
  };

  const login = async (email: string, pass: string) => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: "Authentication service not available.", duration: 7000});
      throw new Error("Authentication service not available.");
    }
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(firebaseAuth, email, pass);
      // onAuthStateChanged will handle setting the user and further logic
      // const firebaseUser = userCredential.user;
      // const userDocRef = doc(db, "users", firebaseUser.uid);
      // const userDocSnap = await getDoc(userDocRef);
      // if (!userDocSnap.exists()) { ... } // This logic is now primarily in onAuthStateChanged
      // handleSuccessfulLogin is also effectively handled by onAuthStateChanged now
    } catch (error) {
      console.error("Login error:", error);
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
            errorMessage = 'Please enter a valid email address.';
            break;
          case 'auth/user-disabled':
            errorMessage = 'This user account has been disabled.';
            break;
           case 'auth/missing-or-insufficient-permissions':
           case 'permission-denied':
             errorMessage = "Login failed due to insufficient permissions. Please check your connection or contact support.";
             break;
          case 'auth/network-request-failed':
            errorMessage = "Login failed due to a network error. Please check your internet connection and try again.";
            break;
          default:
            errorMessage = firebaseError.message || errorMessage;
        }
      }
      // toast({ variant: "destructive", title: "Login Failed", description: errorMessage }); // Toast is handled by component
      throw new Error(errorMessage); // Propagate error to form
    } finally {
        setLoading(false); // Ensure loading is false after attempt
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Signup Error", description: "Authentication service not available.", duration: 7000});
      throw new Error("Authentication service not available.");
    }
    setLoading(true);

    const usersRef = collection(db, "users");
    const usernameQuery = query(usersRef, where("username", "==", data.username));
    try {
        const usernameSnapshot = await getDocs(usernameQuery);
        if (!usernameSnapshot.empty) {
            throw new Error("Username already exists. Please choose another one.");
        }
    } catch (queryError: any) {
        console.error("Error checking username uniqueness:", queryError);
        let userMessage = "Could not verify username uniqueness. Please try again.";
        if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
            userMessage = "Permission denied while checking username. Please check your internet connection or contact support.";
        }
        toast({variant: "destructive", title: "Signup Error", description: userMessage, duration: 7000});
        throw new Error(userMessage);
    } finally {
        // setLoading(false) will be handled after auth attempt
    }
    
    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
    } catch (authError: any) {
      console.error("Firebase Auth Signup error:", authError);
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
              errorMessage = 'Email/password accounts are not enabled. Contact support.';
              break;
          case 'auth/weak-password':
              errorMessage = 'The password is too weak. Please choose a stronger one.';
              break;
          case 'auth/missing-or-insufficient-permissions':
          case 'permission-denied':
            errorMessage = "Signup failed due to insufficient permissions. Please check your connection or contact support.";
            break;
          case 'auth/network-request-failed':
            errorMessage = "Signup failed due to a network error. Please check your internet connection and try again.";
            break;
          default:
              errorMessage = authError.message || errorMessage;
          }
      }
      setLoading(false);
      throw new Error(errorMessage);
    }
    
    const firebaseUser = userCredential.user;

    try {
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
    } catch (profileUpdateError) {
        console.warn("Could not update Firebase Auth profile displayName during signup:", profileUpdateError);
        // Non-critical, proceed with Firestore profile creation
    }

    const newUserProfile: User = {
      id: firebaseUser.uid,
      userId: firebaseUser.uid,
      email: data.email,
      displayName: data.fullName, 
      username: data.username,
      phoneNumber: data.phoneNumber || null,
      institution: data.institution || null,
      role: data.role,
      researcherId: data.researcherId || null,
      isAdmin: false,
      photoURL: firebaseUser.photoURL || null, 
    };

    try {
      await setDoc(doc(db, "users", firebaseUser.uid), newUserProfile);
      // onAuthStateChanged will pick up the new user and handle navigation
    } catch (firestoreError: any) {
        console.error("Firestore profile creation error during signup:", firestoreError);
        let errorMessage = "An unknown error occurred while saving your profile.";
        if (firestoreError.code === 'permission-denied' || firestoreError.message?.includes('permission-denied') || firestoreError.message?.includes('Missing or insufficient permissions')) {
            errorMessage = "Could not save your profile due to a permission issue. Please ensure you are connected to the internet and try again. If the problem persists, please contact support.";
        }
        toast({ variant: "destructive", title: "Profile Creation Error", description: errorMessage, duration: 9000 });
        try {
            if (firebaseUser) await firebaseUser.delete();
            console.log("Firebase Auth user deleted due to Firestore profile creation failure.");
        } catch (deleteError) {
            console.error("Failed to delete Firebase Auth user after Firestore error:", deleteError);
            errorMessage += " Additionally, an orphaned auth account might exist. Please contact support.";
        }
        setLoading(false);
        throw new Error(errorMessage);
    }
    // setUser(newUserProfile); // Let onAuthStateChanged handle this
    // setLoading(false); // Let onAuthStateChanged handle this
    // setShowLoginModal(false);
    // localStorage.removeItem('profileIncomplete'); 
    // const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    // localStorage.removeItem('redirectAfterLogin');
    // router.push(redirectPath);
  };

  const logout = async () => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Logout Failed", description: "Authentication service not available.", duration: 7000});
      return;
    }
    setLoading(true);
    try {
        await signOut(firebaseAuth);
        // onAuthStateChanged will set user to null and handle UI updates
        // setUser(null);
        localStorage.removeItem('redirectAfterLogin'); // Clear any pending redirect
        localStorage.removeItem('profileIncomplete');
        router.push('/'); // Navigate to home on logout
    } catch (error) {
        console.error("Error during logout:", error);
        toast({variant: "destructive", title: "Logout Failed", description: "Could not log out. Please try again."});
    } finally {
        setLoading(false); // This might be redundant if onAuthStateChanged handles it, but safe
    }
  };

  const processSocialLogin = async (credential: UserCredential) => {
    const firebaseUser = credential.user;
    const userDocRef = doc(db, "users", firebaseUser.uid);
    let appUser: User;

    try {
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const docData = userDocSnap.data();
          appUser = { 
            id: userDocSnap.id, 
            ...docData, 
            isAdmin: docData.isAdmin || false,
            email: firebaseUser.email, // Prioritize fresh data from auth provider
            displayName: firebaseUser.displayName || docData.displayName,
            photoURL: firebaseUser.photoURL || docData.photoURL,
          } as User;

          let firestoreUpdates: Partial<User> = {};
          if (firebaseUser.displayName && firebaseUser.displayName !== docData.displayName) {
              firestoreUpdates.displayName = firebaseUser.displayName;
          }
          if (firebaseUser.photoURL && firebaseUser.photoURL !== docData.photoURL) {
              firestoreUpdates.photoURL = firebaseUser.photoURL;
          }
           if (firebaseUser.email && firebaseUser.email !== docData.email) {
              firestoreUpdates.email = firebaseUser.email;
          }
          if (Object.keys(firestoreUpdates).length > 0) {
              try {
                  await updateDoc(userDocRef, firestoreUpdates);
                  appUser = { ...appUser, ...firestoreUpdates };
              } catch (updateError: any) {
                  console.error("Error syncing social login profile to Firestore:", updateError);
                  let userMessage = "Could not sync your profile from social login. Some information might be outdated.";
                  if (updateError.code === 'permission-denied' || updateError.message?.includes('permission-denied') || updateError.message?.includes('Missing or insufficient permissions')) {
                    userMessage = "Permission denied while syncing your profile. Some information might be outdated. Please check your internet connection or contact support.";
                  }
                  toast({ variant: "destructive", title: "Profile Sync Error", description: userMessage, duration: 7000 });
              }
          }
        } else {
          appUser = {
            id: firebaseUser.uid,
            userId: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            isAdmin: false,
            username: null, 
            role: null, 
            phoneNumber: firebaseUser.phoneNumber || null,
            institution: null,
            researcherId: null,
          };
          await setDoc(userDocRef, appUser);
        }
        // onAuthStateChanged will handle setting the user and further logic
        // handleSuccessfulLogin(appUser);
    } catch (dbError: any) {
         console.error("Error creating/updating user document for social login:", dbError);
         let userMessage = "Failed to set up user profile. Please try again.";
         if (dbError.code === 'permission-denied' || dbError.message?.includes('permission-denied') || dbError.message?.includes('Missing or insufficient permissions')) {
            userMessage = "Could not save your profile due to a permission issue after social login. Please try again or contact support if the problem persists.";
         }
         toast({variant: "destructive", title: "Login Error", description: userMessage, duration: 10000 });
          try {
            if (firebaseAuth) await signOut(firebaseAuth);
          } catch (signOutError) {
            console.error("Error signing out user after profile creation failure:", signOutError);
          }
          // setUser(null); // Handled by onAuthStateChanged after signOut
    } finally {
        setIsSocialLoginInProgress(false);
        setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    console.error(`${providerName} login error:`, error); // Log raw error for debugging
    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toast({
            title: `${providerName} Sign-In Cancelled`,
            description: (
              <div className="space-y-2">
                <p>The sign-in popup was closed. This can happen if:</p>
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>Popups are blocked by your browser or an extension.</li>
                  <li>Your internet connection is unstable.</li>
                  <li>There's an issue with your browser extensions.</li>
                  <li>The OAuth Redirect URIs are not correctly configured in Firebase and the Google/GitHub console.</li>
                </ul>
                <p className="text-xs">Please check your browser's popup settings and ensure a stable internet connection. If the issue persists, contact support.</p>
                 <Alert variant="default" className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Tip for Developers</AlertTitle>
                    <AlertDescription>
                      If popups continue to be an issue, consider implementing `signInWithRedirect` as an alternative, which can be more reliable with restrictive browser settings.
                    </AlertDescription>
                  </Alert>
              </div>
            ),
            duration: 15000, 
          });
          // Reset loading states as processSocialLogin won't be called
          setIsSocialLoginInProgress(false);
          setLoading(false);
          return; 
        case 'auth/account-exists-with-different-credential':
          toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method.";
          break;
        case 'auth/unauthorized-domain':
          toastMessage = `This domain is not authorized for ${providerName} Sign-In. Please check your Firebase project configuration and ensure this domain is whitelisted in your ${providerName} OAuth settings. Current domain: ${window.location.origin}`;
          break;
        case 'auth/missing-or-insufficient-permissions':
        case 'permission-denied':
          toastMessage = `Missing or insufficient permissions to perform ${providerName} Sign-In. This could be due to Firestore rules or API access settings. Please contact support.`;
          break;
        case 'auth/network-request-failed':
          toastMessage = `${providerName} Sign-In failed due to a network error. Please check your internet connection and try again.`;
          break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: `${providerName} Login Error`, description: toastMessage, duration: 10000 });
    // Reset loading states as processSocialLogin won't be called
    setIsSocialLoginInProgress(false);
    setLoading(false);
  };

  const loginWithProvider = async (provider: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: string) => {
    if (!firebaseAuth || !provider) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`, duration: 7000});
      setIsSocialLoginInProgress(false);
      setLoading(false);
      return;
    }
    
    toast({
        title: `Initiating ${providerName} Sign-In`,
        description: `A popup window should appear. Please ensure popups are enabled and that no browser extensions are interfering. If the popup closes unexpectedly, check your browser's console for more details and try again.`,
        duration: 7000,
    });

    setIsSocialLoginInProgress(true);
    setLoading(true);

    try {
      const credential = await signInWithPopup(firebaseAuth, provider);
      await processSocialLogin(credential); // This will handle its own loading state resets
    } catch (error) {
      // handleSocialLoginError will be called, and it now resets loading states.
      handleSocialLoginError(error, providerName);
    }
    // No 'finally' block needed here for these states as they are handled by processSocialLogin's finally or handleSocialLoginError
  };

  const loginWithGoogle = () => loginWithProvider(googleAuthCredentialProvider, "Google");
  const loginWithGitHub = () => loginWithProvider(githubAuthCredentialProvider, "GitHub");


  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Password Reset Error", description: "Authentication service not available.", duration: 7000});
      throw new Error("Authentication service not available.");
    }
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
        // Message to user is handled in the component calling this
    } catch (error: any) {
        console.error("Password reset error:", error);
        let errorMessage = "Could not send password reset email.";
        if (error.code === 'auth/user-not-found') {
            // For security, don't reveal if user exists. Message is handled in UI.
            throw error; 
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = "The email address is not valid.";
        }  else if (error.code === 'auth/missing-or-insufficient-permissions' || error.code === 'permission-denied') {
             errorMessage = "Missing or insufficient permissions to send password reset email. Please contact support.";
        } else if (error.code === 'auth/network-request-failed') {
            errorMessage = "Password reset request failed due to a network error. Please check your internet connection.";
        }
        throw new Error(errorMessage);
    } finally {
        setLoading(false);
    }
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => {
    if (!user || !firebaseAuth?.currentUser) { 
      throw new Error("User not logged in. Cannot update profile.");
    }
    setLoading(true);

    const userDocRef = doc(db, "users", user.id);

    if ('isAdmin' in updatedData) {
      delete (updatedData as any).isAdmin; 
      console.warn("Attempt to update 'isAdmin' field via updateUserProfile was blocked.");
    }

    if (updatedData.username && updatedData.username !== user.username) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", updatedData.username));
        try {
            const querySnapshot = await getDocs(q);
            const conflictingUser = querySnapshot.docs.find(d => d.id !== user.id);
            if (conflictingUser) {
                throw new Error("Username already taken. Please choose another one.");
            }
        } catch (queryError: any) {
            console.error("Error checking username uniqueness during profile update:", queryError);
            let userMessage = "Could not verify username uniqueness for update. Please try again.";
            if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
                 userMessage = "Permission denied while checking username for update. Please check your internet connection or contact support.";
            }
            toast({variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 7000});
            throw new Error(userMessage);
        } finally {
            // setLoading(false) will be handled after profile update attempt
        }
    }

    const dataToUpdateInFirestore: { [key: string]: any } = {};
    const allowedFields: (keyof Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'userId'>>)[] = 
      ['displayName', 'username', 'role', 'phoneNumber', 'institution', 'researcherId'];

    allowedFields.forEach(field => {
      if (updatedData[field] !== undefined) {
        dataToUpdateInFirestore[field] = updatedData[field] === "" ? null : updatedData[field];
      }
    });
    
    if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        try {
            if (firebaseAuth.currentUser) await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        } catch (authProfileError) {
            console.warn("Could not update Firebase Auth profile displayName:", authProfileError);
        }
    }

    if (Object.keys(dataToUpdateInFirestore).length === 0) {
      toast({ title: "No Changes", description: "No information was changed."});
      setLoading(false);
      return;
    }

    try {
      await updateDoc(userDocRef, dataToUpdateInFirestore);
      const updatedUserDoc = await getDoc(userDocRef); // Re-fetch to get the latest state
      if (!updatedUserDoc.exists()) {
        throw new Error("Failed to retrieve updated user profile from database.");
      }
      const docData = updatedUserDoc.data();
      const updatedAppUser = { 
          id: updatedUserDoc.id, 
          ...docData, 
          isAdmin: docData.isAdmin || false,
          // Ensure these are up-to-date from Firebase Auth source if possible, or Firestore if not
          email: firebaseAuth.currentUser.email || docData.email, 
          displayName: firebaseAuth.currentUser.displayName || docData.displayName,
          photoURL: firebaseAuth.currentUser.photoURL || docData.photoURL,
      } as User;
      
      setUser(updatedAppUser); 

      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (updatedAppUser.username && updatedAppUser.role) { 
              localStorage.removeItem('profileIncomplete');
          }
      }
    } catch(error: any) {
      console.error("Error updating user profile in Firestore:", error);
      let userMessage = "Failed to update profile in the database.";
      if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
        userMessage = "Could not update your profile due to a permission issue. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
      }
      toast({ variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 9000 });
      throw new Error(userMessage);
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = user?.isAdmin || false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, sendPasswordResetEmail, updateUserProfile, showLoginModal, setShowLoginModal, isAdmin, isSocialLoginInProgress }}>
      {children}
    </AuthContext.Provider>
  );
};
