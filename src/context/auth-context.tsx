
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
import type { SignupFormValues } from '@/components/auth/SignupForm';
import {
  auth as firebaseAuth,
  googleAuthCredentialProvider,
  githubAuthCredentialProvider,
  db as firestoreDb
} from '@/lib/firebase';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  type User as FirebaseUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const MOCK_ADMIN_EMAIL = 'admin@example.com';
const ADMIN_CREATOR_EMAIL = 'admin-creator@researchsphere.com';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  signup: (data: SignupFormValues) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  updateUserProfile: (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>) => Promise<User | null >;
  showLoginModal: boolean;
  setShowLoginModal: Dispatch<SetStateAction<boolean>>;
  isAdmin: boolean;
  isSocialLoginInProgress: boolean;
  activeSocialLoginProvider: 'google' | 'github' | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (fetchUserProfileFromFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      const determinedIsAdmin = firestoreIsAdmin === true;

      const userProfile: User = {
        id: userSnap.id,
        email: docData.email || null,
        displayName: docData.displayName || null,
        photoURL: docData.photoURL || null,
        username: docData.username || null,
        role: docData.role || null,
        phoneNumber: docData.phoneNumber || null,
        institution: docData.institution || null,
        researcherId: docData.researcherId || null,
        isAdmin: determinedIsAdmin,
        createdAt: docData.createdAt instanceof Timestamp ? docData.createdAt.toDate().toISOString() : docData.createdAt,
        updatedAt: docData.updatedAt instanceof Timestamp ? docData.updatedAt.toDate().toISOString() : docData.updatedAt,
      };
      return userProfile;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`AuthContext (fetchUserProfileFromFirestore): Error fetching user profile from Firestore for UID ${uid}:`, error);
    toast({ variant: "destructive", title: "Profile Load Error", description: "Could not load your profile from the database.", duration: 7000 });
    return null;
  }
};

const createOrUpdateUserProfileInFirestore = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  additionalData?: Partial<Omit<SignupFormValues, 'password' | 'confirmPassword' | 'confirmEmail' | 'termsAccepted'>> & { isSocialSignIn?: boolean }
): Promise<User | null> => {
  if (!firestoreDb) {
    console.error("AuthContext (createOrUpdateUserProfileInFirestore): Firestore DB instance is not available.");
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);

  try {
    const userSnap = await getDoc(userDocRef);
    let profileDataToSave: Partial<User> & { updatedAt: any; createdAt?: any; userId?: string };

    const isNewlyCreatedAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      profileDataToSave = {
        userId: firebaseUid,
        displayName: firebaseUserObject.displayName || additionalData?.fullName || existingData.displayName || "User",
        photoURL: firebaseUserObject.photoURL || existingData.photoURL || null,
        email: firebaseUserObject.email,
        ...(additionalData?.username && { username: additionalData.username }),
        ...(additionalData?.role && { role: additionalData.role }),
        ...(additionalData?.phoneNumber && { phoneNumber: additionalData.phoneNumber }),
        ...(additionalData?.institution && { institution: additionalData.institution }),
        ...(additionalData?.researcherId && { researcherId: additionalData.researcherId }),
        isAdmin: existingData.isAdmin || isNewlyCreatedAdminByEmail || false,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(userDocRef, profileDataToSave);
    } else {
      profileDataToSave = {
        id: firebaseUid,
        userId: firebaseUid,
        email: firebaseUserObject.email,
        displayName: firebaseUserObject.displayName || additionalData?.fullName || (additionalData?.isSocialSignIn ? firebaseUserObject.email?.split('@')[0] : "User"),
        photoURL: firebaseUserObject.photoURL || null,
        username: additionalData?.username || null,
        role: additionalData?.role || (isNewlyCreatedAdminByEmail ? "Admin" : null),
        phoneNumber: additionalData?.phoneNumber || null,
        institution: additionalData?.institution || null,
        researcherId: additionalData?.researcherId || null,
        isAdmin: isNewlyCreatedAdminByEmail || false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userDocRef, profileDataToSave);
    }
    
    const savedSnap = await getDoc(userDocRef);
    if (savedSnap.exists()) {
      return fetchUserProfileFromFirestore(firebaseUid);
    }
    return null;

  } catch (error) {
    console.error(`AuthContext (createOrUpdateUserProfileInFirestore): Error creating/updating Firestore profile for ${firebaseUid}:`, error);
    toast({ variant: "destructive", title: "Profile Sync Error", description: "Could not save your profile to the database.", duration: 7000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);

  const router = useRouter();
  const pathname = usePathname();
  const nextSearchParams = useNextSearchParams();

  useEffect(() => {
    if (!firebaseAuth) {
      toast({ variant: "destructive", title: "Authentication Error", description: "Firebase Authentication service failed to initialize. Please refresh." });
      setLoading(false);
      return;
    }
     if (!firestoreDb) {
      toast({ variant: "destructive", title: "Database Error", description: "User database service failed to initialize. Profile features may not work.", duration: 10000 });
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
        toast({
            variant: "destructive",
            title: "Network Error",
            description: "You appear to be offline. Some features may not be available.",
            duration: 7000
        });
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        let appUser = await fetchUserProfileFromFirestore(firebaseUser.uid);

        if (!appUser) {
          appUser = await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, { isSocialSignIn: firebaseUser.providerData.some(p => p.providerId !== 'password') });
        } else {
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);
          
          if (appUser.isAdmin !== finalIsAdmin) {
            appUser.isAdmin = finalIsAdmin;
            if (firestoreDb) {
              try {
                await updateDoc(doc(firestoreDb, "users", firebaseUser.uid), { isAdmin: finalIsAdmin, updatedAt: serverTimestamp() });
              } catch (updateError) {
                // Non-critical, user state is already updated locally
              }
            }
          }
        }
        
        if (appUser) {
          setUser(appUser);
          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          
          if (typeof window !== 'undefined') {
            const profileCompleteParam = nextSearchParams.get('complete');
            const isCompletingProfileFlag = localStorage.getItem('completingProfile') === 'true';
            let redirectPath = localStorage.getItem('redirectAfterLogin');

            if (!isProfileConsideredComplete && pathname !== '/profile/settings') {
              localStorage.setItem('completingProfile', 'true');
              router.push('/profile/settings?complete=true');
            } else if (isProfileConsideredComplete && isCompletingProfileFlag) {
              localStorage.removeItem('completingProfile');
            }

            // New redirection logic
            if (appUser.isAdmin) {
              if (redirectPath && redirectPath.startsWith('/admin')) {
                router.push(redirectPath);
              } else {
                router.push('/admin/dashboard');
              }
              if (redirectPath) localStorage.removeItem('redirectAfterLogin');
            } else if (redirectPath) {
                if (redirectPath !== pathname && redirectPath !== '/profile/settings') {
                     router.push(redirectPath);
                }
                localStorage.removeItem('redirectAfterLogin');
            } else if (isProfileConsideredComplete && (pathname === '/login' || pathname === '/signup' || (pathname === '/profile/settings' && !profileCompleteParam))) {
                router.push('/');
            }
          }
          setShowLoginModal(false);
        } else {
          if (firebaseAuth) await signOut(firebaseAuth); 
          setUser(null);
        }
      } else {
        setUser(null);
         if (typeof window !== 'undefined') {
           localStorage.removeItem('completingProfile'); 
         }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => unsubscribe();
  }, [pathname, router, nextSearchParams]);


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    if (!firestoreDb) throw new Error("Database service not available for login.");
    setLoading(true);
    setActiveSocialLoginProvider(null);
    let emailToLogin = identifier;

    if (!identifier.includes('@')) {
      const usersRef = collection(firestoreDb, "users");
      const q = query(usersRef, where("username", "==", identifier));
      try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0].data();
          if (userDoc.email) {
            emailToLogin = userDoc.email;
          } else {
             setLoading(false);
             const errorMsg = `User profile incomplete (missing email) for username '${identifier}'.`;
             toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
             throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = `User not found with username '${identifier}'. Check username or try logging in with email.`;
          toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
          throw new Error(errorMsg);
        }
      } catch (dbError) {
        setLoading(false);
        const errorMsg = "Error during username lookup. Please try again or use email.";
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    
    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setUser and redirects
    } catch (error) {
      setLoading(false);
      setActiveSocialLoginProvider(null);
      const firebaseError = error as { code?: string; message?: string };
      let errorMessage = "An unknown error occurred during login.";
      if (firebaseError.code) {
        switch (firebaseError.code) {
          case 'auth/user-not-found':
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            errorMessage = 'Invalid email/username or password.';
            break;
          case 'auth/invalid-email':
             errorMessage = 'The email address is not valid.';
             break;
          case 'auth/user-disabled':
             errorMessage = 'This user account has been disabled.';
             break;
          default:
            errorMessage = firebaseError.message || errorMessage;
        }
      }
      toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
      throw new Error(errorMessage);
    }
  };

  const signup = async (data: SignupFormValues) => {
    if (!firebaseAuth || !firestoreDb) throw new Error("Authentication or Database service not available.");
    setLoading(true);
    setActiveSocialLoginProvider(null);

    const usersRef = collection(firestoreDb, "users");
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        const errorMsg = "Username is already taken. Please choose another one.";
        throw new Error(errorMsg);
      }
    }
    if (data.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            const errorMsg = "Phone number is already in use. Please use a different one.";
            throw new Error(errorMsg);
        }
    }


    let firebaseUser: FirebaseUser;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
      firebaseUser = cred.user;
    } catch (authError: any) {
      setLoading(false);
      setActiveSocialLoginProvider(null);
      let errorMessage = "An unknown error occurred during signup.";
      if (authError.code === 'auth/email-already-in-use') {
        errorMessage = 'This email address is already in use.';
      } else {
        errorMessage = authError.message || errorMessage;
      }
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
      throw new Error(errorMessage);
    }

    if (firebaseUser) {
      try {
        await updateFirebaseProfile(firebaseUser, { displayName: data.fullName });
        const { password, confirmPassword, confirmEmail, termsAccepted, ...profileData } = data;
        await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, profileData);
      } catch (profileError: any) {
        setLoading(false); 
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
      }
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed before completing. Ensure popups are enabled. If the issue persists, try again or contact support.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 15000, 
          });
          break;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method. Try that method or use a different email.";
          toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
          break;
        default:
          toastMessage = firebaseError.message || toastMessage;
          toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
      }
    } else {
        toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
    }
  };

  const processSocialLogin = async (providerInstance: typeof googleAuthCredentialProvider | typeof githubAuthCredentialProvider, providerName: 'google' | 'github') => {
    if (!firebaseAuth) {
      toast({variant: "destructive", title: "Login Error", description: `${providerName} Sign-In service not available.`});
      return;
    }
    setLoading(true);
    setActiveSocialLoginProvider(providerName);
    try {
      await signInWithPopup(firebaseAuth, providerInstance);
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const updatePayload: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };

      const usersRef = collection(firestoreDb, "users");
      if (updatedData.username && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        const conflictingUser = usernameSnap.docs.find(doc => doc.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        if(updatedData.phoneNumber.trim() !== "") { 
            const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
            const phoneSnap = await getDocs(qPhone);
            const conflictingUser = phoneSnap.docs.find(doc => doc.id !== user.id);
            if (conflictingUser) {
                setLoading(false);
                throw new Error("Phone number already in use. Please use a different one.");
            }
        }
      }


      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      
      if ('isAdmin' in updatePayload) {
        delete (updatePayload as any).isAdmin;
      }
      
      await updateDoc(userDocRef, updatePayload);
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); 
        
        if (typeof window !== 'undefined') {
          const isCompletingProfileFlag = localStorage.getItem('completingProfile') === 'true' || nextSearchParams.get('complete') === 'true';
          if (isCompletingProfileFlag) {
            const isProfileNowComplete = updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber;
            if (isProfileNowComplete) {
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname !== '/') {
                  if(updatedUserFromDb.isAdmin) router.push('/admin/dashboard'); else router.push('/');
              }
            }
          }
        }
        return updatedUserFromDb;
      } else {
        throw new Error("Profile updated, but failed to reload latest data.");
      }

    } catch(error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile." });
      throw error; 
    } finally {
        setLoading(false);
    }
  };

  const isAdmin = user?.isAdmin === true;

  return (
    <AuthContext.Provider value={{
        user, loading, login, signup, logout,
        loginWithGoogle, loginWithGitHub,
        sendPasswordResetEmail, updateUserProfile,
        showLoginModal, setShowLoginModal, isAdmin,
        isSocialLoginInProgress: activeSocialLoginProvider !== null,
        activeSocialLoginProvider,
    }}>
      {children}
    </AuthContext.Provider>
  );
};


    