
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, ReactNode, SetStateAction, Dispatch } from 'react';
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from 'next/navigation';
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
  Timestamp,
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { SignupFormValues } from '@/components/auth/SignupForm';

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
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const fetchUserProfileFromFirestore = async (uid: string): Promise<User | null> => {
  if (!firestoreDb) {
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", uid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const docData = userSnap.data();
      const firestoreIsAdmin = docData.isAdmin;
      // console.log(`AuthContext (fetchUserProfileFromFirestore): Raw isAdmin from Firestore for ${uid}:`, firestoreIsAdmin, `(type: ${typeof firestoreIsAdmin})`);
      const determinedIsAdmin = firestoreIsAdmin === true; // Strict boolean check

      return {
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
    } else {
      return null;
    }
  } catch (error: any) {
    toast({ variant: "destructive", title: "Profile Load Error", description: `Could not load your profile from Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};

const createOrUpdateUserProfileInFirestore = async (
  firebaseUid: string,
  firebaseUserObject: FirebaseUser,
  profileData?: Partial<SignupFormValues & { isSocialSignIn?: boolean }>
): Promise<User | null> => {
  if (!firestoreDb) {
    return null;
  }
  const userDocRef = doc(firestoreDb, "users", firebaseUid);
  try {
    const userSnap = await getDoc(userDocRef);
    const nowServerTimestamp = serverTimestamp();

    const isCreatorAdminByEmail = firebaseUserObject.email === ADMIN_CREATOR_EMAIL || firebaseUserObject.email === MOCK_ADMIN_EMAIL;

    let baseData: Partial<User> = {
      id: firebaseUid, // ensure id is always set
      email: firebaseUserObject.email,
      displayName: profileData?.fullName || firebaseUserObject.displayName || (profileData?.isSocialSignIn ? firebaseUserObject.email?.split('@')[0] : null) || "User",
      photoURL: firebaseUserObject.photoURL || null,
      username: profileData?.username || null,
      role: profileData?.role || (isCreatorAdminByEmail ? "Admin" : (profileData?.isSocialSignIn ? "Author" : null)) || "Author",
      phoneNumber: profileData?.phoneNumber || null,
      institution: profileData?.institution || null,
      researcherId: profileData?.researcherId || null,
      isAdmin: isCreatorAdminByEmail || false, // Default isAdmin
    };

    let dataToSave: Partial<User> & { updatedAt: any; createdAt?: any };

    if (userSnap.exists()) {
      const existingData = userSnap.data() as User;
      dataToSave = {
        ...existingData, // Keep existing data
        ...baseData,     // Override with new base data
        updatedAt: nowServerTimestamp,
      };
      // Preserve isAdmin if it was already true and not being set by creator email
      if (existingData.isAdmin === true && !isCreatorAdminByEmail) {
        dataToSave.isAdmin = true;
      }
       if (existingData.createdAt && !dataToSave.createdAt) { // Preserve original creation timestamp
          dataToSave.createdAt = existingData.createdAt;
      }
    } else {
      dataToSave = {
        ...baseData,
        createdAt: nowServerTimestamp,
        updatedAt: nowServerTimestamp,
      };
    }
    await setDoc(userDocRef, dataToSave, { merge: true });
    return fetchUserProfileFromFirestore(firebaseUid);
  } catch (error: any) {
    toast({ variant: "destructive", title: "Profile Sync Error", description: `Could not save your profile to Firestore: ${error.message}`, duration: 7000 });
    return null;
  }
};


export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeSocialLoginProvider, setActiveSocialLoginProvider] = useState<null | 'google' | 'github'>(null);
  const isSocialLoginInProgress = activeSocialLoginProvider !== null;

  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // Called at top level

  useEffect(() => {
    // This effect runs when Firebase Auth state might change or when navigating client-side
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }

    if (!firebaseAuth || !firestoreDb) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        let appUser = await fetchUserProfileFromFirestore(firebaseUser.uid);

        if (!appUser) { // User authenticated with Firebase but no Firestore profile
          appUser = await createOrUpdateUserProfileInFirestore(firebaseUser.uid, firebaseUser, { isSocialSignIn: true });
        } else { // User profile exists, ensure isAdmin logic is correct
          const isAdminByEmail = firebaseUser.email === MOCK_ADMIN_EMAIL || firebaseUser.email === ADMIN_CREATOR_EMAIL;
          const rawIsAdminFromProfile = appUser.isAdmin;
          const finalIsAdmin = isAdminByEmail || (rawIsAdminFromProfile === true);

          if (appUser.isAdmin !== finalIsAdmin) {
            appUser.isAdmin = finalIsAdmin;
          }
        }

        if (appUser) {
          setUser(appUser);
          setShowLoginModal(false);

          let redirectAfterLoginPath: string | null = null;
          let completingProfileFlag: string | null = null;

          if (typeof window !== 'undefined') {
            redirectAfterLoginPath = localStorage.getItem('redirectAfterLogin');
            completingProfileFlag = localStorage.getItem('completingProfile');
          }
          
          const isProfileConsideredComplete = appUser.username && appUser.role && appUser.phoneNumber;
          const isCompletingProfilePage = pathname === '/profile/settings' && searchParamsFromHook?.get('complete') === 'true';

          if (!isProfileConsideredComplete && !isCompletingProfilePage) {
            if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
            router.push('/profile/settings?complete=true');
          } else {
            if (isProfileConsideredComplete && completingProfileFlag === 'true' && typeof window !== 'undefined') {
              localStorage.removeItem('completingProfile');
            }

            if (redirectAfterLoginPath) {
              router.push(redirectAfterLoginPath);
              if (typeof window !== 'undefined') localStorage.removeItem('redirectAfterLogin');
            } else if (appUser.isAdmin) {
              const onNonAdminEntryPoint = ['/login', '/signup', '/', '/profile/settings'].some(p => pathname.startsWith(p));
              // Only redirect to /admin/dashboard if they are on a non-admin entry point AND not already on an admin page.
              if (onNonAdminEntryPoint && !pathname.startsWith('/admin/')) {
                router.push('/admin/dashboard');
              }
              // If already on an admin page, or on a non-entry page, do not redirect.
            } else { // Not an admin
              const onAuthPage = pathname === '/login' || pathname === '/signup';
              if ((onAuthPage || isCompletingProfilePage) && pathname !== '/') {
                 router.push('/');
              }
            }
          }
        } else { // Failed to fetch/create appUser from Firestore
          if (firebaseAuth) await signOut(firebaseAuth);
          setUser(null);
        }
      } else { // firebaseUser is null (not logged in or logged out)
        setUser(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('redirectAfterLogin');
          localStorage.removeItem('completingProfile');
        }
      }
      setLoading(false);
      setActiveSocialLoginProvider(null);
    });

    return () => {
      unsubscribe();
    };
  }, [pathname, router, searchParamsFromHook]); // Dependency on pathname and router will cause re-run on navigation


  const login = async (identifier: string, pass: string) => {
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
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
            const errorMsg = `User profile incomplete for username '${identifier}'. Cannot resolve email.`;
            toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
            throw new Error(errorMsg);
          }
        } else {
          setLoading(false);
          const errorMsg = `User not found with username '${identifier}'.`;
          toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
          throw new Error(errorMsg);
        }
      } catch (dbError: any) {
        setLoading(false);
        const errorMsg = `Error during username lookup: ${dbError.message}.`;
        toast({ variant: "destructive", title: "Login Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, emailToLogin, pass);
      // onAuthStateChanged will handle setting user and redirecting
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
    if (!firebaseAuth || !firestoreDb) {
      toast({ variant: "destructive", title: "Service Error", description: "Authentication or Database service not available." });
      throw new Error("Authentication or Database service not available.");
    }
    setLoading(true);
    setActiveSocialLoginProvider(null);

    const usersRef = collection(firestoreDb, "users");
    if (data.username) {
      const qUsername = query(usersRef, where("username", "==", data.username));
      const usernameSnap = await getDocs(qUsername);
      if (!usernameSnap.empty) {
        setLoading(false);
        const errorMsg = "Username is already taken. Please choose another one.";
        toast({ variant: "destructive", title: "Signup Failed", description: errorMsg });
        throw new Error(errorMsg);
      }
    }
    if (data.phoneNumber) {
        const qPhone = query(usersRef, where("phoneNumber", "==", data.phoneNumber));
        const phoneSnap = await getDocs(qPhone);
        if (!phoneSnap.empty) {
            setLoading(false);
            const errorMsg = "Phone number is already in use. Please use a different one.";
            toast({ variant: "destructive", title: "Signup Failed", description: errorMsg });
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
        // onAuthStateChanged will handle Firestore profile creation and redirect
      } catch (profileError: any) {
        // This specific error toast is fine here as it's post-Firebase Auth user creation
        toast({ variant: "destructive", title: "Signup Incomplete", description: `Account created, but initial profile setup had an issue: ${profileError.message}. Please try updating your profile.`, duration: 10000 });
      }
    }
  };

  const logout = async () => {
    if (!firebaseAuth) return;
    setLoading(true);
    try {
      await signOut(firebaseAuth);
      // onAuthStateChanged will handle setting user to null and redirecting
    } catch (error: any) {
      toast({variant: "destructive", title: "Logout Failed", description: error.message || "Could not log out."});
    } finally {
      setLoading(false); // Ensure loading is set to false even if signOut itself doesn't trigger onAuthStateChanged immediately
    }
  };

  const handleSocialLoginError = (error: any, providerName: string) => {
    setLoading(false);
    setActiveSocialLoginProvider(null);

    const firebaseError = error as { code?: string; message?: string };
    let toastMessage = `${providerName} Sign-In failed. Please try again.`;
    let toastTitle = `${providerName} Login Error`;

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          toastTitle = `${providerName} Sign-In Cancelled`;
          toastMessage = `The ${providerName} sign-in popup was closed. Please ensure popups are allowed and try again.`;
           toast({
            title: toastTitle,
            description: toastMessage,
            duration: 7000,
          });
          return;
        case 'auth/account-exists-with-different-credential':
          toastTitle = "Account Exists";
          toastMessage = "An account already exists with this email using a different sign-in method.";
          break;
        case 'auth/operation-not-allowed':
            toastTitle = "Sign-In Method Disabled";
            toastMessage = `${providerName} sign-in is not enabled for this app.`;
            break;
        case 'auth/popup-blocked':
            toastTitle = "Popup Blocked";
            toastMessage = `Your browser blocked the ${providerName} sign-in popup. Please allow popups for this site.`;
            break;
        default:
          toastMessage = firebaseError.message || toastMessage;
      }
    }
    toast({ variant: "destructive", title: toastTitle, description: toastMessage, duration: 10000 });
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
      // onAuthStateChanged will handle setting user and redirecting
    } catch (error) {
      handleSocialLoginError(error, providerName);
    }
    // setActiveSocialLoginProvider(null) is handled by onAuthStateChanged finally block
  };

  const loginWithGoogle = () => processSocialLogin(googleAuthCredentialProvider, "google");
  const loginWithGitHub = () => processSocialLogin(githubAuthCredentialProvider, "github");

  const sendPasswordResetEmail = async (emailAddress: string) => {
    if (!firebaseAuth) throw new Error("Authentication service not available.");
    await firebaseSendPasswordResetEmail(firebaseAuth, emailAddress);
  };

 const updateUserProfile = async (updatedData: Partial<Omit<User, 'id' | 'email' | 'isAdmin' | 'photoURL' | 'createdAt' | 'updatedAt'>>): Promise<User | null > => {
    if (!user || !firebaseAuth?.currentUser || !firestoreDb) {
      toast({ variant: "destructive", title: "Error", description: "User not logged in or database service unavailable."});
      throw new Error("User not logged in or database service unavailable. Cannot update profile.");
    }
    setLoading(true);

    try {
      const userDocRef = doc(firestoreDb, "users", user.id);
      const usersRef = collection(firestoreDb, "users");

      if (updatedData.username && updatedData.username !== user.username) {
        const qUsername = query(usersRef, where("username", "==", updatedData.username));
        const usernameSnap = await getDocs(qUsername);
        const conflictingUser = usernameSnap.docs.find(docSnap => docSnap.id !== user.id);
        if (conflictingUser) {
          setLoading(false);
          throw new Error("Username already taken. Please choose another one.");
        }
      }
      if (updatedData.phoneNumber && updatedData.phoneNumber !== user.phoneNumber) {
        if(updatedData.phoneNumber.trim() !== "") { // Only check if phone number is provided and changed
            const qPhone = query(usersRef, where("phoneNumber", "==", updatedData.phoneNumber));
            const phoneSnap = await getDocs(qPhone);
            const conflictingUser = phoneSnap.docs.find(docSnap => docSnap.id !== user.id);
            if (conflictingUser) {
                setLoading(false);
                throw new Error("Phone number already in use. Please use a different one.");
            }
        }
      }

      const updatePayloadFS: Partial<User> & {updatedAt: any} = { ...updatedData, updatedAt: serverTimestamp() };
      delete (updatePayloadFS as any).isAdmin; // Ensure isAdmin cannot be updated this way

      // Update Firebase Auth profile if displayName or photoURL changed
      if (updatedData.displayName && updatedData.displayName !== firebaseAuth.currentUser.displayName) {
        await updateFirebaseProfile(firebaseAuth.currentUser, { displayName: updatedData.displayName });
      }
      // Note: photoURL updates are not part of the current form, but if they were:
      // if (updatedData.photoURL !== undefined && updatedData.photoURL !== firebaseAuth.currentUser.photoURL) {
      //   await updateFirebaseProfile(firebaseAuth.currentUser, { photoURL: updatedData.photoURL });
      // }


      await updateDoc(userDocRef, updatePayloadFS);
      const updatedUserFromDb = await fetchUserProfileFromFirestore(user.id);

      if (updatedUserFromDb) {
        setUser(updatedUserFromDb); // Update context state

         // Handle post-profile completion redirect if applicable
         if (typeof window !== 'undefined') {
          const completingProfileFlag = localStorage.getItem('completingProfile') === 'true';
          if (completingProfileFlag) {
            const isProfileNowComplete = updatedUserFromDb.username && updatedUserFromDb.role && updatedUserFromDb.phoneNumber;
            if (isProfileNowComplete) {
              localStorage.removeItem('completingProfile');
              const redirectPath = localStorage.getItem('redirectAfterLogin');
              if (redirectPath && redirectPath !== pathname && redirectPath !== '/profile/settings') {
                  router.push(redirectPath);
                  localStorage.removeItem('redirectAfterLogin');
              } else if (pathname.startsWith('/profile/settings')) { // If they were on profile settings page for completion
                  const defaultRedirect = updatedUserFromDb.isAdmin ? '/admin/dashboard' : '/';
                  router.push(defaultRedirect);
              }
            }
          }
        }
        return updatedUserFromDb;
      } else {
        throw new Error("Profile updated in Firestore, but failed to reload latest data into context.");
      }
    } catch(error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message || "Could not update your profile."});
      throw error; // Re-throw for the form to catch
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
        isSocialLoginInProgress,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

    