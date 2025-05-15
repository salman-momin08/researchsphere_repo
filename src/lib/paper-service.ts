
"use client";

import type { Paper, PaperStatus, User } from '@/types';
import { allMockPapers as initialMockPapers } from '@/lib/mock-data'; // Assuming mock-data.ts exports this

// Initialize papers from localStorage or use initial mock data
let allMockPapers: Paper[] = [];

if (typeof window !== 'undefined') {
  const storedPapers = localStorage.getItem('mockPapers');
  if (storedPapers) {
    allMockPapers = JSON.parse(storedPapers).map((p: any) => ({
      ...p,
      uploadDate: new Date(p.uploadDate).toISOString(), // Ensure dates are ISO strings
      submissionDate: p.submissionDate ? new Date(p.submissionDate).toISOString() : null,
      paymentDueDate: p.paymentDueDate ? new Date(p.paymentDueDate).toISOString() : null,
      paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    }));
  } else {
    allMockPapers = initialMockPapers.map(p => ({...p})); // Create a mutable copy
    localStorage.setItem('mockPapers', JSON.stringify(allMockPapers));
  }
}


const savePapersToLocalStorage = () => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('mockPapers', JSON.stringify(allMockPapers));
  }
};

export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'status' | 'userId' | 'fileUrl' | 'fileName'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File, // Keep for fileName
  userIdClient: string
): Promise<Paper> => {
  console.log(`paper-service (addPaper - MOCK): Called for userId: ${userIdClient}, fileName: ${fileToUpload.name}, paymentOption: ${paperData.paymentOption}`);

  const newId = (allMockPapers.length + 1 + Math.random()).toString();
  const now = new Date();
  let status: PaperStatus = 'Submitted';
  let paymentDueDate: string | null = null;
  let submissionDate: string | null = now.toISOString(); // Submitted now if not payLater

  if (paperData.paymentOption === 'payLater') {
    status = 'Payment Pending';
    const dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    paymentDueDate = dueDate.toISOString();
    submissionDate = null; // Submission happens after payment for payLater
  }

  const newPaper: Paper = {
    id: newId,
    userId: userIdClient,
    title: paperData.title,
    abstract: paperData.abstract,
    authors: paperData.authors,
    keywords: paperData.keywords,
    fileName: fileToUpload.name,
    fileUrl: `/uploads/mock/${fileToUpload.name}`, // Mock URL
    uploadDate: now.toISOString(),
    status: status,
    paymentOption: paperData.paymentOption,
    paymentDueDate: paymentDueDate,
    submissionDate: submissionDate,
    paidAt: paperData.paymentOption === 'payNow' ? now.toISOString() : null,
    plagiarismScore: null, // Mock default
    acceptanceProbability: null, // Mock default
  };

  allMockPapers.push(newPaper);
  savePapersToLocalStorage();
  console.log(`paper-service (addPaper - MOCK): Paper added to mock data. New ID: ${newPaper.id}`);
  return newPaper;
};

export const getPaper = async (paperId: string): Promise<Paper | null> => {
  console.log(`paper-service (getPaper - MOCK): Fetching paper with ID: ${paperId}`);
  const paper = allMockPapers.find(p => p.id === paperId) || null;
  if (paper) {
    console.log(`paper-service (getPaper - MOCK): Paper ${paperId} found in mock data.`);
  } else {
    console.warn(`paper-service (getPaper - MOCK): Paper ${paperId} not found in mock data.`);
  }
  return paper;
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  console.log(`paper-service (getUserPapers - MOCK): Fetching papers for user ID: ${userId}`);
  const userPapers = allMockPapers.filter(p => p.userId === userId).sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
  console.log(`paper-service (getUserPapers - MOCK): Found ${userPapers.length} papers for user ${userId}.`);
  return userPapers;
};

export const getAllPapers = async (): Promise<Paper[]> => {
  console.log("paper-service (getAllPapers - MOCK): Fetching all papers (admin).");
  // Admins see all papers
  const sortedPapers = [...allMockPapers].sort((a,b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
  console.log(`paper-service (getAllPapers - MOCK): Returning ${sortedPapers.length} papers.`);
  return sortedPapers;
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  console.log(`paper-service (updatePaperStatus - MOCK): Updating status for paper ${paperId} to ${status}. Payment details:`, paymentDetails);
  const paperIndex = allMockPapers.findIndex(p => p.id === paperId);
  if (paperIndex === -1) {
    console.error(`paper-service (updatePaperStatus - MOCK): Paper ${paperId} not found.`);
    throw new Error(`Paper with ID ${paperId} not found.`);
  }

  allMockPapers[paperIndex].status = status;
  if (paymentDetails?.paidAt) {
    allMockPapers[paperIndex].paidAt = new Date(paymentDetails.paidAt).toISOString();
  }
  if (status === 'Submitted' && paymentDetails?.paidAt) {
    allMockPapers[paperIndex].submissionDate = new Date().toISOString();
    allMockPapers[paperIndex].paymentDueDate = null;
  } else if (status === 'Payment Pending' && !allMockPapers[paperIndex].paymentDueDate) {
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + 2);
    allMockPapers[paperIndex].paymentDueDate = dueDate.toISOString();
  }


  savePapersToLocalStorage();
  console.log(`paper-service (updatePaperStatus - MOCK): Status updated for paper ${paperId}.`);
  return { ...allMockPapers[paperIndex] };
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id'>>): Promise<Paper> => {
  console.log(`paper-service (updatePaperData - MOCK): Updating data for paper ${paperId}. Data:`, data);
  const paperIndex = allMockPapers.findIndex(p => p.id === paperId);
  if (paperIndex === -1) {
    console.error(`paper-service (updatePaperData - MOCK): Paper ${paperId} not found.`);
    throw new Error(`Paper with ID ${paperId} not found.`);
  }

  allMockPapers[paperIndex] = { ...allMockPapers[paperIndex], ...data };
  savePapersToLocalStorage();
  console.log(`paper-service (updatePaperData - MOCK): Data updated for paper ${paperId}.`);
  return { ...allMockPapers[paperIndex] };
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  console.log("paper-service (getPublishedPapers - MOCK): Fetching published papers.");
  const published = allMockPapers.filter(p => p.status === 'Published').sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
  console.log(`paper-service (getPublishedPapers - MOCK): Found ${published.length} published papers.`);
  return published;
};

// Helper to simulate file download for mock fileUrl
export const simulateFileDownload = (fileUrl: string, fileName?: string) => {
  const mockContent = `This is a mock download for the file originally named: ${fileName || 'paper.pdf'}.\nIts mock URL was: ${fileUrl}\nIn a real system, the actual file content would be downloaded here.`;
  const blob = new Blob([mockContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName || 'downloaded_paper_details'}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
