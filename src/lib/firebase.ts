
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

for (const key in requiredConfigs) {
  if (!requiredConfigs[key]) {
    // Throwing error during module load might be too disruptive for server components
    // Console.error is a safer way to inform during development
    // On the client-side, this will be visible in the browser console.
    // On the server-side (build or SSR), this will be visible in the terminal.
    const message = 
      `Firebase configuration variable ${key} is missing. ` +
      "Please ensure it is set in your .env.local file and the development server has been restarted. " +
      "This can lead to Firebase initialization errors (e.g., auth/api-key-not-valid).";
    
    if (typeof window !== 'undefined') {
      console.error(message); // Log error in browser
    } else {
      // For server-side, throwing an error might be preferable to stop the build/start
      // But to keep app potentially running for other parts, we can log it.
      // For a hard stop, uncomment the throw new Error(message) below.
      console.error(`CRITICAL SETUP ERROR: ${message}`);
      // throw new Error(message); // Uncomment this if you want the build/server start to fail hard
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

// Initialize Firebase
let app;
// Check if Firebase has already been initialized to avoid re-initialization error
if (!getApps().length) {
  // Only initialize if no apps exist and all required configs are present
  // The check above only logs; for a hard stop, you'd need to prevent initialization here
  // if any requiredConfigs[key] was undefined.
  // However, Firebase SDK itself will throw an error if critical parts like apiKey are missing.
  app = initializeApp(firebaseConfig);
} else {
  app = getApp(); // Get the default app if already initialized
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Export providers for convenience
export const googleAuthCredentialProvider = new GoogleAuthProvider();
export const githubAuthCredentialProvider = new GithubAuthProvider();

export default firebaseConfig;
