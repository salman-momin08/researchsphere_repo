"use client";

import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PaperListItem from "@/components/papers/PaperListItem";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import type { Paper } from "@/types";
import { PlusCircle, FileText, Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

// Mock data for papers
const mockPapers: Paper[] = [
  {
    id: "1",
    userId: "1",
    title: "The Future of AI in Academic Research",
    abstract: "This paper explores the potential impact of artificial intelligence on academic research methodologies and publication processes...",
    authors: ["Dr. Alice Wonderland", "Dr. Bob The Builder"],
    keywords: ["AI", "Academia", "Future", "Research"],
    uploadDate: new Date("2023-10-15T10:00:00Z").toISOString(),
    status: "Accepted",
    plagiarismScore: 0.05,
    acceptanceProbability: 0.85,
    fileName: "future_of_ai.pdf"
  },
  {
    id: "2",
    userId: "1",
    title: "Quantum Computing: A New Paradigm",
    abstract: "An in-depth analysis of quantum computing principles and its applications in solving complex problems...",
    authors: ["Dr. Jane Doe"],
    keywords: ["Quantum Computing", "Physics",", Technology"],
    uploadDate: new Date("2023-11-01T14:30:00Z").toISOString(),
    status: "Under Review",
    plagiarismScore: 0.12,
    acceptanceProbability: 0.60,
    fileName: "quantum_paradigm.docx"
  },
  {
    id: "3",
    userId: "1",
    title: "Sustainable Energy Solutions for Urban Environments",
    abstract: "Investigating innovative sustainable energy solutions to address the growing demands of urban environments and mitigate climate change.",
    authors: ["Prof. John Smith", "Dr. Emily White"],
    keywords: ["Sustainability", "Urban Planning", "Renewable Energy", "Climate Change"],
    uploadDate: new Date("2024-01-20T09:15:00Z").toISOString(),
    status: "Payment Pending",
    plagiarismScore: 0.08,
    acceptanceProbability: 0.72,
    fileName: "sustainable_urban_energy.pdf"
  },
    {
    id: "4",
    userId: "1",
    title: "The Role of Gut Microbiota in Human Health",
    abstract: "A comprehensive review of current research on the gut microbiota and its profound impact on various aspects of human health and disease.",
    authors: ["Dr. Sarah Miller", "Dr. Kevin Lee"],
    keywords: ["Microbiome", "Gut Health", "Immunology", "Medicine"],
    uploadDate: new Date("2024-02-10T16:45:00Z").toISOString(),
    status: "Action Required",
    adminFeedback: "Please address reviewer comments regarding methodology section.",
    plagiarismScore: 0.03,
    acceptanceProbability: 0.65,
    fileName: "gut_microbiota_review.docx"
  }
];


function DashboardContent() {
  const { user } = useAuth();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoadingPapers, setIsLoadingPapers] = useState(true);

  useEffect(() => {
    // Simulate fetching user's papers
    if (user) {
      setIsLoadingPapers(true);
      setTimeout(() => {
        // In a real app, filter papers by user.id
        const userPapers = mockPapers.filter(p => p.userId === user.id || user.isAdmin); // Admin sees all for now
        setPapers(userPapers);
        setIsLoadingPapers(false);
      }, 1000);
    }
  }, [user]);

  if (isLoadingPapers) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/></div>;
  }

  return (
    <div className="container py-8 md:py-12">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Your Dashboard</h1>
        <Link href="/submit">
          <Button size="lg">
            <PlusCircle className="mr-2 h-5 w-5" /> Submit New Paper
          </Button>
        </Link>
      </div>

      {papers.length === 0 ? (
        <Alert className="bg-secondary">
          <FileText className="h-4 w-4" />
          <AlertTitle>No Papers Submitted Yet</AlertTitle>
          <AlertDescription>
            You haven&apos;t submitted any papers. Click the &quot;Submit New Paper&quot; button to get started.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {papers.map((paper) => (
            <PaperListItem key={paper.id} paper={paper} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
