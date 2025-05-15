
import type { Model, Document } from 'mongoose';
import { Schema, model, models } from 'mongoose';

// Interface for Paper document
export interface IPaper extends Document {
  userId: string; // Corresponds to Firebase Auth UID of the user
  title: string;
  abstract: string;
  authors: string[];
  keywords: string[];
  
  fileName: string; // Original name of the uploaded paper file
  fileMimeType: string; // Mime type of the file e.g. 'application/pdf'
  fileData: Buffer; // Binary data of the file (for small files embedded in MongoDB)

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
  paymentOption?: "payNow" | "payLater" | null;
  paymentDueDate?: Date | null;
  paidAt?: Date | null;
  
  createdAt: Date;
  updatedAt: Date;
}

const paperSchema = new Schema<IPaper>({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true },
  abstract: { type: String, required: true, trim: true },
  authors: [{ type: String, trim: true }],
  keywords: [{ type: String, trim: true }],
  
  fileName: { type: String, required: true, trim: true },
  fileMimeType: { type: String, required: true, trim: true },
  fileData: { type: Buffer, required: true },

  uploadDate: { type: Date, default: Date.now, index: true },
  submissionDate: { type: Date },
  status: {
    type: String,
    enum: ["Draft", "Submitted", "Under Review", "Action Required", "Accepted", "Rejected", "Payment Pending", "Published"],
    default: "Submitted",
    index: true,
  },
  plagiarismScore: { type: Number, default: null },
  plagiarismReport: {
    _id: false,
    highlightedSections: [{ type: String }],
    default: null,
  },
  acceptanceProbability: { type: Number, default: null },
  acceptanceReport: {
    _id: false,
    reasoning: { type: String },
    default: null,
  },
  adminFeedback: { type: String, default: null },
  paymentOption: { type: String, enum: ["payNow", "payLater"], default: null },
  paymentDueDate: { type: Date, default: null },
  paidAt: { type: Date, default: null },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

const PaperModel = models.Paper as Model<IPaper> || model<IPaper>('Paper', paperSchema);

export default PaperModel;
