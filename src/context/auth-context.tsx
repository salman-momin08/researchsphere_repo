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
  createUserWithEmailAndPassword 
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
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const appUser = { id: userDocSnap.id, ...userDocSnap.data() } as User;
           // Ensure isAdmin defaults to false if not present
          if (appUser.isAdmin === undefined) {
            appUser.isAdmin = false;
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
          const newUser: User = {
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
            await setDoc(userDocRef, newUser); 
            setUser(newUser);
            localStorage.setItem('profileIncomplete', 'true');
            if (pathname !== '/profile/settings') {
              router.push('/profile/settings?complete=true');
            }
          } catch (error) {
            console.error("Error creating user document in Firestore:", error);
            toast({variant: "destructive", title: "Profile Creation Error", description: "Could not save user profile. Please try again or contact support."});
            // Potentially log out the user or handle this more gracefully
            setUser(null); // User exists in auth but not in DB, critical error
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
    // Ensure isAdmin defaults to false if not present
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
        setLoading(false);
        throw new Error("User profile not found. Please sign up or contact support.");
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
    
    try {
      const userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      const firebaseUser = userCredential.user;

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
      
      await setDoc(doc(db, "users", firebaseUser.uid), newUserProfile);
      
      setUser(newUserProfile); 
      setLoading(false);
      setShowLoginModal(false); 

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
      appUser = { id: userDocSnap.id, ...userDocSnap.data() } as User;
      if (appUser.isAdmin === undefined) { // Ensure isAdmin is set
        appUser.isAdmin = false;
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
      } catch (dbError) {
         console.error("Error creating user document for social login:", dbError);
         toast({variant: "destructive", title: "Login Error", description: "Failed to set up user profile. Please try again."});
         setLoading(false);
         return; // Abort further processing
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
                toastMessage = "Google Sign-In was cancelled.";
                break;
            case 'auth/account-exists-with-different-credential':
                toastMessage = "An account already exists with the same email address but different sign-in credentials. Try signing in with the original method.";
                break;
            default:
              // Use the default message for other Firebase errors or if message is present
              toastMessage = firebaseError.message || toastMessage; 
        }
      }
      toast({ variant: firebaseError.code && (firebaseError.code === 'auth/popup-closed-by-user' || firebaseError.code === 'auth/cancelled-popup-request') ? "default" : "destructive", title: "Google Login Error", description: toastMessage });
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
            default:
              toastMessage = firebaseError.message || toastMessage;
        }
      }
      toast({ variant: firebaseError.code && (firebaseError.code === 'auth/popup-closed-by-user' || firebaseError.code === 'auth/cancelled-popup-request') ? "default" : "destructive", title: "GitHub Login Error", description: toastMessage });
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (emailAddress: string) => {
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
    } catch (error) {
        setLoading(false); 
        throw error; 
    }
    setLoading(false);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => {
    if (!user) {
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
    
    const dataToUpdate: { [key: string]: any } = {};
    const allowedFields: (keyof Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>)[] = 
      ['displayName', 'username', 'role', 'phoneNumber', 'institution', 'researcherId'];

    allowedFields.forEach(field => {
      if (updatedData[field] !== undefined) {
        dataToUpdate[field] = updatedData[field] === "" ? null : updatedData[field];
      }
    });
    
    if (Object.keys(dataToUpdate).length === 0) {
      setLoading(false);
      return; 
    }

    try {
      await updateDoc(userDocRef, dataToUpdate);
      const updatedUserDoc = await getDoc(userDocRef);
      if (!updatedUserDoc.exists()) {
        setLoading(false);
        throw new Error("Failed to retrieve updated user profile from database.");
      }
      const updatedUser = { id: updatedUserDoc.id, ...updatedUserDoc.data() } as User;
      if (updatedUser.isAdmin === undefined) { // Ensure isAdmin is set
        updatedUser.isAdmin = false;
      }
      
      setUser(updatedUser); 

      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (updatedUser.username && updatedUser.role) { 
              localStorage.removeItem('profileIncomplete');
          }
      }
      setLoading(false);
    } catch(error) {
      setLoading(false);
      console.error("Error updating user profile in Firestore:", error);
      // Check if it's a Firebase permissions error
      if ((error as any)?.code === 'permission-denied') {
        throw new Error("You do not have permission to update this profile. Please check Firestore rules.");
      }
      throw new Error("Failed to update profile in the database.");
    }
  };

  const isAdmin = user?.isAdmin || false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, sendPasswordResetEmail, updateUserProfile, showLoginModal, setShowLoginModal, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};