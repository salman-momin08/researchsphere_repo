
"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { plagiarismCheck, PlagiarismCheckOutput } from '@/ai/flows/plagiarism-check';
import { acceptanceProbability, AcceptanceProbabilityOutput } from '@/ai/flows/acceptance-probability';
import PlagiarismReport from '@/components/papers/PlagiarismReport';
import AcceptanceProbabilityReport from '@/components/papers/AcceptanceProbabilityReport';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Sparkles, ShieldCheck, BarChart3, AlertTriangle, Info } from 'lucide-react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';

const preCheckSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  paperText: z.string().min(50, "Paper text/abstract must be at least 50 characters.").max(10000, "Paper text is too long (max 10000 chars)."), // Increased limit
});

type PreCheckFormValues = z.infer<typeof preCheckSchema>;

function AiPreCheckContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismCheckOutput | null>(null);
  const [acceptanceResult, setAcceptanceResult] = useState<AcceptanceProbabilityOutput | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const form = useForm<PreCheckFormValues>({
    resolver: zodResolver(preCheckSchema),
    defaultValues: {
      title: "",
      paperText: "",
    },
  });

  const handleRunAIChecks = async (data: PreCheckFormValues) => {
    setIsLoading(true);
    setAiError(null);
    setPlagiarismResult(null);
    setAcceptanceResult(null);

    try {
      const contentToAnalyze = `${data.title}\n\n${data.paperText}`;
      
      // It's often better to run them sequentially if one depends on the other or to manage load,
      // but for independent checks, Promise.all is fine. Let's do sequential for clearer UI feedback.

      toast({title: "AI Analysis Started", description: "Checking plagiarism and acceptance probability..."});

      const plagiarism = await plagiarismCheck({ documentText: contentToAnalyze });
      setPlagiarismResult(plagiarism);
      toast({title: "Plagiarism Check Complete"});

      const acceptance = await acceptanceProbability({ paperText: contentToAnalyze });
      setAcceptanceResult(acceptance);
      toast({title: "Acceptance Probability Check Complete"});


    } catch (error) {
      console.error("AI Pre-check error:", error);
      const errorMessage = error instanceof Error ? error.message : "An error occurred during AI analysis.";
      setAiError(errorMessage);
      toast({variant: "destructive", title: "AI Analysis Failed", description: errorMessage});
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="w-full max-w-3xl mx-auto shadow-xl">
        <CardHeader className="text-center">
          <Sparkles className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl md:text-3xl">AI Pre-Submission Check</CardTitle>
          <CardDescription>
            Analyze your paper&apos;s title and abstract/content for potential plagiarism and estimated acceptance probability before formal submission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(handleRunAIChecks)} className="space-y-6">
            <div>
              <Label htmlFor="title">Paper Title</Label>
              <Input
                id="title"
                placeholder="Enter the title of your paper"
                {...form.register("title")}
                disabled={isLoading}
              />
              {form.formState.errors.title && (
                <p className="text-sm text-destructive mt-1">{form.formState.errors.title.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="paperText">Abstract / Paper Content</Label>
              <Textarea
                id="paperText"
                placeholder="Paste your abstract or the main content of your paper here for analysis..."
                rows={10}
                {...form.register("paperText")}
                disabled={isLoading}
              />
              {form.formState.errors.paperText && (
                <p className="text-sm text-destructive mt-1">{form.formState.errors.paperText.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <LoadingSpinner size={20} />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {isLoading ? "Analyzing..." : "Run AI Analysis"}
            </Button>
          </form>

          {aiError && (
            <Alert variant="destructive" className="mt-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>AI Analysis Error</AlertTitle>
              <AlertDescription>{aiError}</AlertDescription>
            </Alert>
          )}

          <div className="mt-8 space-y-6">
            {plagiarismResult && <PlagiarismReport result={plagiarismResult} />}
            {acceptanceResult && <AcceptanceProbabilityReport result={acceptanceResult} />}
          </div>
            
          {!isLoading && !plagiarismResult && !acceptanceResult && !aiError && (
             <Alert variant="default" className="mt-6 bg-secondary/30">
                <Info className="h-4 w-4"/>
                <AlertTitle>Get Started</AlertTitle>
                <AlertDescription>
                    Enter your paper's title and abstract/content above, then click &quot;Run AI Analysis&quot; to see the results.
                </AlertDescription>
            </Alert>
          )}

        </CardContent>
      </Card>
    </div>
  );
}

export default function AiPreCheckPage() {
  return (
    <ProtectedRoute>
      <AiPreCheckContent />
    </ProtectedRoute>
  );
}
