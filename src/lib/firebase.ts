
import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const firebaseAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const firebaseStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const firebaseMessagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const firebaseAppId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

let appFirebaseConfig: FirebaseOptions | null = null;

if (
  firebaseApiKey &&
  firebaseAuthDomain &&
  firebaseProjectId &&
  firebaseStorageBucket &&
  firebaseMessagingSenderId &&
  firebaseAppId
) {
  appFirebaseConfig = {
    apiKey: firebaseApiKey,
    authDomain: firebaseAuthDomain,
    projectId: firebaseProjectId,
    storageBucket: firebaseStorageBucket,
    messagingSenderId: firebaseMessagingSenderId,
    appId: firebaseAppId,
  };
} else {
  console.error(
    "CRITICAL CLIENT SDK SETUP ERROR: One or more Firebase environment variables (NEXT_PUBLIC_FIREBASE_...) are missing. " +
    "Please ensure they are set in your .env.local file (for local development) " +
    "AND in your Vercel project environment variables (for deployment). " +
    "Firebase services will be unavailable."
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (appFirebaseConfig) {
  if (!getApps().length) {
    try {
      app = initializeApp(appFirebaseConfig);
    } catch (e: any) {
      console.error("Firebase Client SDK: initializeApp() FAILED.", e.message, e.code, "Config used:", appFirebaseConfig);
      app = null;
    }
  } else {
    app = getApp();
  }

  if (app) {
    try {
      auth = getAuth(app);
    } catch (e: any) {
      console.error("Firebase Client SDK: getAuth() FAILED.", e.message, e.code);
      auth = null;
    }
    try {
      db = getFirestore(app);
    } catch (e: any) {
      console.error("Firebase Client SDK: getFirestore() FAILED.", e.message, e.code);
      db = null;
    }
  }
} else {
  // This case is handled by the AuthContext to show an error message.
}

const googleAuthCredentialProvider = new GoogleAuthProvider();
const githubAuthCredentialProvider = new GithubAuthProvider();

export { auth, db, googleAuthCredentialProvider, githubAuthCredentialProvider };
