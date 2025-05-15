
export interface User {
  id: string;
  email: string | null;
  displayName: string | null; 
  photoURL?: string | null;
  isAdmin?: boolean; 

  username?: string | null; 
  phoneNumber?: string | null;
  institution?: string | null;
  role?: "Author" | "Reviewer" | "Admin" | null; 
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
  id: string; // In MongoDB, this will be _id from the document
  userId: string;
  title: string;
  abstract: string;
  authors: string[]; 
  keywords: string[];
  
  // For MongoDB embedded file storage (small files)
  fileName?: string; // Original filename
  fileMimeType?: string; // e.g. 'application/pdf'
  // fileData: Buffer; // This is stored in MongoDB but NOT typically sent to client unless downloading

  // fileUrl is no longer used if embedding files. Download will be via API endpoint.
  // fileUrl?: string; 

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
  submissionDate?: string | null; 
  paymentDueDate?: string | null; 
  paymentOption?: "payNow" | "payLater" | null;
  paidAt?: string | null; 
}
