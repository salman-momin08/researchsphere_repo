
export interface User {
  id: string; // Firebase UID
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isAdmin?: boolean;

  // Fields for profile completion, managed by mock/localStorage
  username?: string | null;
  phoneNumber?: string | null;
  institution?: string | null;
  role?: "Author" | "Reviewer" | "Admin" | null; // Role can be Admin if email matches MOCK_ADMIN_EMAIL
  researcherId?: string | null;
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

export interface Paper {
  id: string; // Generated ID for mock data
  userId: string; // Firebase UID of the submitter
  title: string;
  abstract: string;
  authors: string[];
  keywords: string[];

  fileName?: string; // Original filename from upload
  fileUrl?: string; // Mock path, e.g., /uploads/mock/fileName.pdf

  uploadDate: string; // ISO date string
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
  submissionDate?: string | null; // ISO date string
  paymentDueDate?: string | null; // ISO date string
  paymentOption?: "payNow" | "payLater" | null;
  paidAt?: string | null; // ISO date string
}
