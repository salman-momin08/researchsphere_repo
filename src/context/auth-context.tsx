
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
  signInWithRedirect, // Added for redirect option
  getRedirectResult // Added for redirect option
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'; // For popup closed message
import { Info } from 'lucide-react'; // For popup closed message

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
  isSocialLoginInProgress: boolean; // To disable other buttons
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isSocialLoginInProgress, setIsSocialLoginInProgress] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Handle redirect result for social logins
  useEffect(() => {
    if (!firebaseAuth) return;
    getRedirectResult(firebaseAuth)
      .then((result) => {
        if (result) {
          setIsSocialLoginInProgress(true);
          processSocialLogin(result);
        }
      })
      .catch((error) => {
        console.error("Error getting redirect result:", error);
        toast({ variant: "destructive", title: "Social Login Error", description: error.message || "Failed to complete social login."});
      })
      .finally(() => {
        setIsSocialLoginInProgress(false);
      });
  }, []);


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
              isAdmin: docData.isAdmin || false // Ensure isAdmin defaults to false
            } as User;
            
            let firestoreUpdates: Partial<User> = {};
            if (firebaseUser.displayName && firebaseUser.displayName !== appUser.displayName) {
              firestoreUpdates.displayName = firebaseUser.displayName;
            }
            if (firebaseUser.photoURL && firebaseUser.photoURL !== appUser.photoURL) {
              firestoreUpdates.photoURL = firebaseUser.photoURL;
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
            setUser(appUser);
            const isProfileComplete = appUser.username && appUser.role;
            if (!isProfileComplete) {
              localStorage.setItem('profileIncomplete', 'true');
              if (pathname !== '/profile/settings') {
                   router.push('/profile/settings?complete=true');
              }
            } else {
              localStorage.removeItem('profileIncomplete');
            }
          } else {
             appUser = {
              id: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              isAdmin: false, 
              username: null, 
              role: null, 
              phoneNumber: firebaseUser.phoneNumber || null,
              institution: null,
              researcherId: null,
              userId: firebaseUser.uid, // ensure userId is set
            };
            try {
                await setDoc(userDocRef, appUser);
                setUser(appUser);
                localStorage.setItem('profileIncomplete', 'true');
                if (pathname !== '/profile/settings') {
                    router.push('/profile/settings?complete=true');
                }
            } catch (dbError: any) {
                console.error("Error creating user document in Firestore (onAuthStateChanged):", dbError);
                let userMessage = "Could not initialize your profile. Please try again or contact support.";
                if (dbError.code === 'permission-denied' || dbError.message?.includes('permission-denied') || dbError.message?.includes('Missing or insufficient permissions')) {
                    userMessage = "Permission denied while setting up your profile. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
                }
                toast({variant: "destructive", title: "Profile Setup Error", description: userMessage, duration: 10000 });
                if (firebaseAuth) await signOut(firebaseAuth); 
                setUser(null);
            }
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
    setLoading(false);
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
      const firebaseUser = userCredential.user;
      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        console.warn("User authenticated but Firestore profile missing. Attempting to create minimal profile.");
        const newUser: User = {
          id: firebaseUser.uid, email: firebaseUser.email, displayName: firebaseUser.displayName, photoURL: firebaseUser.photoURL,
          isAdmin: false, username: null, role: null, phoneNumber: firebaseUser.phoneNumber || null, institution: null, researcherId: null, userId: firebaseUser.uid,
        };
        try {
          await setDoc(userDocRef, newUser);
          handleSuccessfulLogin(newUser);
        } catch (dbError: any) {
          console.error("Error creating user document on login (fallback):", dbError);
          let userMessage = "Failed to initialize user profile after login. Please try again.";
          if (dbError.code === 'permission-denied' || dbError.message?.includes('permission-denied') || dbError.message?.includes('Missing or insufficient permissions')) {
             userMessage = "Permission denied during profile setup after login. Please check your internet connection or contact support.";
          }
          toast({variant: "destructive", title: "Login Error", description: userMessage, duration: 10000});
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
          setLoading(false);
          throw new Error(userMessage);
        }
        return;
      }
      const docData = userDocSnap.data();
      const appUser = { id: userDocSnap.id, ...docData, isAdmin: docData.isAdmin || false } as User;
      handleSuccessfulLogin(appUser);
    } catch (error) {
      setLoading(false);
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
      throw new Error(errorMessage);
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
            setLoading(false);
            throw new Error("Username already exists. Please choose another one.");
        }
    } catch (queryError: any) {
        setLoading(false);
        console.error("Error checking username uniqueness:", queryError);
        let userMessage = "Could not verify username uniqueness. Please try again.";
        if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
            userMessage = "Permission denied while checking username. Please check your internet connection or contact support.";
        }
        toast({variant: "destructive", title: "Signup Error", description: userMessage, duration: 7000});
        throw new Error(userMessage);
    }
    
    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
    } catch (authError: any) {
      setLoading(false);
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
      throw new Error(errorMessage);
    }
    
    const firebaseUser = userCredential.user;

    try {
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
    } catch (profileUpdateError) {
        console.warn("Could not update Firebase Auth profile displayName during signup:", profileUpdateError);
    }


    const newUserProfile: User = {
      id: firebaseUser.uid,
      userId: firebaseUser.uid, // Ensure userId is set
      email: data.email,
      displayName: data.fullName, 
      username: data.username,
      phoneNumber: data.phoneNumber || null,
      institution: data.institution || null,
      role: data.role,
      researcherId: data.researcherId || null,
      isAdmin: false, // New users are never admins by default
      photoURL: firebaseUser.photoURL || null, 
    };

    try {
      await setDoc(doc(db, "users", firebaseUser.uid), newUserProfile);
    } catch (firestoreError: any) {
        setLoading(false);
        console.error("Firestore profile creation error during signup:", firestoreError);
        let errorMessage = "An unknown error occurred while saving your profile.";
        if (firestoreError.code === 'permission-denied' || firestoreError.message?.includes('permission-denied') || firestoreError.message?.includes('Missing or insufficient permissions')) {
            errorMessage = "Could not save your profile due to a permission issue. Please ensure you are connected to the internet and try again. If the problem persists, please contact support.";
            toast({
                variant: "destructive",
                title: "Profile Creation Error",
                description: errorMessage,
                duration: 9000
            });
        } else {
             toast({
                variant: "destructive",
                title: "Signup Failed",
                description: errorMessage
             });
        }
        try {
            if (firebaseAuth && firebaseUser) await firebaseUser.delete();
            console.log("Firebase Auth user deleted due to Firestore profile creation failure.");
        } catch (deleteError) {
            console.error("Failed to delete Firebase Auth user after Firestore error:", deleteError);
            errorMessage += " Additionally, an orphaned auth account might exist. Please contact support.";
        }
        throw new Error(errorMessage);
    }

    setUser(newUserProfile); 
    setLoading(false);
    setShowLoginModal(false);

    localStorage.removeItem('profileIncomplete'); 
    const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    localStorage.removeItem('redirectAfterLogin');
    router.push(redirectPath);
  };

  const logout = async () => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Logout Failed", description: "Authentication service not available.", duration: 7000});
      return;
    }
    setLoading(true);
    try {
        await signOut(firebaseAuth);
        setUser(null);
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('profileIncomplete');
        router.push('/');
    } catch (error) {
        console.error("Error during logout:", error);
        toast({variant: "destructive", title: "Logout Failed", description: "Could not log out. Please try again."});
    } finally {
        setLoading(false);
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
          appUser = { id: userDocSnap.id, ...docData, isAdmin: docData.isAdmin || false } as User;

          let firestoreUpdates: Partial<User> = {};
          if (firebaseUser.displayName && firebaseUser.displayName !== appUser.displayName) {
              firestoreUpdates.displayName = firebaseUser.displayName;
          }
          if (firebaseUser.photoURL && firebaseUser.photoURL !== appUser.photoURL) {
              firestoreUpdates.photoURL = firebaseUser.photoURL;
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
            userId: firebaseUser.uid, // Ensure userId is set
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            isAdmin: false, // New users are never admins by default
            username: null, 
            role: null, 
            phoneNumber: firebaseUser.phoneNumber || null,
            institution: null,
            researcherId: null,
          };
          await setDoc(userDocRef, appUser);
        }
        handleSuccessfulLogin(appUser);
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
          setUser(null);
    } finally {
        setIsSocialLoginInProgress(false); // Ensure this is always reset
        setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    console.error(`${providerName} login error:`, error);
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
                <p className="text-xs">Please check your browser's popup settings and ensure a stable internet connection. If the issue persists, try using the redirect method or contact support.</p>
                 <Alert variant="default" className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Tip: Try Redirect Sign-In</AlertTitle>
                    <AlertDescription>
                      If popups continue to be an issue, you can try the redirect-based sign-in method which is often more reliable with restrictive browser settings. (This would be an alternative implementation).
                    </AlertDescription>
                  </Alert>
              </div>
            ),
            duration: 15000, 
          });
          return; // Don't show generic error toast
        case 'auth/account-exists-with-different-credential':
          toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method.";
          break;
        case 'auth/unauthorized-domain':
          toastMessage = `This domain is not authorized for ${providerName} Sign-In. Please check your Firebase project configuration and ensure this domain is whitelisted in your ${providerName} OAuth settings.`;
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
  };

  const loginWithProvider = async (provider: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: string) => {
    if (!firebaseAuth || !provider) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`, duration: 7000});
      return;
    }
    
    // Pre-login message for better UX
    toast({
        title: `Initiating ${providerName} Sign-In`,
        description: "A popup window should appear. Please ensure popups are enabled for this site.",
        duration: 5000,
    });

    setIsSocialLoginInProgress(true);
    setLoading(true); // Keep global loading true as well

    try {
      // Option 1: signInWithPopup (current method)
      const credential = await signInWithPopup(firebaseAuth, provider);
      await processSocialLogin(credential);

      // Option 2: signInWithRedirect (alternative to try if popups are problematic)
      // To use this, you'd call it here, and then the redirect result is handled by the useEffect hook with getRedirectResult.
      // await signInWithRedirect(firebaseAuth, provider);
      // Note: If using signInWithRedirect, the rest of processSocialLogin will happen
      // after the redirect, in the useEffect hook that calls getRedirectResult.
      // So, you might not call processSocialLogin directly here.

    } catch (error) {
      handleSocialLoginError(error, providerName);
    } finally {
      // setLoading(false); // setLoading(false) is handled in processSocialLogin or handleSocialLoginError
      // setIsSocialLoginInProgress(false); // This is also handled in processSocialLogin or handleSocialLoginError
    }
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

    // Prevent isAdmin from being updated via this function
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
                setLoading(false);
                throw new Error("Username already taken. Please choose another one.");
            }
        } catch (queryError: any) {
            setLoading(false);
            console.error("Error checking username uniqueness during profile update:", queryError);
            let userMessage = "Could not verify username uniqueness for update. Please try again.";
            if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
                 userMessage = "Permission denied while checking username for update. Please check your internet connection or contact support.";
            }
            toast({variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 7000});
            throw new Error(userMessage);
        }
    }

    const dataToUpdateInFirestore: { [key: string]: any } = {};
    const allowedFields: (keyof Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'userId'>>)[] = // Added userId here as it might be part of type but not updatable
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
            // Don't block Firestore update for this, but maybe log or inform user if critical
        }
    }


    if (Object.keys(dataToUpdateInFirestore).length === 0) {
      setLoading(false);
      toast({ title: "No Changes", description: "No information was changed."});
      return;
    }

    try {
      await updateDoc(userDocRef, dataToUpdateInFirestore);
      const updatedUserDoc = await getDoc(userDocRef);
      if (!updatedUserDoc.exists()) {
        throw new Error("Failed to retrieve updated user profile from database.");
      }
      const docData = updatedUserDoc.data();
      const updatedUser = { id: updatedUserDoc.id, ...docData, isAdmin: docData.isAdmin || false } as User;
      
      setUser(updatedUser); 

      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (updatedUser.username && updatedUser.role) { 
              localStorage.removeItem('profileIncomplete');
          }
      }
    } catch(error: any) {
      console.error("Error updating user profile in Firestore:", error);
      let userMessage = "Failed to update profile in the database.";
      if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
        userMessage = "Could not update your profile due to a permission issue. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
      }
      toast({
            variant: "destructive",
            title: "Profile Update Error",
            description: userMessage,
            duration: 9000
      });
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

