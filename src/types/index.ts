
export interface User {
  id: string;
  email: string | null;
  displayName: string | null; // This will store Full Name
  photoURL?: string | null;
  isAdmin?: boolean; // For admin panel access

  // New fields from registration
  username?: string | null; // Now can be null
  phoneNumber?: string | null;
  institution?: string | null;
  role?: "Author" | "Reviewer" | "Admin" | null; // Now can be null
  researcherId?: string | null; // ORCID ID or other researcher ID
  // termsAccepted is usually for validation and not stored, but can be if needed for audit
}

export type PaperStatus = 
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Action Required"
  | "Accepted"
  | "Rejected"
  | "Payment Pending"
  | "Payment Overdue" // New status for client-side display
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
  submissionDate?: string | null; // ISO date string, after payment or if "Pay Now"
  paymentDueDate?: string | null; // ISO date string, for "Pay Later"
  paymentOption?: "payNow" | "payLater" | null;
  paidAt?: string | null; // ISO date string, when payment was made
}
