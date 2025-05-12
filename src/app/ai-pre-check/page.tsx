
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
import { Sparkles, ShieldCheck, BarChart3, AlertTriangle, Info, UploadCloud, Download } from 'lucide-react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';

// Function to simulate reading file content (replace with actual parsers in a real app)
async function readFileContentSimulated(file: File): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(`\n\n[Simulated content of ${file.name}. This is a placeholder for actual file content extraction.]\n\n`);
    }, 500); // Simulate async reading
  });
}


const preCheckSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  paperText: z.string().max(10000, "Abstract/Text content is too long (max 10000 chars).").optional(),
  file: z.any() // For FileList, client-side validation
    .optional()
    .refine(files => {
      if (typeof window === 'undefined' || !files || !(files instanceof FileList) || files.length === 0) return true;
      return files[0].size <= 5 * 1024 * 1024; // 5MB
    }, "File size must be less than 5MB.")
    .refine(files => {
      if (typeof window === 'undefined' || !files || !(files instanceof FileList) || files.length === 0) return true;
      return ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(files[0].type);
    }, "Only PDF or DOCX files are allowed."),
}).refine(data => data.paperText || (typeof window !== 'undefined' && data.file instanceof FileList && data.file.length > 0), {
  message: "Either abstract/text content or a file upload is required.",
  path: ["paperText"], // This error will appear under the paperText field or use a general form error.
});


type PreCheckFormValues = z.infer<typeof preCheckSchema>;

function AiPreCheckContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismCheckOutput | null>(null);
  const [acceptanceResult, setAcceptanceResult] = useState<AcceptanceProbabilityOutput | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const form = useForm<PreCheckFormValues>({
    resolver: zodResolver(preCheckSchema),
    defaultValues: {
      title: "",
      paperText: "",
      file: undefined,
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setFileName(files[0].name);
      form.setValue("file", files, { shouldValidate: true });
    } else {
      setFileName(null);
      form.setValue("file", undefined, { shouldValidate: true });
    }
  };

  const handleRunAIChecks = async (data: PreCheckFormValues) => {
    setIsLoading(true);
    setAiError(null);
    setPlagiarismResult(null);
    setAcceptanceResult(null);

    let fileContentForAnalysis = "";
    const fileToUpload = (typeof window !== 'undefined' && data.file instanceof FileList && data.file.length > 0) ? data.file[0] : null;

    if (fileToUpload) {
      try {
        fileContentForAnalysis = await readFileContentSimulated(fileToUpload);
      } catch (readError) {
        console.error("File reading error:", readError);
        const errorMessage = readError instanceof Error ? readError.message : "Could not read file content.";
        setAiError(`File processing error: ${errorMessage}`);
        toast({variant: "destructive", title: "File Error", description: errorMessage});
        setIsLoading(false);
        return;
      }
    }
    
    if (!data.paperText && !fileToUpload) {
        form.setError("paperText", { type: "manual", message: "Please provide either abstract/text or upload a file." });
        toast({variant: "destructive", title: "Input Missing", description: "Please provide content for analysis."});
        setIsLoading(false);
        return;
    }


    let contentToAnalyze = `${data.title}`;
    if (data.paperText) {
        contentToAnalyze += `\n\nAbstract/Provided Text:\n${data.paperText}`;
    }
    if (fileContentForAnalysis) {
        contentToAnalyze += `\n\nUploaded File Content Simulaton:\n${fileContentForAnalysis}`;
    }
    
    // Ensure total content length for AI is reasonable if needed (Genkit handles large inputs but good to be mindful)
    if (contentToAnalyze.length < 50) { // title + some content
        setAiError("Content is too short for meaningful analysis. Please provide more details in the title, abstract/text, or upload a file.");
        toast({variant: "destructive", title: "Content Too Short", description: "Provide more details."});
        setIsLoading(false);
        return;
    }


    try {
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

  const handleDownloadFeedback = () => {
    if (!plagiarismResult && !acceptanceResult) {
      toast({ variant: "destructive", title: "No Feedback", description: "Run AI analysis first to generate feedback." });
      return;
    }

    let feedbackText = `ResearchSphere AI Pre-Check Feedback\n`;
    feedbackText += `Date: ${new Date().toLocaleDateString()}\n`;
    if (form.getValues("title")) {
      feedbackText += `Paper Title: ${form.getValues("title")}\n`;
    }
    if (fileName) {
      feedbackText += `Analyzed File: ${fileName}\n`;
    }
    feedbackText += `=====================================\n\n`;

    if (plagiarismResult) {
      feedbackText += `PLAGIARISM REPORT\n`;
      feedbackText += `-----------------\n`;
      feedbackText += `Score: ${(plagiarismResult.plagiarismScore * 100).toFixed(1)}%\n`;
      if (plagiarismResult.highlightedSections && plagiarismResult.highlightedSections.length > 0) {
        feedbackText += `Potentially Plagiarized Sections:\n`;
        plagiarismResult.highlightedSections.forEach(section => {
          feedbackText += `  - "...${section}..."\n`;
        });
      } else {
        feedbackText += `No specific sections highlighted by AI as potentially plagiarized.\n`;
      }
      feedbackText += `\n\n`;
    }

    if (acceptanceResult) {
      feedbackText += `ACCEPTANCE PROBABILITY REPORT\n`;
      feedbackText += `-----------------------------\n`;
      feedbackText += `Estimated Probability: ${(acceptanceResult.probabilityScore * 100).toFixed(1)}%\n`;
      feedbackText += `AI Reasoning: ${acceptanceResult.reasoning}\n`;
    }

    const blob = new Blob([feedbackText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI_PreCheck_Feedback_${form.getValues("title")?.replace(/\s+/g, '_') || 'Report'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Feedback Downloaded", description: "Check your downloads folder." });
  };

  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="w-full max-w-3xl mx-auto shadow-xl">
        <CardHeader className="text-center">
          <Sparkles className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl md:text-3xl">AI Pre-Submission Check</CardTitle>
          <CardDescription>
            Analyze your paper for potential plagiarism and acceptance probability. You can paste content or upload a file.
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
              <Label htmlFor="file-upload">Upload Paper (Optional, PDF/DOCX, max 5MB)</Label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md border-input hover:border-primary transition-colors">
                <div className="space-y-1 text-center">
                  <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
                  <div className="flex text-sm text-muted-foreground">
                    <label
                      htmlFor="file-upload"
                      className="relative cursor-pointer rounded-md font-medium text-primary hover:text-primary/80 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-ring"
                    >
                      <span>Upload a file</span>
                      <input id="file-upload" type="file" className="sr-only" 
                            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            {...form.register("file")}
                            onChange={handleFileChange} 
                            disabled={isLoading}
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  {fileName ? (
                    <p className="text-xs text-foreground">{fileName}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">PDF, DOCX up to 5MB</p>
                  )}
                </div>
              </div>
              {form.formState.errors.file && <p className="text-sm text-destructive mt-1">{ (form.formState.errors.file as any)?.message || "Invalid file"}</p>}
            </div>

            <div>
              <Label htmlFor="paperText">Abstract / Additional Text Content (Optional if file uploaded)</Label>
              <Textarea
                id="paperText"
                placeholder="Paste abstract or other relevant text here. If a file is uploaded, its content will be prioritized for analysis."
                rows={8}
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
            
          {!isLoading && (plagiarismResult || acceptanceResult) && (
            <Button onClick={handleDownloadFeedback} className="w-full mt-6" variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Download Feedback Report
            </Button>
          )}

          {!isLoading && !plagiarismResult && !acceptanceResult && !aiError && (
             <Alert variant="default" className="mt-6 bg-secondary/30">
                <Info className="h-4 w-4"/>
                <AlertTitle>Get Started</AlertTitle>
                <AlertDescription>
                    Enter your paper's title, abstract/text, and/or upload a file, then click &quot;Run AI Analysis&quot; to see the results.
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

