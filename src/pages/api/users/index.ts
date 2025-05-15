
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '@/lib/mongodb';
import UserModel, { IUser } from '@/models/mongo/user.model';
import type { User as ClientUser } from '@/types'; // Assuming this is your client-side User type
import withAuth, { NextApiRequestWithUser } from '@/middleware/withAuth';
import {NextResponse} from 'next/server';

// This handler is for POST (create user)
// GET all users might be an admin-only endpoint, not implemented here for brevity
async function handler(req: NextApiRequestWithUser, res: NextApiResponse) {
  await dbConnect();

  if (req.method === 'POST') {
    try {
      const firebaseUser = req.user; // From withAuth middleware
      if (!firebaseUser || firebaseUser.uid !== req.body.id) {
        return res.status(403).json({ message: 'Forbidden: UID mismatch or unauthenticated user for create' });
      }

      const { id, email, displayName, username, role, photoURL, phoneNumber, institution, researcherId, isAdmin } = req.body as ClientUser;
      
      // Check if user already exists by _id (Firebase UID)
      const existingUserById = await UserModel.findById(id);
      if (existingUserById) {
        return res.status(200).json({ message: 'User already exists', user: existingUserById });
      }
      
      // Check for username uniqueness
      if (username) {
        const existingUserByUsername = await UserModel.findOne({ username });
        if (existingUserByUsername) {
          return res.status(409).json({ message: 'Username already taken' });
        }
      }
      // Check for email uniqueness (MongoDB level, Firebase Auth also enforces this)
      if (email) {
        const existingUserByEmail = await UserModel.findOne({ email });
        if (existingUserByEmail) {
           // This might happen if Firebase Auth user exists but MongoDB profile was not created
           // Or, if trying to create a new user with an email already in Mongo (less likely with Firebase Auth first)
          return res.status(409).json({ message: 'Email already associated with another profile' });
        }
      }
       // Check for phone number uniqueness
      if (phoneNumber) {
        const existingUserByPhone = await UserModel.findOne({ phoneNumber });
        if (existingUserByPhone) {
          return res.status(409).json({ message: 'Phone number already taken' });
        }
      }


      const newUserDoc: Partial<IUser> = {
        _id: id, // Firebase UID
        email,
        displayName,
        username: username || null,
        photoURL: photoURL || null,
        phoneNumber: phoneNumber || null,
        institution: institution || null,
        role: role || null,
        researcherId: researcherId || null,
        isAdmin: isAdmin || false, // Ensure isAdmin comes from a trusted source or defaults
      };

      const user = await UserModel.create(newUserDoc);
      return res.status(201).json({ message: 'User profile created successfully', user });
    } catch (error: any) {
      console.error('Error creating user profile in MongoDB:', error);
      if (error.code === 11000) { // MongoDB duplicate key error
        return res.status(409).json({ message: 'User profile creation conflict (e.g., duplicate email/username/phone if constraints missed)', error: error.message });
      }
      return res.status(500).json({ message: 'Internal server error while creating user profile', error: error.message });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

export default withAuth(handler);
