
import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// Firebase Storage client SDK is not used directly if Cloudinary handles uploads.
// If you were to use Firebase Storage for other things, you'd import getStorage here.
// import { getStorage } from "firebase/storage";

const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const firebaseAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const firebaseStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const firebaseMessagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const firebaseAppId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

// Note: Client secrets for Google/GitHub OAuth are NOT used here.
// They are configured directly in the Firebase Console (Authentication -> Sign-in method).
// const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID; // Needed if enabling Google Sign-In
// const githubClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID; // Needed if enabling GitHub Sign-In

const requiredClientConfigs: { [key: string]: string | undefined } = {
  NEXT_PUBLIC_FIREBASE_API_KEY: firebaseApiKey,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebaseAuthDomain,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebaseProjectId,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: firebaseStorageBucket, // Still part of standard Firebase config
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: firebaseMessagingSenderId,
  NEXT_PUBLIC_FIREBASE_APP_ID: firebaseAppId,
};

let allClientConfigsPresent = true;
for (const key in requiredClientConfigs) {
  if (!requiredClientConfigs[key]) {
    allClientConfigsPresent = false;
    const message =
      `Firebase CLIENT SDK configuration variable ${key} is missing. ` +
      "Please ensure it is set in your .env.local file and that these environment variables are also configured in your Vercel project settings. ";
    // Log error only once or in a more controlled way if needed
    if (typeof window !== 'undefined' && !(window as any).__firebaseConfigErrorShown) {
      console.error(`CRITICAL CLIENT SDK SETUP ERROR: ${message}`);
      (window as any).__firebaseConfigErrorShown = true;
    } else if (typeof window === 'undefined') { // For server-side logs during build
        console.error(`CRITICAL CLIENT SDK SETUP ERROR (Build Time): ${message}`);
    }
  }
}

const firebaseConfig: FirebaseOptions = {
  apiKey: firebaseApiKey,
  authDomain: firebaseAuthDomain,
  projectId: firebaseProjectId,
  storageBucket: firebaseStorageBucket,
  messagingSenderId: firebaseMessagingSenderId,
  appId: firebaseAppId,
};

if (typeof window !== 'undefined') {
  if (allClientConfigsPresent) {
    // console.log("Firebase Client SDK: Configured with Project ID:", firebaseProjectId);
  } else {
    // console.error("Firebase Client SDK: Missing one or more NEXT_PUBLIC_FIREBASE_... config variables. Check Vercel environment variables.");
  }
}

let app;
if (!getApps().length) {
  if (allClientConfigsPresent) {
    try {
      app = initializeApp(firebaseConfig);
    } catch (e: any) {
      console.error("Firebase Client SDK: Initialization FAILED.", e.message, e.code);
      app = null;
    }
  } else {
    if (typeof window !== 'undefined') { // Only log this on the client
        console.error("Firebase Client SDK: Initialization SKIPPED due to missing configuration variables (check Vercel project settings). Firebase services will not be available.");
    }
    app = null;
  }
} else {
  app = getApp();
}

export const auth = app ? getAuth(app) : null!;
export const db = app ? getFirestore(app) : null!;
// Cloudinary is used for paper file storage, so Firebase Storage might not be actively used for that.
// export const storage = app ? getStorage(app) : null!;

export const googleAuthCredentialProvider = new GoogleAuthProvider();
export const githubAuthCredentialProvider = new GithubAuthProvider();

export default firebaseConfig;
