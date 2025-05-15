
import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

let adminApp: admin.app.App | null = null;

if (!admin.apps.length) {
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'CRITICAL ERROR: Missing Firebase Admin SDK credentials (FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, or FIREBASE_ADMIN_PRIVATE_KEY) in .env.local. Firebase Admin SDK will not be initialized.'
    );
  } else {
    try {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: privateKey,
        }),
      });
      console.log('Firebase Admin SDK initialized successfully.');
    } catch (error: any) {
      console.error('Firebase Admin SDK initialization error:', error.message);
      // adminApp remains null
    }
  }
} else {
  adminApp = admin.app();
  console.log('Firebase Admin SDK: Using existing app.');
}

export const verifyIdToken = async (token: string): Promise<admin.auth.DecodedIdToken | null> => {
  if (!adminApp || !admin.auth(adminApp)) { // Check if adminApp was successfully initialized
    console.error('Firebase Admin SDK not initialized or auth service unavailable. Cannot verify ID token.');
    return null;
  }
  try {
    const decodedToken = await admin.auth(adminApp).verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying ID token:', error);
    return null;
  }
};

// Exporting the admin instance itself might be useful, but ensure checks for its existence where used.
export const firebaseAdminApp = adminApp;
export default admin; // Default export for compatibility if used elsewhere
