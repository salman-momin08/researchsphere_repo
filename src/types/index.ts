export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isAdmin?: boolean; // For admin panel access
}

export type PaperStatus = 
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Action Required"
  | "Accepted"
  | "Rejected"
  | "Payment Pending"
  | "Published";

export interface Paper {
  id: string;
  userId: string;
  title: string;
  abstract: string;
  authors: string[]; // Array of author names
  keywords: string[];
  fileUrl?: string; // URL to the stored PDF/DOCX file
  fileName?: string;
  uploadDate: string; // ISO date string
  status: PaperStatus;
  plagiarismScore?: number | null; // 0 to 1
  plagiarismReport?: {
    highlightedSections: string[];
  } | null;
  acceptanceProbability?: number | null; // 0 to 1
  acceptanceReport?: {
    reasoning: string;
  } | null;
  adminFeedback?: string | null;
  submissionDate?: string | null; // ISO date string, after payment
}
