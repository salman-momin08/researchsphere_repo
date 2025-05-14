
import type { Model, Document } from 'mongoose';
import { Schema, model, models } from 'mongoose';

// Interface for Paper document (similar to src/types/index.ts Paper)
export interface IPaper extends Document {
  userId: string; // Corresponds to Firebase Auth UID of the user
  title: string;
  abstract: string;
  authors: string[];
  keywords: string[];
  fileName?: string;
  fileUrl?: string;
  uploadDate: Date;
  submissionDate?: Date | null;
  status: "Draft" | "Submitted" | "Under Review" | "Action Required" | "Accepted" | "Rejected" | "Payment Pending" | "Published";
  plagiarismScore?: number | null;
  plagiarismReport?: {
    highlightedSections: string[];
  } | null;
  acceptanceProbability?: number | null;
  acceptanceReport?: {
    reasoning: string;
  } | null;
  adminFeedback?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paperSchema = new Schema<IPaper>({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true },
  abstract: { type: String, required: true, trim: true },
  authors: [{ type: String, trim: true }],
  keywords: [{ type: String, trim: true }],
  fileName: { type: String, trim: true },
  fileUrl: { type: String, trim: true },
  uploadDate: { type: Date, default: Date.now },
  submissionDate: { type: Date },
  status: {
    type: String,
    enum: ["Draft", "Submitted", "Under Review", "Action Required", "Accepted", "Rejected", "Payment Pending", "Published"],
    default: "Submitted",
  },
  plagiarismScore: { type: Number },
  plagiarismReport: {
    _id: false, // No _id for subdocument
    highlightedSections: [{ type: String }],
  },
  acceptanceProbability: { type: Number },
  acceptanceReport: {
    _id: false, // No _id for subdocument
    reasoning: { type: String },
  },
  adminFeedback: { type: String },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

const PaperModel = models.Paper as Model<IPaper> || model<IPaper>('Paper', paperSchema);

export default PaperModel;
