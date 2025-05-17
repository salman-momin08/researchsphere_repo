
"use client";

import { useEffect, useState } from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import type { Paper } from '@/types';
import PaperListItem from '@/components/papers/PaperListItem';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileText, UploadCloud, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { getUserPapers } from '@/lib/paper-service'; // Ensure this points to your Firestore service
import { toast }
 from '@/hooks/use-toast';
function AuthorDashboardContent() {
  const { user } = useAuth();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setIsLoading(true);
      setError(null);
      getUserPapers(user.id)
        .then((userPapers) => {
          setPapers(userPapers);
        })
        .catch((err) => {
          console.error("AuthorDashboard: Error fetching user papers:", err);
          setError("Failed to load your papers. Please try again later.");
          toast({ variant: "destructive", title: "Error Loading Papers", description: err.message || "Could not load your papers." });
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setPapers([]);
      setIsLoading(false);
    }
  }, [user]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <LoadingSpinner size={48} />
        <p className="ml-3">Loading your papers...</p>
      </div>
    );
  }

  return (
    <div className="container py-8 md:py-12 px-4">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center">
          <FileText className="mr-3 h-8 w-8 text-primary" /> Your Submissions
        </h1>
        <Link href="/author/submit">
          <Button size="lg">
            <UploadCloud className="mr-2 h-5 w-5" /> Submit New Paper
          </Button>
        </Link>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <Info className="h-4 w-4" />
          <AlertTitle>Could Not Load Papers</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!error && papers.length === 0 && !isLoading && (
        <div className="text-center py-10 border-2 border-dashed rounded-lg">
          <FileText className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Papers Submitted Yet</h2>
          <p className="text-muted-foreground mb-6">
            It looks like you haven&apos;t submitted any research papers.
          </p>
          <Link href="/author/submit">
            <Button size="lg">Start Your First Submission</Button>
          </Link>
        </div>
      )}

      {!error && papers.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {papers.map((paper) => (
            <PaperListItem key={paper.id} paper={paper} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AuthorDashboardPage() {
  return (
    <ProtectedRoute>
      <AuthorDashboardContent />
    </ProtectedRoute>
  );
}
