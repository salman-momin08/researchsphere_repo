
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
          if (user.isAdmin) {
            console.log("DashboardContent (Admin): Fetching all papers from mock service.");
            fetchedPapers = await getAllPapers();
          } else {
            console.log(`DashboardContent (User ${user.id}): Fetching user papers from mock service.`);
            fetchedPapers = await getUserPapers(user.id);
          }
          setPapers(fetchedPapers);
          console.log("DashboardContent: Papers fetched successfully from mock service:", fetchedPapers.length);
        } catch (error: any) {
          console.error("DashboardContent: Failed to fetch papers from mock service:", error);
          toast({ variant: "destructive", title: "Error Loading Papers", description: error.message || "Could not load your papers." });
        } finally {
          setIsLoadingPapers(false);
        }
      };
      fetchPapers();
    } else {
      // if user is null and not loading, means they are logged out or auth still initializing
      if(!user && !isLoadingPapers) {
        setPapers([]); // Clear papers if user logs out
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // Removed toast from deps as it's stable

  if (isLoadingPapers) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2">Loading papers...</p></div>;
  }

  return (
    <div className="container py-8 md:py-12 px-4">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Your Dashboard</h1>
        {!user?.isAdmin && (
          <Link href="/submit">
            <Button size="lg" className="w-full md:w-auto">
              <PlusCircle className="mr-2 h-5 w-5" /> Submit New Paper
            </Button>
          </Link>
        )}
      </div>

      {papers.length === 0 && !user?.isAdmin ? (
        <Alert className="bg-secondary">
          <FileText className="h-4 w-4" />
          <AlertTitle>No Papers Submitted Yet</AlertTitle>
          <AlertDescription>
            You haven&apos;t submitted any papers. Click the &quot;Submit New Paper&quot; button to get started.
          </AlertDescription>
        </Alert>
      ) : papers.length === 0 && user?.isAdmin ? (
         <Alert className="bg-secondary">
          <FileText className="h-4 w-4" />
          <AlertTitle>No Papers on Platform</AlertTitle>
          <AlertDescription>
            There are currently no papers submitted to the platform.
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
