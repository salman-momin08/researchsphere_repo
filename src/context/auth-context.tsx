
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
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';

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
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!firebaseAuth) {
      console.error("AuthContext: Firebase Auth service is not available.");
      toast({
        variant: "destructive",
        title: "Firebase Core Error",
        description: "Could not initialize Firebase Authentication.",
        duration: 10000,
      });
      setLoading(false);
      return;
    }
    if (!db) {
      console.error("AuthContext: Firestore service (db) is not available.");
      toast({
        variant: "destructive",
        title: "Firestore Service Error",
        description: "Could not connect to Firestore database service. Please check your Firebase project setup and ensure Firestore is enabled and configured correctly.",
        duration: 10000,
      });
      setLoading(false);
      return;
    }

    console.log("AuthContext: Setting up onAuthStateChanged listener.");
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      console.log("AuthContext: onAuthStateChanged triggered. Firebase user:", firebaseUser?.uid || "null");
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          let appUser: User;

          if (userDocSnap.exists()) {
            const docData = userDocSnap.data();
            console.log(`[AuthContext] User doc found for UID: ${firebaseUser.uid}. Raw Firestore data:`, JSON.stringify(docData, null, 2));
            const isAdminFromDb = docData.isAdmin === true; // Explicit boolean check
            console.log(`[AuthContext] isAdmin field from Firestore for ${firebaseUser.uid}:`, docData.isAdmin, `(type: ${typeof docData.isAdmin}, interpreted as: ${isAdminFromDb})`);
            
            appUser = {
              id: userDocSnap.id,
              ...docData,
              isAdmin: isAdminFromDb, 
              email: firebaseUser.email,
              displayName: firebaseUser.displayName || docData.displayName,
              photoURL: firebaseUser.photoURL || docData.photoURL,
            } as User;
            
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
                await updateDoc(userDocRef, {...firestoreUpdates, updatedAt: serverTimestamp() });
                appUser = { ...appUser, ...firestoreUpdates };
              } catch (updateError: any) {
                let userMessage = "Could not sync your profile data. Some information might be outdated.";
                 if (updateError.code === 'permission-denied' || updateError.message?.includes('permission-denied') || updateError.message?.includes('Missing or insufficient permissions')) {
                    userMessage = "Permission denied while syncing your profile. Some information might be outdated. Please check your internet connection or contact support.";
                } else {
                  console.error("AuthContext: Profile sync error details:", updateError);
                }
                toast({variant: "destructive", title: "Profile Sync Error", description: userMessage, duration: 7000 });
              }
            }
             console.log(`[AuthContext] Hydrated appUser for ${appUser.id} (resulting isAdmin: ${appUser.isAdmin}):`, JSON.stringify(appUser, null, 2));
            setUser(appUser);
            setShowLoginModal(false); // Close login modal if it was open

            // Centralized redirection logic
            const isProfileComplete = appUser.username && appUser.role;
            if (!isProfileComplete && pathname !== '/profile/settings') {
              console.log("AuthContext: Profile incomplete, redirecting to /profile/settings?complete=true");
              localStorage.setItem('profileIncomplete', 'true');
              router.push('/profile/settings?complete=true');
            } else if (isProfileComplete) {
              localStorage.removeItem('profileIncomplete');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath) {
                console.log(`AuthContext: Found redirectAfterLogin path: ${redirectPath}, redirecting.`);
                localStorage.removeItem('redirectAfterLogin');
                router.push(redirectPath);
              } else {
                console.log("AuthContext: User authenticated, profile complete, no specific redirect. Staying on current page:", pathname);
              }
            }

          } else {
             // New user from Firebase Auth (e.g., social login for the first time)
             console.log(`AuthContext: No user document found for UID ${firebaseUser.uid}. Creating new profile.`);
             const isInitialAdmin = firebaseUser.email === ADMIN_CREATOR_EMAIL;
             appUser = {
              id: firebaseUser.uid,
              userId: firebaseUser.uid, 
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              isAdmin: isInitialAdmin,
              username: null, 
              role: null, 
              phoneNumber: firebaseUser.phoneNumber || null,
              institution: null,
              researcherId: null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            } as User; 
            try {
                await setDoc(userDocRef, {
                  ...appUser, // spread appUser to ensure all fields are included
                  createdAt: serverTimestamp(), 
                  updatedAt: serverTimestamp(),
                });
                console.log(`[AuthContext] New user profile CREATED in Firestore for ${appUser.id} with isAdmin: ${appUser.isAdmin}.`);
                setUser(appUser);
                setShowLoginModal(false);

                const isProfileComplete = appUser.username && appUser.role;
                if (!isProfileComplete && pathname !== '/profile/settings') {
                  console.log("AuthContext: New user, profile incomplete, redirecting to /profile/settings?complete=true");
                  localStorage.setItem('profileIncomplete', 'true');
                  router.push('/profile/settings?complete=true');
                } else if (isProfileComplete) {
                   localStorage.removeItem('profileIncomplete');
                   const redirectPath = localStorage.getItem('redirectAfterLogin') || '/'; // Default to home
                   if (redirectPath) {
                     localStorage.removeItem('redirectAfterLogin');
                     router.push(redirectPath);
                   }
                }

            } catch (dbError: any) {
                let userMessage = "Could not initialize your profile. Please try again or contact support.";
                if (dbError.code === 'permission-denied' || dbError.message?.includes('permission-denied') || dbError.message?.includes('Missing or insufficient permissions')) {
                    userMessage = "Permission denied while setting up your profile. Please check your Firestore rules, internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
                } else {
                    console.error("AuthContext: Profile setup error details:", dbError);
                }
                toast({variant: "destructive", title: "Profile Setup Error", description: userMessage, duration: 10000 });
                if (firebaseAuth) await signOut(firebaseAuth);
                setUser(null); 
            }
          }
        } catch (error: any) {
            let userMessage = "Could not load your profile. Please try again or contact support.";
            if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
                userMessage = "Permission denied while accessing your profile. Please check your Firestore rules, internet connection or ensure you have the necessary permissions. If the problem persists, contact support.";
            } else {
                 console.error("AuthContext: Profile load error details:", error);
            }
            toast({variant: "destructive", title: "Profile Load Error", description: userMessage, duration: 10000 });
            if (firebaseAuth) await signOut(firebaseAuth);
            setUser(null);
        }
      } else {
        // No Firebase user
        console.log("AuthContext: No Firebase user session found.");
        setUser(null);
        localStorage.removeItem('profileIncomplete'); // Clear this if user logs out
      }
      setLoading(false); // Auth state processing finished
      setActiveSocialLoginProvider(null); // Reset any active social login provider
    });
    return () => {
      console.log("AuthContext: Cleaning up onAuthStateChanged listener.");
      unsubscribe();
    }
  }, [router, pathname]); // router and pathname added as dependencies


  const login = async (email: string, pass: string) => {
    if (!firebaseAuth || !db) {
      toast({variant: "destructive", title: "Login Error", description: "Authentication or Database service not available.", duration: 7000});
      throw new Error("Authentication or Database service not available.");
    }
    // setLoading(true); // setLoading is handled by onAuthStateChanged
    try {
      // onAuthStateChanged will handle setUser and redirects
      await signInWithEmailAndPassword(firebaseAuth, email, pass);
      // No setUser or router.push here; handled by onAuthStateChanged
    } catch (error) {
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
            console.error("Login error details:", firebaseError);
        }
      } else {
        console.error("Login error (unknown type):", error);
      }
      // setLoading(false); // setLoading is handled by onAuthStateChanged
      throw new Error(errorMessage); 
    } 
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !db) {
      toast({variant: "destructive", title: "Signup Error", description: "Authentication or Database service not available.", duration: 7000});
      throw new Error("Authentication or Database service not available.");
    }
    // setLoading(true); // setLoading handled by onAuthStateChanged

    const usersRef = collection(db, "users");
    const usernameQuery = query(usersRef, where("username", "==", data.username));
    const phoneQuery = data.phoneNumber ? query(usersRef, where("phoneNumber", "==", data.phoneNumber)) : null;

    try {
        const usernameSnapshot = await getDocs(usernameQuery);
        if (!usernameSnapshot.empty) {
            // setLoading(false); // setLoading handled by onAuthStateChanged
            throw new Error("Username already exists. Please choose another one.");
        }
        if (phoneQuery) {
            const phoneSnapshot = await getDocs(phoneQuery);
            if (!phoneSnapshot.empty) {
                // setLoading(false); // setLoading handled by onAuthStateChanged
                throw new Error("Phone number already in use. Please use a different one or leave it blank.");
            }
        }
    } catch (queryError: any) {
        let userMessage = "Could not verify uniqueness. Please try again.";
        if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
            userMessage = "Permission denied while checking uniqueness. Please check your Firestore rules, internet connection or contact support.";
        } else {
           console.error("Uniqueness query error details:", queryError);
        }
        toast({variant: "destructive", title: "Signup Error", description: userMessage, duration: 7000});
        // setLoading(false); // setLoading handled by onAuthStateChanged
        throw new Error(userMessage);
    }
    
    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
    } catch (authError: any) {
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
              console.error("Firebase Auth signup error details:", authError);
          }
      } else {
        console.error("Signup error (unknown type):", authError);
      }
      // setLoading(false); // setLoading handled by onAuthStateChanged
      throw new Error(errorMessage);
    }
    
    const firebaseUser = userCredential.user;

    try {
        if (firebaseUser) await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
    } catch (profileUpdateError) {
        console.warn("AuthContext: Could not update Firebase Auth display name during signup:", profileUpdateError);
    }

    // Firestore document creation will now be handled by onAuthStateChanged
    // if it's a new user, to centralize profile creation logic.
    // This signup function now primarily focuses on Firebase Auth user creation.
  };

  const logout = async () => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Logout Failed", description: "Authentication service not available.", duration: 7000});
      return;
    }
    // setLoading(true); // setLoading handled by onAuthStateChanged
    try {
        await signOut(firebaseAuth);
        // setUser(null) and router.push('/') will be handled by onAuthStateChanged
        localStorage.removeItem('redirectAfterLogin');
        localStorage.removeItem('profileIncomplete');
        // setUser(null); // Handled by onAuthStateChanged
        router.push('/'); // Explicit redirect on logout
    } catch (error) {
        console.error("Logout error:", error);
        toast({variant: "destructive", title: "Logout Failed", description: "Could not log out. Please try again."});
    } 
    // finally { // setLoading handled by onAuthStateChanged
    //     setLoading(false); 
    // }
  };

  const processSocialLogin = async (credential: UserCredential) => {
    // This function is now primarily a placeholder or could be removed.
    // The core logic of creating/updating the Firestore document after a social login
    // is handled within the onAuthStateChanged listener.
    // setActiveSocialLoginProvider(null) is also handled by onAuthStateChanged.
    console.log("AuthContext: processSocialLogin called. Firebase user:", credential.user.uid);
    // Any specific post-social-login logic that isn't about initial profile creation/update
    // could go here, but generally, onAuthStateChanged is sufficient.
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    // setActiveSocialLoginProvider(null); // Handled by onAuthStateChanged
    // setLoading(false); // Handled by onAuthStateChanged

    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing.`;
           toast({
            title: toastTitle,
            description: (
              <div className="space-y-2">
                <p>{toastMessage}</p>
                <Alert variant="default" className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Troubleshooting Tips</AlertTitle>
                    <AlertDescription>
                      Please ensure popups are enabled for this site in your browser settings.
                      Some browser extensions (like ad blockers or privacy tools) might interfere.
                      Consider temporarily disabling them or using an incognito window.
                      If the problem persists, check your internet connection.
                    </AlertDescription>
                  </Alert>
              </div>
            ),
            duration: 15000, 
          });
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
          console.error(`${providerName} social login error details:`, firebaseError);
      }
    } else {
       console.error(`${providerName} social login error (unknown type):`, error);
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
  };

  const loginWithProvider = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth || !providerInstance || !db) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`, duration: 7000});
      setActiveSocialLoginProvider(null); 
      // setLoading(false); // Handled by onAuthStateChanged
      return;
    }
    
    toast({
        title: `Initiating ${providerName} Sign-In`,
        description: `A popup window should appear. Please ensure popups are enabled for this site.`,
        duration: 5000,
    });

    setActiveSocialLoginProvider(providerName);
    // setLoading(true); // Handled by onAuthStateChanged

    try {
      // onAuthStateChanged will handle setUser, profile creation, and redirects
      await signInWithPopup(firebaseAuth, providerInstance);
    } catch (error) {
      handleSocialLoginError(error, providerName);
       // Ensure loading states are reset if social login fails before onAuthStateChanged fully resolves
      setActiveSocialLoginProvider(null);
      setLoading(false);
    }
  };

  const loginWithGoogle = () => loginWithProvider(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => loginWithProvider(githubAuthCredentialProvider, "github");


  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Password Reset Error", description: "Authentication service not available.", duration: 7000});
      throw new Error("Authentication service not available.");
    }
    // setLoading(true); // Not directly changing auth state, so no global loading indicator
    try {
        await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
    } catch (error: any) {
        let errorMessage = "Could not send password reset email.";
        if (error.code === 'auth/user-not-found') {
            // For security, don't reveal if email exists or not
            // throw error; 
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = "The email address is not valid.";
        }  else if (error.code === 'auth/missing-or-insufficient-permissions' || error.code === 'permission-denied') {
             errorMessage = "Missing or insufficient permissions to send password reset email. Please contact support.";
        } else if (error.code === 'auth/network-request-failed') {
            errorMessage = "Password reset request failed due to a network error. Please check your internet connection.";
        } else {
          console.error("Password reset email error details:", error);
        }
        // setLoading(false);
        throw new Error(errorMessage);
    } 
    // finally { // setLoading(false);
    // }
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => {
    if (!user || !firebaseAuth?.currentUser || !db) { 
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    // setLoading(true); // Not directly changing auth state, but could set a local submitting state

    const userDocRef = doc(db, "users", user.id);

    const dataToUpdateInFirestore: { [key: string]: any } = {};
    const allowedFields: (keyof typeof updatedData)[] = 
      ['displayName', 'username', 'role', 'phoneNumber', 'institution', 'researcherId'];

    allowedFields.forEach(field => {
        if (updatedData[field] !== undefined) { 
            dataToUpdateInFirestore[field] = updatedData[field] === "" ? null : updatedData[field];
        }
    });
    
    if (updatedData.username && updatedData.username !== user.username) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", updatedData.username));
        try {
            const querySnapshot = await getDocs(q);
            const conflictingUser = querySnapshot.docs.find(d => d.id !== user.id);
            if (conflictingUser) {
                // setLoading(false);
                throw new Error("Username already taken. Please choose another one.");
            }
        } catch (queryError: any) {
            let userMessage = "Could not verify username uniqueness for update. Please try again.";
            if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
                 userMessage = "Permission denied while checking username for update. Please check your Firestore rules, internet connection or contact support.";
            } else {
                 console.error("Username query (update) error details:", queryError);
            }
            toast({variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 7000});
            // setLoading(false);
            throw new Error(userMessage);
        }
    }

    if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
        try {
            const querySnapshot = await getDocs(q);
            const conflictingUser = querySnapshot.docs.find(d => d.id !== user.id);
            if (conflictingUser) {
                // setLoading(false);
                throw new Error("Phone number already in use. Please use a different one.");
            }
        } catch (queryError: any) {
            let userMessage = "Could not verify phone number uniqueness for update. Please try again.";
            if (queryError.code === 'permission-denied' || queryError.message?.includes('permission-denied') || queryError.message?.includes('Missing or insufficient permissions')) {
                 userMessage = "Permission denied while checking phone number for update. Please check your Firestore rules, internet connection or contact support.";
            } else {
                 console.error("Phone number query (update) error details:", queryError);
            }
            toast({variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 7000});
            // setLoading(false);
            throw new Error(userMessage);
        }
    }
    
    if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        try {
            if (firebaseAuth.currentUser) await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
        } catch (authProfileError) {
            console.warn("AuthContext: Could not update Firebase Auth display name during profile update:", authProfileError);
        }
    }

    if (Object.keys(dataToUpdateInFirestore).length === 0) {
      toast({ title: "No Changes", description: "No information was changed."});
      // setLoading(false);
      return;
    }

    dataToUpdateInFirestore.updatedAt = serverTimestamp(); 

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
          isAdmin: docData.isAdmin === true, 
          email: firebaseAuth.currentUser.email || docData.email, 
          displayName: firebaseAuth.currentUser.displayName || docData.displayName,
          photoURL: firebaseAuth.currentUser.photoURL || docData.photoURL,
      } as User;
      
      setUser(updatedAppUser); // Update local user state
      
      if (localStorage.getItem('profileIncomplete') === 'true') {
          if (updatedAppUser.username && updatedAppUser.role) { 
              localStorage.removeItem('profileIncomplete');
          }
      }
    } catch(error: any) {
      let userMessage = "Failed to update profile in the database.";
      if (error.code === 'permission-denied' || error.message?.includes('permission-denied') || error.message?.includes('Missing or insufficient permissions')) {
        userMessage = "Could not update your profile due to a permission issue. Please check your Firestore rules, ensure you are connected to the internet and try again. If the problem persists, please contact support.";
      } else {
        console.error("Firestore profile update error details:", error);
      }
      toast({ variant: "destructive", title: "Profile Update Error", description: userMessage, duration: 9000 });
      // setLoading(false); 
      throw new Error(userMessage);
    } 
    // finally { // setLoading(false);
    // }
  };

  const isAdmin = user?.isAdmin === true; 

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithGoogle, loginWithGitHub, sendPasswordResetEmail, updateUserProfile, showLoginModal, setShowLoginModal, isAdmin, isSocialLoginInProgress: activeSocialLoginProvider !== null }}>
      {children}
    </AuthContext.Provider>
  );
};

