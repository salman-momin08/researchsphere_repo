
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm'; 
import { 
  auth as firebaseAuth, // renamed to avoid conflict with auth context variable
  db, 
  googleAuthCredentialProvider, 
  githubAuthCredentialProvider 
} from '@/lib/firebase'; // Import real Firebase services
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  type UserCredential,
  type User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';

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

// Mock user data - can be phased out or used for specific mock scenarios if needed
const MOCK_USER_NORMAL: User = {
  id: 'mock-user-1',
  email: 'user@example.com',
  displayName: 'Mock Normal User',
  isAdmin: false,
  username: 'mocknormaluser',
  phoneNumber: '+19876543210',
  institution: 'University of Mock',
  role: 'Author',
  researcherId: '0000-0000-0000-0001',
};

const MOCK_USER_ADMIN: User = {
  id: 'mock-user-admin',
  email: 'admin@example.com',
  displayName: 'Mock Admin User',
  isAdmin: true,
  username: 'mockadminuser',
  phoneNumber: '+11234567890',
  institution: 'ResearchSphere Admin Dept',
  role: 'Admin',
  researcherId: '0000-0000-0000-000X',
};

const mockExistingUsers: User[] = [MOCK_USER_NORMAL, MOCK_USER_ADMIN];


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const appUser = userDocSnap.data() as User;
          setUser(appUser);
          localStorage.setItem('researchSphereUser', JSON.stringify(appUser));
           // Check profile completeness for users logged in via onAuthStateChanged
          const isProfileComplete = appUser.username && appUser.role;
          if (!isProfileComplete) {
            localStorage.setItem('profileIncomplete', 'true');
            if (router.pathname !== '/profile/settings') { // Avoid redirect loop
                 router.push('/profile/settings?complete=true');
            }
          } else {
            localStorage.removeItem('profileIncomplete');
          }
        } else {
          // This case should ideally be handled during signup/social login if userDoc doesn't exist
          // For now, if Firebase auth user exists but no Firestore doc, treat as partial profile
          const partialUser: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            isAdmin: false, // Default
            username: null,
            role: null
          };
          setUser(partialUser);
          localStorage.setItem('researchSphereUser', JSON.stringify(partialUser));
          localStorage.setItem('profileIncomplete', 'true');
           if (router.pathname !== '/profile/settings') {
             router.push('/profile/settings?complete=true');
           }
        }
      } else {
        setUser(null);
        localStorage.removeItem('researchSphereUser');
        localStorage.removeItem('profileIncomplete');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);


  const handleSuccessfulLogin = (appUser: User) => {
    setUser(appUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(appUser));
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
     // This part still uses mock users for direct email/password login for simplicity
    // For real Firebase email/password login, you'd use signInWithEmailAndPassword
    await new Promise(resolve => setTimeout(resolve, 1000));
    let loggedInUser: User | undefined; 
    if (email === MOCK_USER_ADMIN.email) {
      loggedInUser = MOCK_USER_ADMIN;
    } else if (email === MOCK_USER_NORMAL.email) {
      loggedInUser = MOCK_USER_NORMAL;
    } else { // Check local storage mock users
      const localUsersRaw = localStorage.getItem('researchSphereAllUsers');
      if (localUsersRaw) {
          const localUsersParsed = JSON.parse(localUsersRaw) as User[];
          loggedInUser = localUsersParsed.find(u => u.email === email);
      }
    }

    if (!loggedInUser) { 
        setLoading(false);
        throw new Error("Invalid credentials. Please check your email and password.");
    }
    handleSuccessfulLogin(loggedInUser);
  };

  const signup = async (data: SignupFormValues) => {
    setLoading(true);
    
    // Check for username and email uniqueness against Firestore
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
    
    // For this mock, we'll still use a local array for quick demo, but in real app this isn't needed
    const localUsersRaw = localStorage.getItem('researchSphereAllUsers');
    let allRegisteredUsers: User[] = localUsersRaw ? JSON.parse(localUsersRaw) : [...mockExistingUsers];


    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network
    const userId = String(Date.now()); // Mock ID generation

    const newUserProfile: User = {
      id: userId, // In real Firebase, this would be firebaseUser.uid
      email: data.email,
      displayName: data.fullName, 
      username: data.username,
      phoneNumber: data.phoneNumber || null,
      institution: data.institution || null,
      role: data.role, 
      researcherId: data.researcherId || null,
      isAdmin: false, 
    };
    
    // Simulate saving to Firestore (in a real app, use setDoc with firebaseUser.uid)
    // For mock, we add to our local storage list
    if (!allRegisteredUsers.find(u => u.id === newUserProfile.id)) {
        allRegisteredUsers.push(newUserProfile);
        localStorage.setItem('researchSphereAllUsers', JSON.stringify(allRegisteredUsers));
    }
    
    handleSuccessfulLogin(newUserProfile);
  };

  const logout = async () => {
    setLoading(true);
    await signOut(firebaseAuth); // Sign out from Firebase
    setUser(null);
    localStorage.removeItem('researchSphereUser');
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
      // New social user, create a basic profile in Firestore
      appUser = {
        id: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        isAdmin: false, // Default for new users
        username: null, // Indicates profile needs completion
        role: null,     // Indicates profile needs completion
        phoneNumber: firebaseUser.phoneNumber || null, // If provider gives it
        institution: null,
        researcherId: null,
      };
      await setDoc(userDocRef, appUser);
      userDocSnap = await getDoc(userDocRef); // Re-fetch to ensure we have the created doc
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
      toast({ variant: "destructive", title: "Google Login Failed", description: error instanceof Error ? error.message : "An unknown error occurred." });
      setLoading(false);
    }
  };

  const loginWithGitHub = async () => {
    setLoading(true);
    try {
      const credential = await signInWithPopup(firebaseAuth, githubAuthCredentialProvider);
      // GitHub might not return email if not public; handle this if necessary
      await processSocialLogin(credential);
    } catch (error) {
      console.error("GitHub login error:", error);
      toast({ variant: "destructive", title: "GitHub Login Failed", description: error instanceof Error ? error.message : "An unknown error occurred." });
      setLoading(false);
    }
  };

  const sendPasswordResetEmail = async (email: string) => {
    setLoading(true);
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, email);
    } catch (error) {
        setLoading(false); // Ensure loading is set to false on error
        throw error; // Re-throw to be caught by the calling component
    }
    setLoading(false);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => {
    if (!user) {
      throw new Error("User not logged in.");
    }
    setLoading(true);

    const userDocRef = doc(db, "users", user.id);

    // Check for username uniqueness if it's being changed
    if (updatedData.username && updatedData.username !== user.username) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", updatedData.username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty && querySnapshot.docs.some(d => d.id !== user.id)) {
            setLoading(false);
            throw new Error("Username already taken. Please choose another one.");
        }
    }
    
    await updateDoc(userDocRef, updatedData);
    
    // Fetch the updated user document to ensure local state is in sync
    const updatedUserDoc = await getDoc(userDocRef);
    const updatedUser = updatedUserDoc.data() as User;
    
    setUser(updatedUser); // Update context state
    localStorage.setItem('researchSphereUser', JSON.stringify(updatedUser)); // Update local storage

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
