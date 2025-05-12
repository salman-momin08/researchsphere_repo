
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
  updateProfile as updateFirebaseProfile
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';

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
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          let appUser: User;
          if (userDocSnap.exists()) {
            appUser = { id: userDocSnap.id, ...userDocSnap.data() } as User;
            if (appUser.isAdmin === undefined) {
              appUser.isAdmin = false;
            }
            // Sync Firebase Auth profile (displayName, photoURL) with Firestore user document if different
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
              } catch (updateError) {
                console.error("Error syncing Firebase Auth profile to Firestore:", updateError);
                 // Non-critical, continue with existing appUser data
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
            // New user, create Firestore document
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
            };
            await setDoc(userDocRef, appUser);
            setUser(appUser);
            localStorage.setItem('profileIncomplete', 'true');
            if (pathname !== '/profile/settings') {
              router.push('/profile/settings?complete=true');
            }
          }
        } catch (error: any) {
            console.error("Error fetching/creating user document in Firestore onAuthStateChanged:", error);
            let userMessage = "Could not load your profile. Please try again or contact support.";
            if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
                userMessage = "Permission denied while accessing your profile. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
            }
            toast({variant: "destructive", title: "Profile Load Error", description: userMessage, duration: 10000 });
            await signOut(firebaseAuth); // Sign out if profile can't be loaded/created
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
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(firebaseAuth, email, pass);
      const firebaseUser = userCredential.user;
      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        // This case implies a problem: auth successful but no Firestore profile.
        // Attempt to create a minimal profile.
        console.warn("User authenticated but Firestore profile missing. Attempting to create minimal profile.");
        const newUser: User = {
          id: firebaseUser.uid, email: firebaseUser.email, displayName: firebaseUser.displayName, photoURL: firebaseUser.photoURL,
          isAdmin: false, username: null, role: null, phoneNumber: firebaseUser.phoneNumber || null, institution: null, researcherId: null,
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
          await signOut(firebaseAuth); 
          setUser(null);
          setLoading(false);
          throw new Error(userMessage); // Re-throw to indicate login failure
        }
        return;
      }
      const appUser = { id: userDocSnap.id, ...userDocSnap.data() } as User;
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
          default:
            errorMessage = firebaseError.message || errorMessage;
        }
      }
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    setLoading(true);

    const usersRef = collection(db, "users");
    const usernameQuery = query(usersRef, where("username", "==", data.username));
    const usernameSnapshot = await getDocs(usernameQuery);
    if (!usernameSnapshot.empty) {
        setLoading(false);
        throw new Error("Username already exists. Please choose another one.");
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
            await firebaseUser.delete();
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
    setLoading(true);
    await signOut(firebaseAuth);
    setUser(null);
    localStorage.removeItem('redirectAfterLogin');
    localStorage.removeItem('profileIncomplete');
    setLoading(false);
    router.push('/');
  };

  const processSocialLogin = async (credential: UserCredential) => {
    const firebaseUser = credential.user;
    const userDocRef = doc(db, "users", firebaseUser.uid);
    let userDocSnap = await getDoc(userDocRef);
    let appUser: User;

    if (userDocSnap.exists()) {
      appUser = { id: userDocSnap.id, ...userDocSnap.data() } as User;
      if (appUser.isAdmin === undefined) {
        appUser.isAdmin = false;
      }
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
              if (updateError.code === 'permission-denied' || updateError.message?.includes('permission-denied')) {
                toast({
                    variant: "destructive",
                    title: "Profile Sync Error",
                    description: "Could not update your profile from social login due to a permission issue. Some information might be outdated.",
                    duration: 7000
                });
              }
          }
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
      };
      try {
        await setDoc(userDocRef, appUser);
      } catch (dbError: any) {
         console.error("Error creating/updating user document for social login:", dbError);
         let userMessage = "Failed to set up user profile. Please try again.";
         if (dbError.code === 'permission-denied' || dbError.message?.includes('permission-denied') || dbError.message?.includes('Missing or insufficient permissions')) {
            userMessage = "Could not save your profile due to a permission issue after social login. Please try again or contact support if the problem persists.";
            toast({variant: "destructive", title: "Profile Save Error", description: userMessage, duration: 10000 });
         } else {
            toast({variant: "destructive", title: "Login Error", description: userMessage, duration: 10000 });
         }
          try {
            await signOut(firebaseAuth);
          } catch (signOutError) {
            console.error("Error signing out user after profile creation failure:", signOutError);
          }
          setUser(null);
          setLoading(false);
          return; 
      }
    }
    handleSuccessfulLogin(appUser);
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    try {
      const credential = await signInWithPopup(firebaseAuth, googleAuthCredentialProvider);
      await processSocialLogin(credential);
    } catch (error) {
      console.error("Google login error:", error);
      const firebaseError = error as { code?: string; message?: string };
      let toastMessage = "Google Sign-In failed. Please try again.";
      if (firebaseError.code) {
        switch (firebaseError.code) {
            case 'auth/popup-closed-by-user':
            case 'auth/cancelled-popup-request':
                toastMessage = "Sign-in popup was closed before completion. Please try again. Ensure popups are allowed for this site.";
                break;
            case 'auth/account-exists-with-different-credential':
                toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method.";
                break;
            case 'auth/unauthorized-domain':
                toastMessage = "This domain is not authorized for Google Sign-In. Please contact support or check your Firebase project configuration and authorized domains.";
                break;
            default:
              toastMessage = firebaseError.message || toastMessage;
        }
      }
      toast({ variant: (firebaseError.code === 'auth/popup-closed-by-user' || firebaseError.code === 'auth/cancelled-popup-request') ? "default" : "destructive", title: "Google Login Error", description: toastMessage, duration: 7000 });
      setLoading(false);
    }
  };

  const loginWithGitHub = async () => {
    setLoading(true);
    try {
      const credential = await signInWithPopup(firebaseAuth, githubAuthCredentialProvider);
      await processSocialLogin(credential);
    } catch (error) {
      console.error("GitHub login error:", error);
      const firebaseError = error as { code?: string; message?: string };
      let toastMessage = "GitHub Sign-In failed. Please try again.";
       if (firebaseError.code) {
        switch (firebaseError.code) {
            case 'auth/popup-closed-by-user':
            case 'auth/cancelled-popup-request':
                toastMessage = "Sign-in popup was closed before completion. Please try again. Ensure popups are allowed for this site.";
                break;
            case 'auth/account-exists-with-different-credential':
                toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method (e.g., Google or Email).";
                break;
             case 'auth/unauthorized-domain':
                toastMessage = "This domain is not authorized for GitHub Sign-In. Please contact support or check your Firebase project configuration and authorized domains.";
                break;
            default:
              toastMessage = firebaseError.message || toastMessage;
        }
      }
      toast({ variant: (firebaseError.code === 'auth/popup-closed-by-user' || firebaseError.code === 'auth/cancelled-popup-request') ? "default" : "destructive", title: "GitHub Login Error", description: toastMessage, duration: 7000 });
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (emailAddress: string) => {
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
    } catch (error: any) {
        setLoading(false);
        console.error("Password reset error:", error);
        let errorMessage = "Could not send password reset email.";
        if (error.code === 'auth/user-not-found') {
            errorMessage = "No user found with this email address.";
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = "The email address is not valid.";
        }
        throw new Error(errorMessage);
    }
    setLoading(false);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => {
    if (!user || !firebaseAuth.currentUser) { 
      throw new Error("User not logged in. Cannot update profile.");
    }
    setLoading(true);

    const userDocRef = doc(db, "users", user.id);

    if (updatedData.username && updatedData.username !== user.username) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", updatedData.username));
        const querySnapshot = await getDocs(q);

        const conflictingUser = querySnapshot.docs.find(d => d.id !== user.id);
        if (conflictingUser) {
            setLoading(false);
            throw new Error("Username already taken. Please choose another one.");
        }
    }

    const dataToUpdateInFirestore: { [key: string]: any } = {};
    const allowedFields: (keyof Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>)[] =
      ['displayName', 'username', 'role', 'phoneNumber', 'institution', 'researcherId'];

    allowedFields.forEach(field => {
      if (updatedData[field] !== undefined) {
        dataToUpdateInFirestore[field] = updatedData[field] === "" ? null : updatedData[field];
      }
    });
    
    if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        try {
            await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        } catch (authProfileError) {
            console.warn("Could not update Firebase Auth profile displayName:", authProfileError);
        }
    }


    if (Object.keys(dataToUpdateInFirestore).length === 0) {
      setLoading(false);
      return;
    }

    try {
      await updateDoc(userDocRef, dataToUpdateInFirestore);
      const updatedUserDoc = await getDoc(userDocRef);
      if (!updatedUserDoc.exists()) {
        setLoading(false);
        throw new Error("Failed to retrieve updated user profile from database.");
      }
      const updatedUser = { id: updatedUserDoc.id, ...updatedUserDoc.data() } as User;
      if (updatedUser.isAdmin === undefined) {
        updatedUser.isAdmin = false;
      }

      setUser(updatedUser); 

      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (updatedUser.username && updatedUser.role) { 
              localStorage.removeItem('profileIncomplete');
          }
      }
      setLoading(false);
    } catch(error: any) {
      setLoading(false);
      console.error("Error updating user profile in Firestore:", error);
      let userMessage = "Failed to update profile in the database.";
      if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
        userMessage = "Could not update your profile due to a permission issue. Please check your internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
        toast({
            variant: "destructive",
            title: "Profile Update Error",
            description: userMessage,
            duration: 9000
        });
      } else {
        toast({
            variant: "destructive",
            title: "Update Failed",
            description: userMessage
        });
      }
      throw new Error(userMessage);
    }
  };

  const isAdmin = user?.isAdmin || false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, sendPasswordResetEmail, updateUserProfile, showLoginModal, setShowLoginModal, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

