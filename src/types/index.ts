
import type { Timestamp } from "firebase/firestore"; // Ensure Timestamp is imported if used here

export interface User {
  id: string; // Firebase UID, also used as Firestore document ID
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isAdmin?: boolean; // Stored in Firestore

  username?: string | null;    // Stored in Firestore
  phoneNumber?: string | null; // Stored in Firestore
  institution?: string | null; // Stored in Firestore
  role?: "Author" | "Reviewer" | "Admin" | null; // Stored in Firestore
  researcherId?: string | null;// Stored in Firestore
  isSuspended?: boolean; // New field for user suspension status
  createdAt?: string | Timestamp; // Firestore Timestamp on write, string on read (after conversion)
  updatedAt?: string | Timestamp; // Firestore Timestamp on write, string on read (after conversion)
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
  comments: string;
  recommendation: 'Accept' | 'Reject' | 'Minor Revision' | 'Major Revision';
  rating?: { // Optional detailed ratings
    clarity?: number; // e.g., 1-5
    originality?: number;
    relevance?: number;
    quality?: number;
  };
  submittedAt: string; // ISO date string of when the review was submitted
}

export interface Paper {
  id: string; // Firestore document ID
  userId: string; // Firebase UID of the submitter
  title: string;
  abstract: string;
  authors: string[];
  keywords: string[];

  fileName?: string | null; // Original filename from upload
  fileUrl?: string | null; // Download URL for the paper file

  uploadDate: string; // ISO date string (after conversion from Firestore Timestamp)
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
  submissionDate?: string | null; // ISO date string (after conversion from Firestore Timestamp)
  paymentDueDate?: string | null; // ISO date string (after conversion from Firestore Timestamp)
  paymentOption?: "payNow" | "payLater" | null;
  paidAt?: string | null; // ISO date string (after conversion from Firestore Timestamp)
  lastUpdatedAt?: string | Timestamp; // ISO date string (after conversion from Firestore Timestamp)
  assignedReviewerIds?: string[]; // Array of reviewer UIDs
  reviews?: Review[]; // Array of review objects
}

