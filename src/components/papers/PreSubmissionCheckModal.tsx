
"use client";

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import PlagiarismReport from '@/components/papers/PlagiarismReport';
import AcceptanceProbabilityReport from '@/components/papers/AcceptanceProbabilityReport';
import { plagiarismCheck, PlagiarismCheckOutput } from '@/ai/flows/plagiarism-check';
import { acceptanceProbability, AcceptanceProbabilityOutput } from '@/ai/flows/acceptance-probability';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle, Sparkles } from 'lucide-react';
import { Separator } from '../ui/separator';

interface PreSubmissionCheckModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  checkData: { title: string; abstract: string; fileName: string } | null;
  onConfirmSubmit: () => void; // Called when user decides to submit after seeing AI results
}

export default function PreSubmissionCheckModal({ isOpen, onOpenChange, checkData, onConfirmSubmit }: PreSubmissionCheckModalProps) {
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismCheckOutput | null>(null);
  const [acceptanceResult, setAcceptanceResult] = useState<AcceptanceProbabilityOutput | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && checkData && !plagiarismResult && !acceptanceResult && !isLoadingAI && !aiError) {
      const performAIChecks = async () => {
        setIsLoadingAI(true);
        setAiError(null); // Clear previous errors
        // Results are reset when modal closes or checkData changes below

        try {
          const documentContentForAI = `${checkData.title}\n\n${checkData.abstract}`;
          
          // Ensure AI flows are available. Add a small delay if needed for flows to register in dev.
          // await new Promise(resolve => setTimeout(resolve, 500)); 

          const [plagiarism, acceptance] = await Promise.all([
            plagiarismCheck({ documentText: documentContentForAI }),
            acceptanceProbability({ paperText: documentContentForAI })
          ]);

          setPlagiarismResult(plagiarism);
          setAcceptanceResult(acceptance);
        } catch (error) {
          console.error("AI Pre-check error:", error);
          const errorMessage = error instanceof Error ? error.message : "An error occurred during AI analysis.";
          setAiError(errorMessage);
        } finally {
          setIsLoadingAI(false);
        }
      };
      performAIChecks();
    }
    
    if (!isOpen) {
        // Reset state when modal is closed
        setPlagiarismResult(null);
        setAcceptanceResult(null);
        setAiError(null);
        setIsLoadingAI(false); // Ensure loading is also reset
    }
  }, [isOpen, checkData]); // Removed plagiarismResult, acceptanceResult, isLoadingAI, aiError from deps to avoid re-triggering on their change

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmitAnyway = () => {
    onConfirmSubmit();
    // onOpenChange(false); // The parent form will close it after submission logic
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) {
            // Explicitly reset state when dialog is closed by user (e.g., clicking outside)
            setPlagiarismResult(null);
            setAcceptanceResult(null);
            setAiError(null);
            setIsLoadingAI(false);
        }
        onOpenChange(open);
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center text-xl">
            <Sparkles className="mr-2 h-5 w-5 text-primary" />
            Pre-Submission AI Analysis
          </DialogTitle>
          {checkData && (
            <DialogDescription>
              Review the AI-generated insights for your paper: <strong>{checkData.fileName}</strong>.
              This analysis is based on the title and abstract.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto px-1">
          {isLoadingAI && (
            <div className="flex flex-col items-center justify-center py-10">
              <LoadingSpinner size={32} />
              <p className="mt-2 text-muted-foreground">Analyzing title and abstract...</p>
            </div>
          )}

          {aiError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>AI Analysis Error</AlertTitle>
              <AlertDescription>{aiError}</AlertDescription>
            </Alert>
          )}

          {!isLoadingAI && !aiError && plagiarismResult && (
            <PlagiarismReport result={plagiarismResult} />
          )}
          {!isLoadingAI && !aiError && acceptanceResult && (
            <AcceptanceProbabilityReport result={acceptanceResult} />
          )}

          {!isLoadingAI && !aiError && plagiarismResult && acceptanceResult && (
            <>
              <Separator className="my-4" />
              <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Ready to Proceed?</AlertTitle>
                  <AlertDescription>
                    You can now choose to submit your paper or cancel and make revisions based on the AI feedback.
                  </AlertDescription>
              </Alert>
            </>
          )}
           {!isLoadingAI && !aiError && !plagiarismResult && !acceptanceResult && checkData && (
             <p className="text-sm text-center text-muted-foreground">AI analysis results will appear here once processing is complete.</p>
           )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isLoadingAI}>
            Cancel
          </Button>
          <Button onClick={handleSubmitAnyway} disabled={isLoadingAI || !!aiError || !plagiarismResult || !acceptanceResult}>
            {isLoadingAI ? "Analyzing..." : "Submit Paper Anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
