
import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Read environment variables
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
let missingConfigKey: string | null = null;

for (const key in requiredClientConfigs) {
  if (!requiredClientConfigs[key]) {
    allClientConfigsPresent = false;
    missingConfigKey = key;
    // Log error only once per context (client/server)
    if (typeof window !== 'undefined') { // Client-side
      if (!(window as any).__firebaseConfigErrorShownClient) {
        console.error(`CRITICAL CLIENT SDK SETUP ERROR: Firebase CLIENT SDK configuration variable ${key} is missing. Please ensure it is set in your environment variables (e.g., .env.local and Vercel project settings). Firebase services will be unavailable.`);
        (window as any).__firebaseConfigErrorShownClient = true;
      }
    } else { // Server-side (build time or SSR)
       if (!(global as any).__firebaseConfigErrorShownServerBuild) {
        console.error(`CRITICAL CLIENT SDK SETUP ERROR (Build/Server Context): Firebase CLIENT SDK configuration variable ${key} is missing. Please ensure it is set in your Vercel project environment variables. Firebase services will be unavailable.`);
        (global as any).__firebaseConfigErrorShownServerBuild = true;
      }
    }
    break; 
  }
}

const appFirebaseConfig: FirebaseOptions | null = allClientConfigsPresent
  ? {
      apiKey: firebaseApiKey!,
      authDomain: firebaseAuthDomain!,
      projectId: firebaseProjectId!,
      storageBucket: firebaseStorageBucket!,
      messagingSenderId: firebaseMessagingSenderId!,
      appId: firebaseAppId!,
    }
  : null;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (appFirebaseConfig) {
  if (!getApps().length) {
    try {
      app = initializeApp(appFirebaseConfig);
    } catch (e: any) {
      console.error("Firebase Client SDK: initializeApp() FAILED.", e.message, e.code);
      app = null; 
    }
  } else {
    app = getApp();
  }

  if (app) {
    try {
      auth = getAuth(app);
      db = getFirestore(app);
    } catch (e: any) {
      console.error("Firebase Client SDK: Failed to get Auth/Firestore instance from initialized app.", e.message, e.code);
      auth = null;
      db = null;
    }
  }
} else {
  if (!missingConfigKey && typeof window === 'undefined' && !(global as any).__firebaseGenericConfigErrorServer) {
      // This means allClientConfigsPresent was false but the loop didn't set missingConfigKey (shouldn't happen often)
      console.error("Firebase Client SDK (Build/Server Context): Initialization SKIPPED due to missing configuration variables. Full config object could not be constructed.");
      (global as any).__firebaseGenericConfigErrorServer = true;
  }
  // If missingConfigKey is set, the specific error is already logged.
  // The `auth` and `db` will remain `null`.
}

const googleAuthCredentialProvider = new GoogleAuthProvider();
const githubAuthCredentialProvider = new GithubAuthProvider();

export { auth, db, googleAuthCredentialProvider, githubAuthCredentialProvider };
