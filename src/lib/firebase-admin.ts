
import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

let adminApp: admin.app.App | null = null;

console.log('Attempting to initialize Firebase Admin SDK...');
console.log(`Firebase Admin SDK - Project ID from env: ${projectId ? projectId.substring(0, 5) + '...' : 'MISSING'}`);
console.log(`Firebase Admin SDK - Client Email from env: ${clientEmail ? clientEmail.substring(0, 10) + '...' : 'MISSING'}`);
console.log(`Firebase Admin SDK - Private Key from env: ${privateKey ? 'PRESENT' : 'MISSING'}`);

if (!admin.apps.length) {
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'CRITICAL ERROR: Missing Firebase Admin SDK credentials (FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, or FIREBASE_ADMIN_PRIVATE_KEY) in .env.local. Firebase Admin SDK will not be initialized.'
    );
    adminApp = null; // Explicitly set to null
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
      adminApp = null; // Ensure adminApp is null on error
    }
  }
} else {
  adminApp = admin.app();
  console.log('Firebase Admin SDK: Using existing app.');
}

if (!adminApp) {
    console.error('Firebase Admin SDK: adminApp instance is NULL after initialization attempt. Token verification will fail.');
}

export const verifyIdToken = async (token: string): Promise<admin.auth.DecodedIdToken | null> => {
  if (!adminApp) {
    console.error('Firebase Admin SDK (verifyIdToken): adminApp is null. Cannot verify ID token. Check Admin SDK initialization and environment variables.');
    return null;
  }
  try {
    const decodedToken = await admin.auth(adminApp).verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying ID token in verifyIdToken:', error);
    return null;
  }
};

export const firebaseAdminApp = adminApp; // Export the potentially null app
export default admin;
