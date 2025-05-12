
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
      `Firebase configuration variable ${key} is missing. ` +
      "Please ensure it is set in your .env.local file and the development server has been restarted. " +
      "This can lead to Firebase initialization errors (e.g., auth/api-key-not-valid or auth/configuration-not-found).";

    if (typeof window !== 'undefined') {
      console.error(message); // Log error in browser
    } else {
      console.error(`CRITICAL SETUP ERROR: ${message}`);
      // Consider throwing an error here if running in a Node.js environment (e.g., build time)
      // to make the failure more explicit: throw new Error(message);
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

// Log the authDomain to help debug auth/unauthorized-domain issues
if (typeof window !== 'undefined') { // Only log on client-side where auth happens
  console.log("Firebase SDK attempting to use Auth Domain:", firebaseAuthDomain);
  if (!firebaseAuthDomain) {
    console.error("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is undefined. This will likely cause auth/unauthorized-domain or auth/configuration-not-found errors.");
  }
}


// Initialize Firebase
let app;
// Check if Firebase has already been initialized to avoid re-initialization error
if (!getApps().length) {
  // Only initialize if no apps exist and all required configs are present
  if (allConfigsPresent) { // Check if all configurations were found
    app = initializeApp(firebaseConfig);
  } else {
    console.error("Firebase initialization skipped due to missing configuration variables. Firebase services will not be available.");
    // Optionally, you could throw an error here to halt execution if Firebase is critical
    // throw new Error("Firebase initialization failed due to missing configuration.");
  }
} else {
  app = getApp(); // Get the default app if already initialized
}

// Export auth, db, storage conditionally based on app initialization
// This prevents errors if initialization failed.
export const auth = app ? getAuth(app) : null!; // Use null assertion for now, but handle potential null elsewhere
export const db = app ? getFirestore(app) : null!;
export const storage = app ? getStorage(app) : null!;


// Export providers for convenience
export const googleAuthCredentialProvider = new GoogleAuthProvider();
export const githubAuthCredentialProvider = new GithubAuthProvider();

export default firebaseConfig;
