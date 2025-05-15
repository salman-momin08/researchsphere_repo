
import type { Model, Document } from 'mongoose';
import { Schema, model, models } from 'mongoose';

// Interface for User document (similar to src/types/index.ts User)
export interface IUser extends Document {
  _id: string; // Corresponds to Firebase Auth UID
  email: string | null;
  displayName: string | null;
  username?: string | null;
  photoURL?: string | null;
  phoneNumber?: string | null;
  institution?: string | null;
  role?: "Author" | "Reviewer" | "Admin" | null;
  researcherId?: string | null;
  isAdmin?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>({
  _id: { type: String, required: true }, // Using Firebase UID as _id
  email: { type: String, trim: true, index: true, unique: true, sparse: true, required: true },
  displayName: { type: String, trim: true },
  username: { type: String, trim: true, unique: true, sparse: true, minlength: 4, maxlength: 20 },
  photoURL: { type: String },
  phoneNumber: { type: String, trim: true, unique: true, sparse: true },
  institution: { type: String, trim: true },
  role: { type: String, enum: ["Author", "Reviewer", "Admin"] },
  researcherId: { type: String, trim: true },
  isAdmin: { type: Boolean, default: false },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  _id: false // Disable Mongoose default _id generation, we are providing it
});

userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });


// Using models.User to prevent OverwriteModelError in Next.js hot-reloading environments
const UserModel = models.User as Model<IUser> || model<IUser>('User', userSchema);

export default UserModel;
