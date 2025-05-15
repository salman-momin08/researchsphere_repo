
import type { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import { verifyIdToken } from '@/lib/firebase-admin';
import type admin from 'firebase-admin';

export interface NextApiRequestWithUser extends NextApiRequest {
  user?: admin.auth.DecodedIdToken;
}

const withAuth = (handler: NextApiHandler) => 
  async (req: NextApiRequestWithUser, res: NextApiResponse) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ message: 'Unauthorized: Invalid token format' });
    }

    try {
      const decodedToken = await verifyIdToken(idToken);
      if (!decodedToken) {
        return res.status(401).json({ message: 'Unauthorized: Invalid token' });
      }
      req.user = decodedToken; // Attach user to request object
      return handler(req, res);
    } catch (error) {
      console.error('Error verifying auth token in middleware:', error);
      return res.status(401).json({ message: 'Unauthorized: Token verification failed' });
    }
};

export default withAuth;
