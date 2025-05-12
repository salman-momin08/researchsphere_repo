
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
          const partialUser: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            isAdmin: false, 
            username: null,
            role: null,
            phoneNumber: firebaseUser.phoneNumber || null,
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
        setLoading(false);
        throw new Error("User profile not found. Please contact support.");
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
          case 'auth/invalid-credential':
            errorMessage = 'Invalid email or password.';
            break;
          case 'auth/invalid-email':
            errorMessage = 'Please enter a valid email address.';
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
    const emailQuery = query(usersRef, where("email", "==", data.email));

    const [usernameSnapshot, emailSnapshot] = await Promise.all([
        getDocs(usernameQuery),
        getDocs(emailQuery)
    ]);

    if (!usernameSnapshot.empty) {
        setLoading(false);
        throw new Error("Username already exists. Please choose another one.");
    }
    if (!emailSnapshot.empty) {
        setLoading(false);
        throw new Error("Email already registered. Please log in or use a different email.");
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
      handleSuccessfulLogin(newUserProfile);

    } catch (error) {
        setLoading(false);
        console.error("Signup error:", error);
        const firebaseError = error as { code?: string; message?: string };
        let errorMessage = "An unknown error occurred during signup.";
         if (firebaseError.code) {
            switch (firebaseError.code) {
            case 'auth/email-already-in-use':
                errorMessage = 'This email address is already in use.';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Please enter a valid email address.';
                break;
            case 'auth/weak-password':
                errorMessage = 'Password is too weak. Please choose a stronger one.';
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
      userDocSnap = await getDoc(userDocRef); 
      appUser = userDocSnap.data() as User;
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
      if (firebaseError.code === 'auth/cancelled-popup-request') {
        toast({ variant: "default", title: "Login Cancelled", description: "Google Sign-In was cancelled." });
      } else if (firebaseError.code === 'auth/popup-closed-by-user') {
        toast({ variant: "default", title: "Login Cancelled", description: "Google Sign-In popup was closed." });
      }
       else {
        toast({ variant: "destructive", title: "Google Login Failed", description: firebaseError.message || "An unknown error occurred." });
      }
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
      if (firebaseError.code === 'auth/cancelled-popup-request') {
        toast({ variant: "default", title: "Login Cancelled", description: "GitHub Sign-In was cancelled." });
      } else if (firebaseError.code === 'auth/popup-closed-by-user') {
         toast({ variant: "default", title: "Login Cancelled", description: "GitHub Sign-In popup was closed." });
      }
      else {
        toast({ variant: "destructive", title: "GitHub Login Failed", description: firebaseError.message || "An unknown error occurred." });
      }
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (email: string) => {
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, email);
    } catch (error) {
        setLoading(false); 
        throw error; 
    }
    setLoading(false);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => {
    if (!user) {
      throw new Error("User not logged in.");
    }
    setLoading(true);

    const userDocRef = doc(db, "users", user.id);

    if (updatedData.username && updatedData.username !== user.username) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", updatedData.username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty && querySnapshot.docs.some(d => d.id !== user.id)) {
            setLoading(false);
            throw new Error("Username already taken. Please choose another one.");
        }
    }
    
    // Ensure only allowed fields are passed to updateDoc
    const dataToUpdate: Partial<User> = {};
    if (updatedData.displayName !== undefined) dataToUpdate.displayName = updatedData.displayName;
    if (updatedData.username !== undefined) dataToUpdate.username = updatedData.username;
    if (updatedData.role !== undefined) dataToUpdate.role = updatedData.role;
    if (updatedData.phoneNumber !== undefined) dataToUpdate.phoneNumber = updatedData.phoneNumber;
    if (updatedData.institution !== undefined) dataToUpdate.institution = updatedData.institution;
    if (updatedData.researcherId !== undefined) dataToUpdate.researcherId = updatedData.researcherId;

    await updateDoc(userDocRef, dataToUpdate);
    
    const updatedUserDoc = await getDoc(userDocRef);
    if (!updatedUserDoc.exists()) {
      setLoading(false);
      throw new Error("Failed to retrieve updated user profile.");
    }
    const updatedUser = updatedUserDoc.data() as User;
    
    setUser(updatedUser); 

    if (localStorage.getItem('profileIncomplete') === 'true') {
        if (updatedUser.username && updatedUser.role) {
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

