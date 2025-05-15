
// src/pages/api/users/check-username.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/mongo/user.model';
// No auth middleware here if it's a public check, 
// or add light auth if only logged-in users can check during profile update for others.
// For signup, it's often public. For profile update, it might be authenticated.
// For simplicity, making it public for now.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { username, userId } = req.query;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ message: 'Username query parameter is required.' });
  }

  await dbConnect();

  try {
    const query: any = { username: username };
    if (userId && typeof userId === 'string') {
      // If userId is provided, we are checking if the username is taken by *another* user
      query._id = { $ne: userId };
    }
    const existingUser = await UserModel.findOne(query);
    if (existingUser) {
      return res.status(200).json({ isTaken: true, message: 'Username is already taken.' });
    }
    return res.status(200).json({ isTaken: false });
  } catch (error: any) {
    console.error('Error checking username uniqueness:', error);
    return res.status(500).json({ message: 'Internal server error while checking username.', error: error.message });
  }
}
