
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname } from 'next/navigation'; // Added usePathname
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
  signInWithEmailAndPassword, // Added for actual email/password login
  createUserWithEmailAndPassword // Added for actual email/password signup
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { toast } from '@/hooks/use-toast'; // Ensured toast is imported

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
  const pathname = usePathname(); // Get current pathname

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const appUser = userDocSnap.data() as User;
          setUser(appUser);
          // Check profile completeness for users logged in via onAuthStateChanged
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
          // This case handles users who authenticated with Firebase (e.g. social)
          // but don't have a corresponding document in Firestore yet.
          // This can happen on the very first social login if processSocialLogin didn't complete
          // or if the Firestore document was somehow deleted.
          const partialUser: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            isAdmin: false, 
            username: null, // Will be filled during profile completion
            role: null,     // Will be filled during profile completion
            phoneNumber: firebaseUser.phoneNumber || null,
            // institution and researcherId will be null initially for social logins
            institution: null, 
            researcherId: null,
          };
          await setDoc(userDocRef, partialUser); // Create the basic profile
          setUser(partialUser);
          localStorage.setItem('profileIncomplete', 'true');
           if (pathname !== '/profile/settings') {
             router.push('/profile/settings?complete=true');
           }
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
    setUser(appUser);
    setLoading(false);
    setShowLoginModal(false);

    const isProfileComplete = appUser.username && appUser.role;
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
        // This case should ideally not happen if signup flow is correct
        // but as a safeguard:
        setLoading(false);
        throw new Error("User profile not found in database. Please sign up or contact support.");
      }
      const appUser = userDocSnap.data() as User;
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
          case 'auth/invalid-credential': // More generic error for email/password issues
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
    
    // Check for unique username
    const usersRef = collection(db, "users");
    const usernameQuery = query(usersRef, where("username", "==", data.username));
    const usernameSnapshot = await getDocs(usernameQuery);
    if (!usernameSnapshot.empty) {
        setLoading(false);
        throw new Error("Username already exists. Please choose another one.");
    }
    // Email uniqueness is handled by Firebase Auth itself (auth/email-already-in-use)
    
    try {
      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      const firebaseUser = userCredential.user;

      // Create the full user profile in Firestore
      const newUserProfile: User = {
        id: firebaseUser.uid, 
        email: data.email,
        displayName: data.fullName, 
        username: data.username, // From form
        phoneNumber: data.phoneNumber || null,
        institution: data.institution || null,
        role: data.role, // From form
        researcherId: data.researcherId || null,
        isAdmin: false, // Default to false
        photoURL: firebaseUser.photoURL || null, // Firebase might provide a default or null
      };
      
      await setDoc(doc(db, "users", firebaseUser.uid), newUserProfile);
      // No need to call handleSuccessfulLogin directly, onAuthStateChanged will pick it up
      // and handle profile completion if necessary. Just set user and loading.
      setUser(newUserProfile); // Optimistically set user
      setLoading(false);
      setShowLoginModal(false); // Close modal if signup was from modal

      // Profile completion check is now primarily handled by onAuthStateChanged
      // But for direct signup, we know username and role are provided.
      localStorage.removeItem('profileIncomplete');
      const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
      localStorage.removeItem('redirectAfterLogin');
      router.push(redirectPath);


    } catch (error) {
        setLoading(false);
        console.error("Signup error:", error);
        const firebaseError = error as { code?: string; message?: string };
        let errorMessage = "An unknown error occurred during signup.";
         if (firebaseError.code) {
            switch (firebaseError.code) {
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
                errorMessage = firebaseError.message || errorMessage;
            }
        }
        throw new Error(errorMessage);
    }
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
      appUser = userDocSnap.data() as User;
    } else {
      // Create a new user profile in Firestore for the social login
      // Username and role will be null initially, prompting profile completion.
      appUser = {
        id: firebaseUser.uid,
        email: firebaseUser.email, // This might be a provider-specific email
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        isAdmin: false, // Default for new users
        username: null, // To be completed by user
        role: null,     // To be completed by user
        phoneNumber: firebaseUser.phoneNumber || null, // Might be available from provider
        institution: null, // To be completed by user
        researcherId: null, // To be completed by user
      };
      await setDoc(userDocRef, appUser);
      // No need to re-fetch userDocSnap, appUser is now the correct representation
    }
    // onAuthStateChanged will handle setting the user and profile completion logic
    // We ensure loading is false and modal is closed. Redirect handled by onAuthStateChanged or handleSuccessfulLogin.
    setLoading(false);
    setShowLoginModal(false);
    // The redirect and profile completion logic is now more centralized in onAuthStateChanged
    // but we can still call handleSuccessfulLogin if we want an immediate redirect for social login
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
                toastMessage = "Google Sign-In was cancelled.";
                break;
            case 'auth/account-exists-with-different-credential':
                toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method.";
                break;
            case 'auth/auth-domain-config-required':
            case 'auth/operation-not-supported-in-this-environment':
            case 'auth/unauthorized-domain':
                toastMessage = "Google Sign-In is not configured correctly for this website. Please contact support.";
                break;
        }
      }
      toast({ variant: firebaseError.code && (firebaseError.code === 'auth/popup-closed-by-user' || firebaseError.code === 'auth/cancelled-popup-request') ? "default" : "destructive", title: "Google Login", description: toastMessage });
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
                toastMessage = "GitHub Sign-In was cancelled.";
                break;
            case 'auth/account-exists-with-different-credential':
                toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method (e.g., Google or Email).";
                break;
            case 'auth/auth-domain-config-required':
            case 'auth/operation-not-supported-in-this-environment':
            case 'auth/unauthorized-domain':
                toastMessage = "GitHub Sign-In is not configured correctly for this website. Please contact support.";
                break;
             case 'auth/web-storage-unsupported':
                toastMessage = "Your browser does not support storage needed for GitHub Sign-In. Please enable cookies/storage or try a different browser.";
                break;
        }
      }
      toast({ variant: firebaseError.code && (firebaseError.code === 'auth/popup-closed-by-user' || firebaseError.code === 'auth/cancelled-popup-request') ? "default" : "destructive", title: "GitHub Login", description: toastMessage });
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (email: string) => {
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, email);
        // Toast success is handled in the ForgotPasswordPage component for better UX there
    } catch (error) {
        setLoading(false); 
        throw error; // Re-throw to be caught by the calling component
    }
    setLoading(false);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => {
    if (!user) {
      throw new Error("User not logged in. Cannot update profile.");
    }
    setLoading(true);

    const userDocRef = doc(db, "users", user.id);

    // Check for username uniqueness if it's being changed
    if (updatedData.username && updatedData.username !== user.username) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", updatedData.username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
             // Ensure the found username doesn't belong to the current user (it shouldn't if logic is right, but good check)
            const conflictingUser = querySnapshot.docs.find(d => d.id !== user.id);
            if (conflictingUser) {
                setLoading(false);
                throw new Error("Username already taken. Please choose another one.");
            }
        }
    }
    
    // Construct object with only the fields that are actually being updated
    const dataToUpdate: { [key: string]: any } = {};
    if (updatedData.displayName !== undefined) dataToUpdate.displayName = updatedData.displayName;
    if (updatedData.username !== undefined) dataToUpdate.username = updatedData.username;
    if (updatedData.role !== undefined) dataToUpdate.role = updatedData.role;
    if (updatedData.phoneNumber !== undefined) dataToUpdate.phoneNumber = updatedData.phoneNumber === "" ? null : updatedData.phoneNumber;
    if (updatedData.institution !== undefined) dataToUpdate.institution = updatedData.institution === "" ? null : updatedData.institution;
    if (updatedData.researcherId !== undefined) dataToUpdate.researcherId = updatedData.researcherId === "" ? null : updatedData.researcherId;

    if (Object.keys(dataToUpdate).length === 0) {
      setLoading(false);
      // toast({ title: "No Changes", description: "No information was changed." });
      return; // No actual data to update
    }

    await updateDoc(userDocRef, dataToUpdate);
    
    // Fetch the updated user document to refresh local state
    const updatedUserDoc = await getDoc(userDocRef);
    if (!updatedUserDoc.exists()) {
      setLoading(false);
      // This should not happen if the update was successful
      throw new Error("Failed to retrieve updated user profile from database.");
    }
    const updatedUser = updatedUserDoc.data() as User;
    
    setUser(updatedUser); // Update local user state

    // Handle profile completion flag
    if (localStorage.getItem('profileIncomplete') === 'true') {
        if (updatedUser.username && updatedUser.role) { // Core fields for completion
            localStorage.removeItem('profileIncomplete');
        }
    }
    setLoading(false);
  };

  const isAdmin = user?.isAdmin || false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, sendPasswordResetEmail, updateUserProfile, showLoginModal, setShowLoginModal, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

