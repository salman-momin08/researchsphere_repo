
import type { NextApiResponse } from 'next';
import dbConnect from '@/lib/mongodb';
import UserModel, { IUser } from '@/models/mongo/user.model';
import withAuth, { NextApiRequestWithUser } from '@/middleware/withAuth';
import type { User as ClientUser } from '@/types';

async function handler(req: NextApiRequestWithUser, res: NextApiResponse) {
  const { userId } = req.query;
  const firebaseUser = req.user; // From withAuth middleware

  if (!firebaseUser) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  await dbConnect();

  if (req.method === 'GET') {
    // User can fetch their own profile, or an admin can fetch any profile
    if (firebaseUser.uid !== userId && !firebaseUser.admin) { // Assuming 'admin' boolean flag on decoded token
        const userProfile = await UserModel.findById(firebaseUser.uid).select('-__v'); // Exclude version key
         if (!userProfile) {
            return res.status(404).json({ message: 'User profile not found for authenticated user' });
        }
        return res.status(200).json(userProfile);
    }
    // If admin or fetching own profile
    try {
      const user = await UserModel.findById(userId).select('-__v');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      return res.status(200).json(user);
    } catch (error: any) {
      console.error(`Error fetching user ${userId}:`, error);
      return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
  } else if (req.method === 'PUT') {
    if (firebaseUser.uid !== userId) {
      return res.status(403).json({ message: 'Forbidden: You can only update your own profile.' });
    }
    try {
      const { displayName, username, role, phoneNumber, institution, researcherId } = req.body as Partial<ClientUser>;
      
      const updateData: Partial<IUser> = {};
      if (displayName !== undefined) updateData.displayName = displayName;
      if (role !== undefined) updateData.role = role;
      if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
      if (institution !== undefined) updateData.institution = institution;
      if (researcherId !== undefined) updateData.researcherId = researcherId;

      // Handle username update and uniqueness check
      if (username !== undefined) {
        const currentUser = await UserModel.findById(userId);
        if (currentUser && currentUser.username !== username) {
          const existingUserByUsername = await UserModel.findOne({ username: username, _id: { $ne: userId } });
          if (existingUserByUsername) {
            return res.status(409).json({ message: 'Username already taken' });
          }
          updateData.username = username;
        } else if (!currentUser?.username && username) { // Setting username for the first time
            const existingUserByUsername = await UserModel.findOne({ username: username });
            if (existingUserByUsername) {
                return res.status(409).json({ message: 'Username already taken' });
            }
            updateData.username = username;
        }
      }
      
      // Handle phone number update and uniqueness check
      if (phoneNumber !== undefined) {
        const currentUser = await UserModel.findById(userId);
        if (currentUser && currentUser.phoneNumber !== phoneNumber) {
            if(phoneNumber === "" || phoneNumber === null) { // Allowing to clear phone number
                updateData.phoneNumber = null;
            } else {
                const existingUserByPhone = await UserModel.findOne({ phoneNumber: phoneNumber, _id: { $ne: userId } });
                if (existingUserByPhone) {
                    return res.status(409).json({ message: 'Phone number already in use' });
                }
                updateData.phoneNumber = phoneNumber;
            }
        } else if (!currentUser?.phoneNumber && phoneNumber) { // Setting phone number for the first time
            const existingUserByPhone = await UserModel.findOne({ phoneNumber: phoneNumber });
            if (existingUserByPhone) {
                return res.status(409).json({ message: 'Phone number already in use' });
            }
            updateData.phoneNumber = phoneNumber;
        }
      }


      // Users cannot update their email, _id, or isAdmin status via this endpoint
      // photoURL might be updated if it comes from Firebase Auth sync, not directly user input here

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: 'No update data provided' });
      }

      const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData, { new: true }).select('-__v');
      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found for update' });
      }
      return res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });
    } catch (error: any) {
      console.error(`Error updating user ${userId}:`, error);
       if (error.code === 11000) { // MongoDB duplicate key error
        return res.status(409).json({ message: 'Update conflict (e.g., duplicate username/phone)', error: error.message });
      }
      return res.status(500).json({ message: 'Internal server error during profile update', error: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

export default withAuth(handler);
