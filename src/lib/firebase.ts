
import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const firebaseAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const firebaseStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const firebaseMessagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const firebaseAppId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

const requiredConfigs: { [key: string]: string | undefined } = {
  NEXT_PUBLIC_FIREBASE_API_KEY: firebaseApiKey,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebaseAuthDomain,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebaseProjectId,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: firebaseStorageBucket,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: firebaseMessagingSenderId,
  NEXT_PUBLIC_FIREBASE_APP_ID: firebaseAppId,
};

let allConfigsPresent = true;
for (const key in requiredConfigs) {
  if (!requiredConfigs[key]) {
    allConfigsPresent = false;
    const message =
      `Firebase CLIENT SDK configuration variable ${key} is missing. ` +
      "Please ensure it is set in your .env.local file and the development server has been restarted. ";

    if (typeof window !== 'undefined') {
      console.error(message); 
    } else {
      console.error(`CRITICAL CLIENT SDK SETUP ERROR: ${message}`);
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
  console.log("Firebase Client SDK: Attempting to initialize with Project ID:", firebaseProjectId);
  console.log("Firebase Client SDK: Using Auth Domain:", firebaseAuthDomain);
  if (!firebaseAuthDomain) {
    console.error("Firebase Client SDK: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is undefined. This will likely cause auth/unauthorized-domain or auth/configuration-not-found errors.");
  }
   if (!firebaseApiKey) {
    console.error("Firebase Client SDK: NEXT_PUBLIC_FIREBASE_API_KEY is undefined. This will likely cause auth/api-key-not-valid errors.");
  }
}


let app;
if (!getApps().length) {
  if (allConfigsPresent) { 
    try {
      app = initializeApp(firebaseConfig);
      if (typeof window !== 'undefined') {
        console.log("Firebase Client SDK: Initialized successfully.");
      }
    } catch (e: any) {
      console.error("Firebase Client SDK: Initialization FAILED.", e.message, e.code);
      app = null; // Ensure app is null if init fails
    }
  } else {
    console.error("Firebase Client SDK: Initialization SKIPPED due to missing configuration variables. Firebase services will not be available.");
    app = null;
  }
} else {
  app = getApp(); 
  if (typeof window !== 'undefined') {
      console.log("Firebase Client SDK: Using existing app.");
  }
}

export const auth = app ? getAuth(app) : null!; 
export const db = app ? getFirestore(app) : null!; // Firestore DB if needed, not for MongoDB Atlas
export const storage = app ? getStorage(app) : null!; // Firebase Storage


export const googleAuthCredentialProvider = new GoogleAuthProvider();
export const githubAuthCredentialProvider = new GithubAuthProvider();

export default firebaseConfig;
