
import type { Paper } from '@/types';

export const allMockPapers: Paper[] = [
  {
    id: "1", userId: "user1", title: "The Future of AI in Academic Research", 
    abstract: "This paper explores the potential impact of artificial intelligence on academic research methodologies and publication processes. It covers areas like automated literature reviews, AI-assisted writing and peer review, and the ethical implications of AI in academia.",
    authors: ["Dr. Alice Wonderland", "Dr. Bob The Builder"], keywords: ["AI", "Academia", "Future", "Research"],
    uploadDate: new Date("2023-10-15T10:00:00Z").toISOString(), status: "Accepted",
    plagiarismScore: 0.05, plagiarismReport: { highlightedSections: ["This specific phrase seems common.", "Another sentence here might be too similar."] },
    acceptanceProbability: 0.85, acceptanceReport: { reasoning: "The paper is well-structured, presents novel ideas, and has strong evidence. Clarity is excellent." },
    fileName: "future_of_ai.pdf", fileUrl: "/mock-files/future_of_ai.pdf"
  },
  {
    id: "2", userId: "user2", title: "Quantum Computing: A New Paradigm", 
    abstract: "An in-depth analysis of quantum computing principles and its applications in solving complex problems such as drug discovery, materials science, and cryptography. The paper also discusses current challenges and future prospects of quantum technology.",
    authors: ["Dr. Jane Doe"], keywords: ["Quantum Computing", "Physics", "Technology"],
    uploadDate: new Date("2023-11-01T14:30:00Z").toISOString(), status: "Under Review",
    plagiarismScore: 0.12, plagiarismReport: { highlightedSections: ["Section 3, paragraph 2 seems derivative."] },
    acceptanceProbability: 0.60, acceptanceReport: { reasoning: "Good potential but requires more experimental validation and clearer distinction from existing work." },
    fileName: "quantum_paradigm.docx", fileUrl: "/mock-files/quantum_paradigm.docx"
  },
  {
    id: "3", userId: "user1", title: "Sustainable Energy Solutions for Urban Environments", 
    abstract: "Investigating innovative sustainable energy solutions to address the growing demands of urban environments and mitigate climate change. This includes a review of solar, wind, and geothermal technologies, as well as smart grid implementations.",
    authors: ["Prof. John Smith", "Dr. Emily White"], keywords: ["Sustainability", "Urban Planning", "Renewable Energy", "Climate Change"],
    uploadDate: new Date("2024-01-20T09:15:00Z").toISOString(), status: "Payment Pending",
    plagiarismScore: 0.08, plagiarismReport: { highlightedSections: [] },
    acceptanceProbability: 0.72, acceptanceReport: { reasoning: "Relevant topic and well-researched. Awaiting payment to proceed with formal review." },
    fileName: "sustainable_urban_energy.pdf", fileUrl: "/mock-files/sustainable_urban_energy.pdf"
  },
  {
    id: "4", userId: "user3", title: "The Role of Gut Microbiota in Human Health", 
    abstract: "A comprehensive review of current research on the gut microbiota and its profound impact on various aspects of human health and disease, including metabolism, immunity, and neurological function. Potential therapeutic interventions are also discussed.",
    authors: ["Dr. Sarah Miller", "Dr. Kevin Lee", "Dr. Jane Doe"], keywords: ["Microbiome", "Gut Health", "Immunology", "Medicine"],
    uploadDate: new Date("2024-02-10T16:45:00Z").toISOString(), status: "Action Required",
    adminFeedback: "Please address reviewer comments regarding the methodology section. Specifically, provide more details on the statistical analysis used and clarify the participant selection criteria.",
    plagiarismScore: 0.03, plagiarismReport: { highlightedSections: [] },
    acceptanceProbability: 0.65, acceptanceReport: { reasoning: "The review is comprehensive but lacks a critical perspective on conflicting studies. Methodology needs clarification as per reviewer feedback." },
    fileName: "gut_microbiota_review.docx", fileUrl: "/mock-files/gut_microbiota_review.docx"
  },
  {
    id: "5", userId: "user2", title: "Exploring Deep Space Anomalies", 
    abstract: "A study of unusual phenomena observed in deep space, utilizing data from recent telescopic surveys. This paper attempts to categorize these anomalies and propose potential explanations.",
    authors: ["Dr. Cosmos Explorer", "Dr. Stella Nova"], keywords: ["Astronomy", "Space", "Anomalies"],
    uploadDate: new Date("2024-03-01T11:00:00Z").toISOString(), status: "Submitted",
    plagiarismScore: null, plagiarismReport: null,
    acceptanceProbability: null, acceptanceReport: null,
    fileName: "space_anomalies.pdf", fileUrl: "/mock-files/space_anomalies.pdf"
  }
];

// Function to find a paper by ID (useful for detail pages)
export const findMockPaperById = (id: string): Paper | undefined => {
  return allMockPapers.find(p => p.id === id);
};

// Function to get papers by user ID (useful for user dashboards)
export const getMockPapersByUserId = (userId: string): Paper[] => {
  return allMockPapers.filter(p => p.userId === userId);
};
