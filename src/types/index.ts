
import type { Timestamp } from "firebase/firestore";

export interface User {
  id: string; // Firebase UID, also used as Firestore document ID
  userId: string; // Explicitly storing Firebase UID within the document
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  username?: string | null;
  phoneNumber?: string | null;
  institution?: string | null;
  role?: "Author" | "Reviewer" | "Admin" | null;
  researcherId?: string | null;
  isAdmin?: boolean;
  isSuspended?: boolean;
  createdAt?: string | Timestamp | null; // Allow null for flexibility
  updatedAt?: string | Timestamp | null; // Allow null for flexibility
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
  reviewerDisplayName?: string; // Added for admin/author view if needed
  comments: string;
  recommendation: 'Accept' | 'Reject' | 'Minor Revision' | 'Major Revision';
  rating?: {
    clarity?: number;
    originality?: number;
    relevance?: number;
    quality?: number;
  };
  submittedAt: string | Timestamp; // ISO date string or Timestamp
}

export interface Paper {
  id: string;
  userId: string;
  title: string;
  abstract: string;
  authors: string[];
  keywords: string[];
  fileName: string | null;
  fileUrl: string | null;
  uploadDate: string | Timestamp;
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
  submissionDate?: string | Timestamp | null;
  paymentDueDate?: string | Timestamp | null;
  paymentOption?: "payNow" | "payLater" | null;
  paidAt?: string | Timestamp | null;
  lastUpdatedAt?: string | Timestamp | null;
  assignedReviewerIds?: string[];
  reviews?: Review[];
}
