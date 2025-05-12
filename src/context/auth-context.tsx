
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
  sendPasswordResetEmail: (email: string) => Promise<void>;
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

// Array of existing mock users for uniqueness checks
const mockExistingUsers: User[] = [MOCK_USER_NORMAL, MOCK_USER_ADMIN];


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
    let loggedInUser: User | undefined; // Ensure loggedInUser can be undefined initially
    if (email === MOCK_USER_ADMIN.email) {
      loggedInUser = MOCK_USER_ADMIN;
    } else if (email === MOCK_USER_NORMAL.email) {
      loggedInUser = MOCK_USER_NORMAL;
    }
     else {
      // For other emails, create a basic user profile if not found in localStorage users
      const allUsers = [...mockExistingUsers];
      const localUsersRaw = localStorage.getItem('researchSphereAllUsers');
      if (localUsersRaw) {
          try {
              const localUsersParsed = JSON.parse(localUsersRaw) as User[];
              localUsersParsed.forEach(lu => {
                  if (!allUsers.find(u => u.id === lu.id)) allUsers.push(lu);
              });
          } catch (e) { console.error("Failed to parse localUsersRaw", e); }
      }
      const existing = allUsers.find(u => u.email === email);
      if (existing) {
        loggedInUser = existing;
      }
    }

    if (!loggedInUser) { // Check if a user was found or matched
        setLoading(false);
        throw new Error("Invalid credentials. Please check your email and password.");
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
    
    // Uniqueness check
    const allRegisteredUsers: User[] = [...mockExistingUsers];
    const localUsersRaw = localStorage.getItem('researchSphereAllUsers');
    if (localUsersRaw) {
        try {
            const localUsersParsed = JSON.parse(localUsersRaw) as User[];
            localUsersParsed.forEach(lu => {
                if (!allRegisteredUsers.find(u => u.id === lu.id)) allRegisteredUsers.push(lu);
            });
        } catch (e) { console.error("Error parsing local users for signup check", e); }
    }

    if (allRegisteredUsers.some(u => u.username === data.username)) {
      setLoading(false);
      throw new Error("Username already exists. Please choose another one.");
    }
    if (allRegisteredUsers.some(u => u.email === data.email)) {
      setLoading(false);
      throw new Error("Email already registered. Please log in or use a different email.");
    }

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

    // Add to our list of "all users" in localStorage for persistence of mock data
    allRegisteredUsers.push(newUserProfile);
    localStorage.setItem('researchSphereAllUsers', JSON.stringify(allRegisteredUsers));
    
    setLoading(false);
    setShowLoginModal(false);
    const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    localStorage.removeItem('redirectAfterLogin');
    router.push(redirectPath);
  };

  const logout = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    setUser(null);
    localStorage.removeItem('researchSphereUser');
    localStorage.removeItem('redirectAfterLogin'); // Clear any pending redirect on logout
    setLoading(false);
    router.push('/'); 
  };

  const loginWithSocial = async (provider: 'Google' | 'GitHub') => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create a more dynamic mock user for social login to avoid immediate collision with MOCK_USER_NORMAL
    const socialUserIdentifier = `${provider.toLowerCase()}-${Date.now().toString().slice(-5)}`;
    const baseUser: User = {
      id: socialUserIdentifier,
      email: `${socialUserIdentifier}@example.com`,
      displayName: `${provider} User ${socialUserIdentifier.slice(-4)}`,
      username: socialUserIdentifier,
      isAdmin: false,
      role: 'Author', 
    };

     // Check for uniqueness and add to localStorage for all users
    let allRegisteredUsers: User[] = [...mockExistingUsers]; // Start with base mocks
    const localUsersRaw = localStorage.getItem('researchSphereAllUsers');
    if (localUsersRaw) {
        try {
            const localUsersParsed = JSON.parse(localUsersRaw) as User[];
            // Merge ensuring no duplicates by ID
            const existingIds = new Set(allRegisteredUsers.map(u => u.id));
            localUsersParsed.forEach(lu => {
                if (!existingIds.has(lu.id)) {
                    allRegisteredUsers.push(lu);
                    existingIds.add(lu.id);
                }
            });
        } catch (e) { console.error("Error parsing local users for social login check", e); }
    }
    
    // For social login, typically you'd get user info from the provider.
    // Here, we simulate creating a new user or logging in an existing one if the email matches.
    // This mock is simplified: it assumes a new user if email doesn't match MOCK_USER_NORMAL or MOCK_USER_ADMIN.
    // A real app would handle linking accounts or more sophisticated existing user checks.
    
    let loggedInUser: User | undefined;
    // Example: if Google login email matches one of the core mock users, log them in
    // This is a very basic check; real social auth is more complex.
    if (provider === 'Google' && MOCK_USER_NORMAL.email === 'user@example.com' /* imagine this was the Google email */) {
      // This is a contrived example. In reality, Firebase handles this.
      // We're just picking one of the mock users to simulate a social login.
      loggedInUser = MOCK_USER_NORMAL; 
    } else {
      // Simulate new social user
      loggedInUser = baseUser;
      if (!allRegisteredUsers.find(u => u.id === loggedInUser!.id)) {
        allRegisteredUsers.push(loggedInUser!);
        localStorage.setItem('researchSphereAllUsers', JSON.stringify(allRegisteredUsers));
      }
    }
    
    setUser(loggedInUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(loggedInUser));
    setLoading(false);
    setShowLoginModal(false);
    const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    localStorage.removeItem('redirectAfterLogin');
    router.push(redirectPath);
  }

  const loginWithGoogle = () => loginWithSocial('Google');
  const loginWithGitHub = () => loginWithSocial('GitHub');

  const sendPasswordResetEmail = async (email: string) => {
    setLoading(true);
    console.log(`Mock password reset email requested for: ${email}`);
    // Simulate API call (e.g., Firebase's sendPasswordResetEmail)
    await new Promise(resolve => setTimeout(resolve, 1500));
    // In a real app, Firebase handles sending the email.
    // No need to check if email exists; Firebase does this and for security,
    // you typically don't confirm/deny if an email is registered on this form.
    setLoading(false);
    // The UI will show a generic success message.
  };

  const isAdmin = user?.isAdmin || false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, sendPasswordResetEmail, showLoginModal, setShowLoginModal, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

