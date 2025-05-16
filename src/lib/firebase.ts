
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
for (const key in requiredClientConfigs) {
  if (!requiredClientConfigs[key]) { // Checks for falsy values (e.g., undefined, empty string)
    allClientConfigsPresent = false;
    if (typeof window !== 'undefined' && !(window as any).__firebaseConfigErrorShownClient) {
      console.error(`CRITICAL CLIENT SDK SETUP ERROR: Firebase CLIENT SDK configuration variable ${key} is missing. Please ensure it is set in your .env.local file and the development server has been restarted. Firebase services will be unavailable.`);
      (window as any).__firebaseConfigErrorShownClient = true; // Show only once per client session
    } else if (typeof window === 'undefined' && !(global as any).__firebaseConfigErrorShownServer) {
      // This log might appear during build if env vars are missing in the build environment
      console.error(`CRITICAL CLIENT SDK SETUP ERROR (Build/Server Context): Firebase CLIENT SDK configuration variable ${key} is missing. Firebase services will be unavailable.`);
      (global as any).__firebaseConfigErrorShownServer = true; // Show only once per server/build process
    }
    break;
  }
}

// Construct the config object only if all variables are present
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
      // console.info("Firebase Client SDK: Initialized successfully with Project ID:", appFirebaseConfig.projectId);
    } catch (e: any) {
      let detailedErrorMessage = "Firebase Client SDK: Initialization FAILED (initializeApp call).";
      if (e && e.message) detailedErrorMessage += ` Message: ${e.message}.`;
      if (e && e.code) detailedErrorMessage += ` Code: ${e.code}.`;
      console.error(detailedErrorMessage, e); // Log the full error object
      app = null; // Ensure app is null if init fails
    }
  } else {
    app = getApp();
    // console.info("Firebase Client SDK: Re-using existing Firebase app instance.");
  }

  if (app) {
    try {
      auth = getAuth(app);
      db = getFirestore(app);
    } catch (e: any) {
      console.error("Firebase Client SDK: Failed to get Auth/Firestore instance from initialized app.", e.message, e.code, e);
      auth = null;
      db = null;
    }
  }
} else {
  // This message is now logged when allClientConfigsPresent is false
  // console.error("Firebase Client SDK: Initialization SKIPPED due to missing configuration variables. Firebase services will not be available.");
}

const googleAuthCredentialProvider = new GoogleAuthProvider();
const githubAuthCredentialProvider = new GithubAuthProvider();

export { auth, db, googleAuthCredentialProvider, githubAuthCredentialProvider };
// Removed the default export: export default appFirebaseConfig;
