
import type { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import { verifyIdToken, firebaseAdminApp } from '@/lib/firebase-admin'; // Import firebaseAdminApp
import type admin from 'firebase-admin';

export interface NextApiRequestWithUser extends NextApiRequest {
  user?: admin.auth.DecodedIdToken;
}

const withAuth = (handler: NextApiHandler) =>
  async (req: NextApiRequestWithUser, res: NextApiResponse) => {
    const authHeader = req.headers.authorization;

    if (!firebaseAdminApp) {
      console.error('withAuth Middleware: Firebase Admin SDK (firebaseAdminApp) is not initialized. Authentication will fail. Check server logs for Admin SDK initialization errors.');
      return res.status(500).json({ message: 'Internal Server Error: Auth system not configured.' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('withAuth Middleware: No token provided or invalid format.');
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    if (!idToken) {
      console.log('withAuth Middleware: Token format invalid (empty after Bearer).');
      return res.status(401).json({ message: 'Unauthorized: Invalid token format' });
    }

    // console.log(`withAuth Middleware: Attempting to verify token starting with: ${idToken.substring(0, 20)}...`);

    try {
      const decodedToken = await verifyIdToken(idToken);
      if (!decodedToken) {
        console.log('withAuth Middleware: Token verification failed (verifyIdToken returned null). Token might be invalid, expired, or Admin SDK misconfigured.');
        return res.status(401).json({ message: 'Unauthorized: Invalid token' });
      }
      // console.log(`withAuth Middleware: Token verified successfully for UID: ${decodedToken.uid}`);
      req.user = decodedToken;
      return handler(req, res);
    } catch (error) { // This catch might be redundant if verifyIdToken handles its own errors, but good for safety.
      console.error('withAuth Middleware: Unexpected error during token verification process:', error);
      return res.status(401).json({ message: 'Unauthorized: Token verification failed unexpectedly' });
    }
  };

export default withAuth;
