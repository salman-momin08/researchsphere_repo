
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
import { getUserPapers, getAllPapers } from "@/lib/paper-service";
import { useToast } from "@/hooks/use-toast";

function DashboardContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoadingPapers, setIsLoadingPapers] = useState(true);

  useEffect(() => {
    if (user) {
      setIsLoadingPapers(true);
      const fetchPapers = async () => {
        try {
          let fetchedPapers: Paper[];
          // In this context, a user on /user/dashboard should only see their own papers
          // Admins have a separate dashboard at /admin/dashboard
          if (user.id) {
            fetchedPapers = await getUserPapers(user.id);
          } else {
            fetchedPapers = [];
          }
          setPapers(fetchedPapers);
        } catch (error: any) {
          toast({ variant: "destructive", title: "Error Loading Papers", description: error.message || "Could not load your papers." });
        } finally {
          setIsLoadingPapers(false);
        }
      };
      fetchPapers();
    } else {
      if(!user && !isLoadingPapers) {
        setPapers([]); 
      }
    }
  }, [user, toast]); 

  if (isLoadingPapers && user) { // Only show global loading if user is present and papers are loading
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2">Loading papers...</p></div>;
  }
  
  // If not loading and no user, ProtectedRoute will handle it. 
  // This component assumes it's rendered when user is available.

  return (
    <div className="container py-8 md:py-12 px-4">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Your Dashboard</h1>
        <Link href="/user/submit">
          <Button size="lg" className="w-full md:w-auto">
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

export default function UserDashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
