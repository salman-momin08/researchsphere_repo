
import type { Timestamp } from "firebase/firestore";

export interface User {
  id: string; // Firebase UID, also used as Firestore document ID
  userId: string; // Explicitly storing Firebase UID within the document
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  username?: string | null; // Kept optional, completion checked in AuthContext
  phoneNumber?: string | null; // Kept optional, completion checked in AuthContext
  institution?: string | null;
  role?: "Author" | "Reviewer" | "Admin" | null; // "Admin" role can be set if isAdmin is true. User selects Author/Reviewer.
  researcherId?: string | null;
  isAdmin?: boolean; // Primary flag for admin status
  isSuspended?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type PaperStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Action Required"
  | "Accepted"
  | "Rejected"
  | "Payment Pending"
  | "Payment Overdue"
  | "Published";

export interface Review {
  reviewerId: string; // UID of the reviewer
  reviewerDisplayName?: string; // For display purposes if needed
  comments: string;
  recommendation: 'Accept' | 'Reject' | 'Minor Revision' | 'Major Revision';
  rating?: {
    clarity?: number; // e.g., 1-5
    originality?: number;
    relevance?: number;
    quality?: number;
  };
  submittedAt: string;
}

export interface Paper {
  id: string;
  userId: string;
  title: string;
  abstract: string;
  authors: string[];
  keywords: string[];
  fileName: string | null;
  fileUrl: string | null; // Will be Cloudinary URL
  uploadDate: string;
  status: PaperStatus;
  plagiarismScore?: number | null;
  plagiarismReport?: {
    highlightedSections: string[];
  } | null;
  acceptanceProbability?: number | null;
  acceptanceReport?: {
    reasoning: string;
  } | null;
  adminFeedback?: string | null;
  submissionDate?: string | null;
  paymentDueDate?: string | null;
  paymentOption?: "payNow" | "payLater" | null;
  paidAt?: string | null;
  lastUpdatedAt?: string | null;
  assignedReviewerIds?: string[];
  reviews?: Review[];
}

export interface ContactSubmission {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  sentAt: string; // ISO date string
  isRead?: boolean; // Optional: for admins to mark as read
}
