
// src/pages/api/users/check-phone.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/mongo/user.model';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { phone, userId } = req.query;

  if (!phone || typeof phone !== 'string') {
    // Allow empty phone check to pass, as phone is optional
    return res.status(200).json({ isTaken: false, message: 'Phone number not provided for check.' });
  }

  await dbConnect();

  try {
    const query: any = { phoneNumber: phone };
    if (userId && typeof userId === 'string') {
      // If userId is provided, we are checking if the phone number is used by *another* user
      query._id = { $ne: userId };
    }
    const existingUser = await UserModel.findOne(query);
    if (existingUser) {
      return res.status(200).json({ isTaken: true, message: 'Phone number is already in use.' });
    }
    return res.status(200).json({ isTaken: false });
  } catch (error: any) {
    console.error('Error checking phone number uniqueness:', error);
    return res.status(500).json({ message: 'Internal server error while checking phone number.', error: error.message });
  }
}
