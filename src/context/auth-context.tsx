"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm'; // Import the form values type

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>; // Updated signature
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock user data - expanded with new optional fields
const MOCK_USER_NORMAL: User = {
  id: '1',
  email: 'user@example.com',
  displayName: 'Normal User', // Full Name
  isAdmin: false,
  username: 'normaluser',
  phoneNumber: '+19876543210',
  institution: 'University of Example',
  role: 'Author',
  researcherId: '0000-0000-0000-0001',
};

const MOCK_USER_ADMIN: User = {
  id: '2',
  email: 'admin@example.com',
  displayName: 'Admin User', // Full Name
  isAdmin: true,
  username: 'adminuser',
  phoneNumber: '+11234567890',
  institution: 'ResearchSphere Admin Dept',
  role: 'Admin',
  researcherId: '0000-0000-0000-000X',
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Simulate checking auth state
    const storedUser = localStorage.getItem('researchSphereUser');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        // Basic validation of stored user structure
        if (parsedUser && parsedUser.id && parsedUser.email) {
           setUser(parsedUser as User);
        } else {
          localStorage.removeItem('researchSphereUser'); // Clear invalid stored user
        }
      } catch (e) {
        console.error("Failed to parse stored user:", e);
        localStorage.removeItem('researchSphereUser');
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, _pass: string) => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    let loggedInUser: User;
    if (email === MOCK_USER_ADMIN.email) {
      loggedInUser = MOCK_USER_ADMIN;
    } else if (email === MOCK_USER_NORMAL.email) {
      loggedInUser = MOCK_USER_NORMAL;
    }
     else {
      // For other emails, create a basic user profile
      loggedInUser = { 
        id: String(Date.now()),
        email, 
        displayName: email.split('@')[0], // Default display name from email
        username: email.split('@')[0], // Default username from email
        role: 'Author', // Default role
        isAdmin: false,
        // Other fields can be undefined or have defaults
        phoneNumber: null,
        institution: null,
        researcherId: null,
       };
    }
    setUser(loggedInUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(loggedInUser));
    setLoading(false);
    setShowLoginModal(false); 
    const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    localStorage.removeItem('redirectAfterLogin');
    router.push(redirectPath);
  };

  const signup = async (data: SignupFormValues) => {
    setLoading(true);
    // Simulate Firebase Auth user creation
    await new Promise(resolve => setTimeout(resolve, 1000));
    // In a real app, Firebase Auth would return a user object with a uid.
    const userId = String(Date.now()); // Mock user ID

    const newUserProfile: User = {
      id: userId,
      email: data.email,
      displayName: data.fullName, // Use fullName for displayName
      username: data.username,
      phoneNumber: data.phoneNumber || null,
      institution: data.institution || null,
      role: data.role, // Role is "Author" or "Reviewer" from form
      researcherId: data.researcherId || null,
      isAdmin: false, // New users are never admin by default
      // photoURL could be set later
    };

    // Simulate saving the full profile (e.g., to Firestore)
    // For this mock, we update the AuthContext's user state and localStorage
    setUser(newUserProfile);
    localStorage.setItem('researchSphereUser', JSON.stringify(newUserProfile));
    
    // It's important to also update the Firebase Auth user's display name if possible
    // For example, with a real Firebase user: `updateProfile(auth.currentUser, { displayName: data.fullName })`
    // This is mocked here.

    setLoading(false);
    setShowLoginModal(false);
  };

  const logout = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    setUser(null);
    localStorage.removeItem('researchSphereUser');
    setLoading(false);
    router.push('/'); 
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const googleUser: User = { 
        ...MOCK_USER_NORMAL, // Base normal user fields
        id: 'google-user', 
        email: 'googleuser@example.com', 
        displayName: 'Google User',
        username: 'googleuser',
        role: 'Author', // Default role
    };
    setUser(googleUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(googleUser));
    setLoading(false);
    setShowLoginModal(false);
    const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    localStorage.removeItem('redirectAfterLogin');
    router.push(redirectPath);
  };

  const loginWithGitHub = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const githubUser: User = { 
        ...MOCK_USER_NORMAL, // Base normal user fields
        id: 'github-user', 
        email: 'githubuser@example.com', 
        displayName: 'GitHub User',
        username: 'githubuser',
        role: 'Author', // Default role
    };
    setUser(githubUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(githubUser));
    setLoading(false);
    setShowLoginModal(false);
    const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    localStorage.removeItem('redirectAfterLogin');
    router.push(redirectPath);
  };

  const isAdmin = user?.isAdmin || false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, showLoginModal, setShowLoginModal, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};
