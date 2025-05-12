
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm'; // Import the form values type

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
    let loggedInUser: User | undefined; 
    if (email === MOCK_USER_ADMIN.email) {
      loggedInUser = MOCK_USER_ADMIN;
    } else if (email === MOCK_USER_NORMAL.email) {
      loggedInUser = MOCK_USER_NORMAL;
    }
     else {
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

    if (!loggedInUser) { 
        setLoading(false);
        throw new Error("Invalid credentials. Please check your email and password.");
    }

    setUser(loggedInUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(loggedInUser));
    setLoading(false);
    setShowLoginModal(false); 

    const isProfileComplete = loggedInUser.username && loggedInUser.role;
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

  const signup = async (data: SignupFormValues) => {
    setLoading(true);
    
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

    await new Promise(resolve => setTimeout(resolve, 1000));
    const userId = String(Date.now()); 

    const newUserProfile: User = {
      id: userId,
      email: data.email,
      displayName: data.fullName, 
      username: data.username,
      phoneNumber: data.phoneNumber || null,
      institution: data.institution || null,
      role: data.role, 
      researcherId: data.researcherId || null,
      isAdmin: false, 
    };

    setUser(newUserProfile);
    localStorage.setItem('researchSphereUser', JSON.stringify(newUserProfile));

    allRegisteredUsers.push(newUserProfile);
    localStorage.setItem('researchSphereAllUsers', JSON.stringify(allRegisteredUsers));
    
    setLoading(false);
    setShowLoginModal(false);
    localStorage.removeItem('profileIncomplete'); // Profile is complete by definition on manual signup
    const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
    localStorage.removeItem('redirectAfterLogin');
    router.push(redirectPath);
  };

  const logout = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    setUser(null);
    localStorage.removeItem('researchSphereUser');
    localStorage.removeItem('redirectAfterLogin'); 
    localStorage.removeItem('profileIncomplete');
    setLoading(false);
    router.push('/'); 
  };

  const loginWithSocial = async (provider: 'Google' | 'GitHub') => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const socialUserIdentifier = `${provider.toLowerCase()}-${Date.now().toString().slice(-5)}`;
    const socialUserEmail = `${socialUserIdentifier}@example.com`; // Mock email
    const socialDisplayName = `${provider} User ${socialUserIdentifier.slice(-4)}`; // Mock display name
    const socialPhotoURL = `https://picsum.photos/seed/${socialUserIdentifier}/40/40`; // Mock photo URL

    let allRegisteredUsers: User[] = [...mockExistingUsers]; 
    const localUsersRaw = localStorage.getItem('researchSphereAllUsers');
    if (localUsersRaw) {
        try {
            const localUsersParsed = JSON.parse(localUsersRaw) as User[];
            const existingIds = new Set(allRegisteredUsers.map(u => u.id));
            localUsersParsed.forEach(lu => {
                if (!existingIds.has(lu.id)) {
                    allRegisteredUsers.push(lu);
                    existingIds.add(lu.id);
                }
            });
        } catch (e) { console.error("Error parsing local users for social login check", e); }
    }
    
    let loggedInUser: User | undefined;
    // Simulate checking if this social user already exists (e.g., by email if provider guarantees uniqueness)
    // For this mock, we assume a new user if the mock email doesn't match an existing user's email.
    // A more robust mock might try to find by a "providerId" if we were storing that.
    const existingSocialUser = allRegisteredUsers.find(u => u.email === socialUserEmail);

    if (existingSocialUser) {
      loggedInUser = existingSocialUser;
    } else {
      // Simulate new social user
      loggedInUser = {
        id: socialUserIdentifier,
        email: socialUserEmail,
        displayName: socialDisplayName,
        photoURL: socialPhotoURL,
        isAdmin: false,
        // These will be null for new social user, prompting completion
        username: null, 
        role: null, 
        phoneNumber: null,
        institution: null,
        researcherId: null,
      };
      if (!allRegisteredUsers.find(u => u.id === loggedInUser!.id)) {
        allRegisteredUsers.push(loggedInUser!);
        localStorage.setItem('researchSphereAllUsers', JSON.stringify(allRegisteredUsers));
      }
    }
    
    setUser(loggedInUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(loggedInUser));
    setLoading(false);
    setShowLoginModal(false);

    const isProfileComplete = loggedInUser.username && loggedInUser.role;

    if (!isProfileComplete) {
      localStorage.setItem('profileIncomplete', 'true');
      router.push('/profile/settings?complete=true');
    } else {
      localStorage.removeItem('profileIncomplete');
      const redirectPath = localStorage.getItem('redirectAfterLogin') || '/dashboard';
      localStorage.removeItem('redirectAfterLogin');
      router.push(redirectPath);
    }
  }

  const loginWithGoogle = () => loginWithSocial('Google');
  const loginWithGitHub = () => loginWithSocial('GitHub');

  const sendPasswordResetEmail = async (email: string) => {
    setLoading(true);
    console.log(`Mock password reset email requested for: ${email}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setLoading(false);
  };

  const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL'>>) => {
    if (!user) {
      throw new Error("User not logged in.");
    }
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000)); 

    // Uniqueness check for username if it's being changed or set
    if (updatedData.username && updatedData.username !== user.username) {
        const allUsersList = JSON.parse(localStorage.getItem('researchSphereAllUsers') || '[]') as User[];
        if (allUsersList.some(u => u.username === updatedData.username && u.id !== user.id)) {
            setLoading(false);
            throw new Error("Username already taken. Please choose another one.");
        }
    }
    
    const updatedUser = { ...user, ...updatedData };
    setUser(updatedUser);
    localStorage.setItem('researchSphereUser', JSON.stringify(updatedUser));

    const localUsersRaw = localStorage.getItem('researchSphereAllUsers');
    let allUsers: User[] = [];
    if (localUsersRaw) {
        try {
            allUsers = JSON.parse(localUsersRaw) as User[];
        } catch (e) { console.error("Failed to parse localUsersRaw for profile update", e); allUsers = [...mockExistingUsers];}
    } else {
      allUsers = [...mockExistingUsers];
    }

    const userIndex = allUsers.findIndex(u => u.id === user.id);
    if (userIndex !== -1) {
        allUsers[userIndex] = updatedUser;
    } else {
        allUsers.push(updatedUser); // Should not happen if user is logged in correctly
    }
    localStorage.setItem('researchSphereAllUsers', JSON.stringify(allUsers));

    // If profile was incomplete, check if it's now complete
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

