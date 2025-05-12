"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock user data
const MOCK_USER_NORMAL: User = {
  id: '1',
  email: 'user@example.com',
  displayName: 'Normal User',
  isAdmin: false,
};

const MOCK_USER_ADMIN: User = {
  id: '2',
  email: 'admin@example.com',
  displayName: 'Admin User',
  isAdmin: true,
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Simulate checking auth state
    const storedUser = localStorage.getItem('scholarSubmitUser');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = async (email: string, _pass: string) => {
    setLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    let loggedInUser: User;
    if (email === 'admin@example.com') {
      loggedInUser = MOCK_USER_ADMIN;
    } else {
      loggedInUser = { ...MOCK_USER_NORMAL, email, displayName: email.split('@')[0] };
    }
    setUser(loggedInUser);
    localStorage.setItem('scholarSubmitUser', JSON.stringify(loggedInUser));
    setLoading(false);
    setShowLoginModal(false); // Close modal on successful login
  };

  const signup = async (email: string, _pass: string) => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const newUser: User = { ...MOCK_USER_NORMAL, email, displayName: email.split('@')[0], id: String(Date.now()) };
    setUser(newUser);
    localStorage.setItem('scholarSubmitUser', JSON.stringify(newUser));
    setLoading(false);
    setShowLoginModal(false);
  };

  const logout = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    setUser(null);
    localStorage.removeItem('scholarSubmitUser');
    setLoading(false);
    router.push('/'); // Redirect to home on logout
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const googleUser: User = { ...MOCK_USER_NORMAL, id: 'google-user', email: 'googleuser@example.com', displayName: 'Google User' };
    setUser(googleUser);
    localStorage.setItem('scholarSubmitUser', JSON.stringify(googleUser));
    setLoading(false);
    setShowLoginModal(false);
  };

  const loginWithGitHub = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const githubUser: User = { ...MOCK_USER_NORMAL, id: 'github-user', email: 'githubuser@example.com', displayName: 'GitHub User' };
    setUser(githubUser);
    localStorage.setItem('scholarSubmitUser', JSON.stringify(githubUser));
    setLoading(false);
    setShowLoginModal(false);
  };

  const isAdmin = user?.isAdmin || false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, showLoginModal, setShowLoginModal, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};
