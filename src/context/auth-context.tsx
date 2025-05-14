
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
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
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
      console.log("onAuthStateChanged triggered. Firebase user:", firebaseUser ? firebaseUser.uid : 'null');
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          let appUser: User;

          if (userDocSnap.exists()) {
            const docData = userDocSnap.data();
            console.log(`AuthContext: User doc found for ${firebaseUser.uid}. Raw Firestore data:`, JSON.parse(JSON.stringify(docData)));
            console.log(`AuthContext: isAdmin field from Firestore for ${firebaseUser.uid}:`, docData.isAdmin, "(type: ", typeof docData.isAdmin, ")");

            appUser = {
              id: userDocSnap.id,
              ...docData,
              isAdmin: docData.isAdmin || false, // Explicitly default isAdmin
              email: firebaseUser.email,
              displayName: firebaseUser.displayName || docData.displayName,
              photoURL: firebaseUser.photoURL || docData.photoURL,
            } as User;
            
            console.log(`AuthContext: Hydrated appUser for ${firebaseUser.uid}:`, JSON.parse(JSON.stringify(appUser)));


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
                 console.log(`AuthContext: Synced Firebase Auth profile to Firestore for ${firebaseUser.uid}. Updated appUser:`, JSON.parse(JSON.stringify(appUser)));
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
            console.log(`AuthContext: No user doc found for ${firebaseUser.uid}. Creating new one.`);
             appUser = {
              id: firebaseUser.uid,
              userId: firebaseUser.uid, // Make sure userId is set
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              isAdmin: false, // New users are not admins by default
              username: null, 
              role: null, 
              phoneNumber: firebaseUser.phoneNumber || null,
              institution: null,
              researcherId: null,
            };
            try {
                await setDoc(userDocRef, appUser);
                console.log(`AuthContext: Created new user document in Firestore for ${firebaseUser.uid}:`, JSON.parse(JSON.stringify(appUser)));
            } catch (dbError: any) {
                console.error("Error creating user document in Firestore (onAuthStateChanged):", dbError);
                let userMessage = "Could not initialize your profile. Please try again or contact support.";
                if (dbError.code === 'permission-denied' || dbError.message?.includes('permission-denied') || dbError.message?.includes('Missing or insufficient permissions')) {
                    userMessage = "Permission denied while setting up your profile. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
                }
                toast({variant: "destructive", title: "Profile Setup Error", description: userMessage, duration: 10000 });
                if (firebaseAuth) await signOut(firebaseAuth);
                setUser(null); 
                setLoading(false); 
                return; 
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
      console.log("onAuthStateChanged finished. Loading set to false. Current app user:", user ? user.id : 'null', 'isAdmin:', user ? user.isAdmin : 'N/A');
    });
    return () => unsubscribe();
  }, [router, pathname]); // user removed from dependency array to avoid re-running on setUser


  const handleSuccessfulLogin = (appUser: User) => {
    console.log("handleSuccessfulLogin called for user:", appUser.id, "isAdmin:", appUser.isAdmin);
    const userWithDefaultAdmin = { ...appUser, isAdmin: appUser.isAdmin || false };
    setUser(userWithDefaultAdmin);
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
      await signInWithEmailAndPassword(firebaseAuth, email, pass);
      // onAuthStateChanged will handle setting the user and further logic.
      // Success is implicitly handled by onAuthStateChanged.
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
      throw new Error(errorMessage); 
    } finally {
        setLoading(false); 
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
        setLoading(false);
        throw new Error(userMessage);
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
      isAdmin: false, // New users are not admins
      photoURL: firebaseUser.photoURL || null, 
    };

    try {
      await setDoc(doc(db, "users", firebaseUser.uid), newUserProfile);
      // onAuthStateChanged will pick up the new user and call handleSuccessfulLogin
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
    console.log(`processSocialLogin: Processing social login for ${firebaseUser.uid}`);

    try {
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const docData = userDocSnap.data();
          console.log(`processSocialLogin: User doc found for social login ${firebaseUser.uid}. Raw Firestore data:`, JSON.parse(JSON.stringify(docData)));
          console.log(`processSocialLogin: isAdmin field from Firestore for social login ${firebaseUser.uid}:`, docData.isAdmin, "(type: ", typeof docData.isAdmin, ")");

          appUser = { 
            id: userDocSnap.id, 
            ...docData, 
            isAdmin: docData.isAdmin || false,
            email: firebaseUser.email, 
            displayName: firebaseUser.displayName || docData.displayName,
            photoURL: firebaseUser.photoURL || docData.photoURL,
          } as User;
           console.log(`processSocialLogin: Hydrated existing appUser for social login ${firebaseUser.uid}:`, JSON.parse(JSON.stringify(appUser)));

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
                   console.log(`processSocialLogin: Synced social login profile to Firestore for ${firebaseUser.uid}. Updated appUser:`, JSON.parse(JSON.stringify(appUser)));
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
          console.log(`processSocialLogin: No user doc found for social login ${firebaseUser.uid}. Creating new one.`);
          appUser = {
            id: firebaseUser.uid,
            userId: firebaseUser.uid, // Ensure userId is set
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            isAdmin: false, // New users are not admins
            username: null, 
            role: null, 
            phoneNumber: firebaseUser.phoneNumber || null,
            institution: null,
            researcherId: null,
          };
          await setDoc(userDocRef, appUser);
          console.log(`processSocialLogin: Created new user document for social login ${firebaseUser.uid}:`, JSON.parse(JSON.stringify(appUser)));
        }
        // onAuthStateChanged will pick up the new user state and call handleSuccessfulLogin via its own setUser call.
        // Direct call to handleSuccessfulLogin here might be redundant if onAuthStateChanged is robust.
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
    } finally {
        setIsSocialLoginInProgress(false);
        setLoading(false);
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    console.error(`${providerName} login error:`, error); 
    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing. This might be due to popup blockers or network issues. Please ensure popups are allowed and try again. If the problem persists, check your browser extensions or network connection.`;
           toast({
            title: toastTitle,
            description: (
              <div className="space-y-2">
                <p>{toastMessage}</p>
                <Alert variant="default" className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Tip for Developers</AlertTitle>
                    <AlertDescription>
                      If popups continue to be an issue, consider implementing `signInWithRedirect` as an alternative, which can be more reliable with restrictive browser settings. This involves changes to the auth flow.
                    </AlertDescription>
                  </Alert>
              </div>
            ),
            duration: 15000, 
          });
          setIsSocialLoginInProgress(false);
          setLoading(false);
          return; 
        case 'auth/account-exists-with-different-credential':
          toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method.";
          break;
        case 'auth/unauthorized-domain':
          toastMessage = `This domain is not authorized for ${providerName} Sign-In. Please check your Firebase project configuration and ensure this domain is whitelisted in your ${providerName} OAuth settings. Current domain: ${typeof window !== 'undefined' ? window.location.origin : 'Unknown'}`;
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
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    setIsSocialLoginInProgress(false);
    setLoading(false);
  };

  const loginWithProvider = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: string) => {
    if (!firebaseAuth || !providerInstance) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`, duration: 7000});
      setIsSocialLoginInProgress(false); // Ensure reset
      setLoading(false); // Ensure reset
      return;
    }
    
    toast({
        title: `Initiating ${providerName} Sign-In`,
        description: `A popup window should appear. Please ensure popups are enabled. If the popup closes unexpectedly or you see an error, check your browser's console for more details.`,
        duration: 7000,
    });

    setIsSocialLoginInProgress(true);
    setLoading(true);

    try {
      const credential = await signInWithPopup(firebaseAuth, providerInstance);
      await processSocialLogin(credential); 
    } catch (error) {
      handleSocialLoginError(error, providerName);
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
      console.warn("AuthContext: Attempt to update 'isAdmin' field via updateUserProfile was blocked.");
    }
    if ('userId' in updatedData) {
      delete (updatedData as any).userId;
      console.warn("AuthContext: Attempt to update 'userId' field via updateUserProfile was blocked.");
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
            console.error("Error checking username uniqueness during profile update:", queryError);
            let userMessage = "Could not verify username uniqueness for update. Please try again.";
            if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
                 userMessage = "Permission denied while checking username for update. Please check your internet connection or contact support.";
            }
            toast({variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 7000});
            setLoading(false);
            throw new Error(userMessage);
        }
    }

    const dataToUpdateInFirestore: { [key: string]: any } = {};
    const allowedFields: (keyof Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'userId'>>)[] = 
      ['displayName', 'username', 'role', 'phoneNumber', 'institution', 'researcherId'];

    allowedFields.forEach(field => {
      if ((updatedData as any)[field] !== undefined) { // Check if the field exists in updatedData
        dataToUpdateInFirestore[field] = (updatedData as any)[field] === "" ? null : (updatedData as any)[field];
      }
    });
    
    if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        try {
            if (firebaseAuth.currentUser) await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        } catch (authProfileError) {
            console.warn("AuthContext: Could not update Firebase Auth profile displayName:", authProfileError);
        }
    }

    if (Object.keys(dataToUpdateInFirestore).length === 0) {
      toast({ title: "No Changes", description: "No information was changed."});
      setLoading(false);
      return;
    }
    console.log("AuthContext: Updating Firestore user profile with data:", dataToUpdateInFirestore);

    try {
      await updateDoc(userDocRef, dataToUpdateInFirestore);
      const updatedUserDoc = await getDoc(userDocRef); 
      if (!updatedUserDoc.exists()) {
        throw new Error("Failed to retrieve updated user profile from database.");
      }
      const docData = updatedUserDoc.data();
      const updatedAppUser = { 
          id: updatedUserDoc.id, 
          ...docData, 
          isAdmin: docData.isAdmin || false,
          email: firebaseAuth.currentUser.email || docData.email, 
          displayName: firebaseAuth.currentUser.displayName || docData.displayName,
          photoURL: firebaseAuth.currentUser.photoURL || docData.photoURL,
      } as User;
      
      setUser(updatedAppUser); 
      console.log("AuthContext: Profile updated successfully. New user state:", JSON.parse(JSON.stringify(updatedAppUser)));


      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (updatedAppUser.username && updatedAppUser.role) { 
              localStorage.removeItem('profileIncomplete');
              console.log("AuthContext: Profile completion flag removed.");
          }
      }
    } catch(error: any) {
      console.error("Error updating user profile in Firestore:", error);
      let userMessage = "Failed to update profile in the database.";
      if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
        userMessage = "Could not update your profile due to a permission issue. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
      }
      toast({ variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 9000 });
      setLoading(false); // Ensure loading is false on error
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

