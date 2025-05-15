import * as admin from 'firebase-admin';

const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });
    console.log('Firebase Admin SDK initialized successfully.');
  } catch (error: any) {
    console.error('Firebase Admin SDK initialization error:', error.message);
    // Optionally throw the error or handle it as per your app's needs
    // For now, we'll log it and let other parts of the app decide how to handle uninitialized admin SDK
  }
}

export const verifyIdToken = async (token: string): Promise<admin.auth.DecodedIdToken | null> => {
  if (!admin.apps.length || !admin.auth()) {
    console.error('Firebase Admin SDK not initialized. Cannot verify ID token.');
    return null; // Or throw an error
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying ID token:', error);
    return null;
  }
};

export default admin;
