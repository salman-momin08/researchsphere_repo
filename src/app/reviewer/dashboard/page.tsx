
"use client";

import { useEffect, useState } from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import type { Paper } from '@/types';
import PaperListItem from '@/components/papers/PaperListItem'; // Assuming you'll reuse this
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye, Info, FileText as FileTextIcon } from 'lucide-react'; // Changed icon
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { getPapersForReviewer } from '@/lib/paper-service';
import { toast } from '@/hooks/use-toast';

function ReviewerDashboardContent() {
  const { user } = useAuth();
  const [assignedPapers, setAssignedPapers] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && (user.role === "Reviewer" || user.isAdmin)) { // Admins might also see this
      setIsLoading(true);
      setError(null);
      getPapersForReviewer(user.id)
        .then((papers) => {
          setAssignedPapers(papers);
        })
        .catch((err) => {
          console.error("ReviewerDashboard: Error fetching assigned papers:", err);
          setError("Failed to load your assigned papers. Please try again later.");
          toast({ variant: "destructive", title: "Error Loading Papers", description: err.message || "Could not load assigned papers." });
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else if (user) {
        // User is logged in but not a reviewer or admin.
        // This case should ideally be handled by routing/ProtectedRoute if only reviewers can access.
        setError("You do not have permission to view this page or no papers are assigned.");
        setAssignedPapers([]);
        setIsLoading(false);
    } else {
      setAssignedPapers([]);
      setIsLoading(false);
    }
  }, [user]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <LoadingSpinner size={48} />
        <p className="ml-3">Loading assigned papers...</p>
      </div>
    );
  }

  return (
    <div className="container py-8 md:py-12 px-4">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center">
          <Eye className="mr-3 h-8 w-8 text-primary" /> Reviewer Dashboard
        </h1>
        {/* Future: Button for "View Review Guidelines" or similar */}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <Info className="h-4 w-4" />
          <AlertTitle>Could Not Load Assigned Papers</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!error && assignedPapers.length === 0 && !isLoading && (
        <div className="text-center py-10 border-2 border-dashed rounded-lg">
          <FileTextIcon className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Papers Assigned for Review</h2>
          <p className="text-muted-foreground mb-6">
            It looks like you currently have no papers assigned to you for review.
          </p>
          {/* Optional: Link to profile or other relevant sections */}
        </div>
      )}

      {!error && assignedPapers.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {assignedPapers.map((paper) => (
            <PaperListItem key={paper.id} paper={paper} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewerDashboardPage() {
  return (
    <ProtectedRoute>
      <ReviewerDashboardContent />
    </ProtectedRoute>
  );
}
