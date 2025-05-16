
import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, type Auth } from "firebase/auth"; // Import Auth type
import { getFirestore, type Firestore } from "firebase/firestore"; // Import Firestore type

const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const firebaseAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const firebaseStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const firebaseMessagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const firebaseAppId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

const requiredClientConfigs: { [key: string]: string | undefined } = {
  NEXT_PUBLIC_FIREBASE_API_KEY: firebaseApiKey,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebaseAuthDomain,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebaseProjectId,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: firebaseStorageBucket,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: firebaseMessagingSenderId,
  NEXT_PUBLIC_FIREBASE_APP_ID: firebaseAppId,
};

let allClientConfigsPresent = true;
for (const key in requiredClientConfigs) {
  if (!requiredClientConfigs[key]) {
    allClientConfigsPresent = false;
    // Reduced console verbosity, critical error logged once.
    if (typeof window !== 'undefined' && !(window as any).__firebaseConfigErrorShownClient) {
      console.error(`CRITICAL CLIENT SDK SETUP ERROR: Firebase CLIENT SDK configuration variable ${key} is missing. Please ensure it is set in your .env.local file and that these environment variables are also configured in your Vercel project settings. Firebase services will be unavailable.`);
      (window as any).__firebaseConfigErrorShownClient = true;
    } else if (typeof window === 'undefined' && !(global as any).__firebaseConfigErrorShownServer) {
      console.error(`CRITICAL CLIENT SDK SETUP ERROR (Build Time): Firebase CLIENT SDK configuration variable ${key} is missing. Firebase services will be unavailable.`);
      (global as any).__firebaseConfigErrorShownServer = true;
    }
    break; // Stop checking after the first missing config
  }
}

let app;
if (!getApps().length) {
  if (allClientConfigsPresent) {
    try {
      app = initializeApp(firebaseConfig);
      // console.info("Firebase Client SDK: Initialized with Project ID:", firebaseProjectId);
    } catch (e: any) {
      console.error("Firebase Client SDK: Initialization FAILED.", e.message, e.code);
      app = null;
    }
  } else {
    // Error already logged above if configs are missing
    app = null;
  }
} else {
  app = getApp();
}

const firebaseConfig: FirebaseOptions = {
  apiKey: firebaseApiKey,
  authDomain: firebaseAuthDomain,
  projectId: firebaseProjectId,
  storageBucket: firebaseStorageBucket,
  messagingSenderId: firebaseMessagingSenderId,
  appId: firebaseAppId,
};

// Export auth and db, explicitly allowing them to be null if app is null
export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Firestore | null = app ? getFirestore(app) : null;

export const googleAuthCredentialProvider = new GoogleAuthProvider();
export const githubAuthCredentialProvider = new GithubAuthProvider();

export default firebaseConfig;
