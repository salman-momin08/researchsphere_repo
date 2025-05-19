
"use client";

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { UploadCloud, Sparkles, Loader2, Download, AlertTriangle, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import PlagiarismReport from '@/components/papers/PlagiarismReport';
import AcceptanceProbabilityReport from '@/components/papers/AcceptanceProbabilityReport';
import { plagiarismCheck, PlagiarismCheckOutput, PlagiarismCheckInput } from '@/ai/flows/plagiarism-check';
import { acceptanceProbability, AcceptanceProbabilityOutput } from '@/ai/flows/acceptance-probability';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input'; // For title input

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];

const aiPreCheckSchema = z.object({
  title: z.string().min(1, "Paper title is required."),
  abstract: z.string().min(1, "Abstract is required."),
  file: z.custom<FileList>()
    .refine(files => files && files.length > 0, "A paper file is required.")
    .refine(files => files && files.length > 0 && files[0].size <= MAX_FILE_SIZE, `File size must be less than ${MAX_FILE_SIZE / (1024*1024)}MB.`)
    .refine(files => files && files.length > 0 && ALLOWED_FILE_TYPES.includes(files[0].type), "Only PDF, DOCX, or TXT files are allowed."),
});

type AiPreCheckFormValues = z.infer<typeof aiPreCheckSchema>;

function AiPreCheckContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismCheckOutput | null>(null);
  const [acceptanceResult, setAcceptanceResult] = useState<AcceptanceProbabilityOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [resultTitle, setResultTitle] = useState<string | null>(null); // To store title for the report

  const { control, handleSubmit, watch, setValue, formState: { errors, isValid, isDirty }, reset } = useForm<AiPreCheckFormValues>({
    resolver: zodResolver(aiPreCheckSchema),
    mode: 'onChange',
    defaultValues: {
      title: "",
      abstract: "",
      file: undefined,
    }
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setValue('file', files, { shouldValidate: true, shouldDirty: true });
      setSelectedFileName(files[0].name);
    } else {
      setValue('file', undefined as any, { shouldValidate: true, shouldDirty: true });
      setSelectedFileName(null);
    }
  };

  const onSubmit = async (data: AiPreCheckFormValues) => {
    setIsLoading(true);
    setError(null);
    setPlagiarismResult(null); // Clear previous results
    setAcceptanceResult(null); // Clear previous results
    setResultTitle(null); // Clear previous result title

    let documentTextForPlagiarism = `${data.title}\n\n${data.abstract}`;
    const file = data.file[0];
    let fileTypeForAI = file.type;

    if (file.type === "text/plain") {
      try {
        const textContent = await file.text();
        documentTextForPlagiarism += `\n\n--- Full File Content (from .txt) ---\n${textContent}`;
      } catch (e) {
        console.error("Error reading .txt file content:", e);
        toast({ variant: "destructive", title: "File Read Error", description: "Could not read the content of the .txt file." });
        setIsLoading(false);
        return;
      }
    }

    const plagiarismInput: PlagiarismCheckInput = {
      documentText: documentTextForPlagiarism,
      fileName: file.name,
      fileType: fileTypeForAI
    };

    try {
      const acceptanceInputText = `${data.title}\n\n${data.abstract}`;
      
      const [plagiarism, acceptance] = await Promise.all([
        plagiarismCheck(plagiarismInput),
        acceptanceProbability({ paperText: acceptanceInputText })
      ]);
      setPlagiarismResult(plagiarism);
      setAcceptanceResult(acceptance);
      setResultTitle(data.title); // Store the title for the current results
      toast({ title: "AI Pre-Check Complete", description: "Results are displayed below." });
    } catch (err: any) {
      const errorMessage = err.message || "An error occurred during AI analysis.";
      console.error("AI Pre-Check Error:", err);
      setError(errorMessage);
      toast({ variant: "destructive", title: "AI Analysis Failed", description: errorMessage });
    } finally {
      setIsLoading(false);
      // Clear form fields after analysis is done (success or error)
      reset(); // Resets form to defaultValues
      setValue('file', undefined as any, { shouldValidate: false }); // Explicitly reset file field for react-hook-form
      setSelectedFileName(null); // Clear the displayed file name
    }
  };

  const handleDownloadFeedback = () => {
    if (!plagiarismResult && !acceptanceResult) {
      toast({ variant: "destructive", title: "No Feedback", description: "No AI feedback available to download." });
      return;
    }
    let feedbackContent = `AI Pre-Check Feedback for Paper: ${resultTitle || 'Untitled Paper'}\n\n`;
    
    if (acceptanceResult) {
      feedbackContent += `--- Acceptance Probability Report ---\n`;
      feedbackContent += `Estimated Score: ${(acceptanceResult.probabilityScore * 100).toFixed(1)}%\n`;
      feedbackContent += `Reasoning: ${acceptanceResult.reasoning}\n\n`;
    } else {
      feedbackContent += `--- Acceptance Probability Report ---\nNot Available\n\n`;
    }

    if (plagiarismResult) {
      feedbackContent += `--- Plagiarism Report ---\n`;
      feedbackContent += `Plagiarism Score: ${(plagiarismResult.plagiarismScore === -1 ? 'N/A (Analysis Inconclusive)' : (plagiarismResult.plagiarismScore * 100).toFixed(1) + '%')}\n`;
      if (plagiarismResult.highlightedSections && plagiarismResult.highlightedSections.length > 0) {
        feedbackContent += `Potentially Reused Sections/Reasons:\n${plagiarismResult.highlightedSections.map(s => `- "${s}"`).join('\n')}\n`;
      } else if (plagiarismResult.plagiarismScore !== -1) {
        feedbackContent += `No specific sections highlighted for plagiarism concerns based on current analysis.\n`;
      }
      feedbackContent += `\n`;
    } else {
      feedbackContent += `--- Plagiarism Report ---\nNot Available\n\n`;
    }


    const blob = new Blob([feedbackContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(resultTitle || 'untitled_paper').replace(/[^\w\s]/gi, '').replace(/\s+/g, '_')}_AI_PreCheck_Feedback.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Feedback Downloaded", description: "AI Pre-Check feedback report has been downloaded." });
  };

  return (
    <div className="container py-8 md:py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-2xl mx-auto shadow-xl">
        <CardHeader className="text-center">
          <Sparkles className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-primary mb-2" />
          <CardTitle className="text-xl sm:text-2xl md:text-3xl">AI Pre-Submission Check</CardTitle>
          <CardDescription className="text-sm sm:text-base">
            Get AI-powered insights on plagiarism and acceptance probability. All fields are mandatory.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4 sm:space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Analysis Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="title" className={cn("font-medium", errors.title && "text-destructive")}>Paper Title *</Label>
              <Controller
                name="title"
                control={control}
                render={({ field }) => <Input {...field} id="title" placeholder="Enter your paper title" className="mt-1 text-sm sm:text-base" disabled={isLoading} />}
              />
              {errors.title && <p className="text-sm text-destructive mt-1">{errors.title.message}</p>}
            </div>
            <div>
              <Label htmlFor="abstract" className={cn("font-medium", errors.abstract && "text-destructive")}>Abstract *</Label>
              <Controller
                name="abstract"
                control={control}
                render={({ field }) => <Textarea {...field} id="abstract" placeholder="Paste your paper abstract here" rows={8} className="mt-1 text-sm sm:text-base" disabled={isLoading} />}
              />
              {errors.abstract && <p className="text-sm text-destructive mt-1">{errors.abstract.message}</p>}
            </div>
            <div>
              <Label htmlFor="file-upload-ai" className={cn("font-medium", errors.file && "text-destructive")}>Upload Paper (PDF, DOCX, or TXT, max 10MB) *</Label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md border-input hover:border-primary transition-colors">
                <div className="space-y-1 text-center">
                  <UploadCloud className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground" />
                  <div className="flex text-sm text-muted-foreground">
                    <label
                      htmlFor="file-upload-ai"
                      className="relative cursor-pointer rounded-md font-medium text-primary hover:text-primary/80 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-ring"
                    >
                      <span>Upload a file</span>
                      <input 
                        id="file-upload-ai" 
                        type="file" 
                        className="sr-only"
                        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                        onChange={handleFileChange}
                        disabled={isLoading}
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  {selectedFileName ? (
                    <p className="text-xs text-foreground">{selectedFileName}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">PDF, DOCX, TXT up to 10MB</p>
                  )}
                </div>
              </div>
              {errors.file && <p className="text-sm text-destructive mt-1">{errors.file.message as string}</p>}
            </div>
            <Alert variant="default">
              <Info className="h-4 w-4" />
              <AlertTitle className="font-semibold">Note on AI Analysis</AlertTitle>
              <AlertDescription className="text-xs sm:text-sm">
                For this pre-check, all fields including file upload are required. The AI analyzes your title and abstract. If a `.txt` file is uploaded, its content is also included in the analysis. For PDF/DOCX files, the AI considers the file's name and type for contextual understanding in its simulated plagiarism check; full content parsing of PDF/DOCX is not performed client-side in this pre-check. Acceptance probability is based on title and abstract.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row gap-2 pt-4">
            <Button type="submit" className="w-full sm:w-auto text-sm sm:text-base" disabled={isLoading || !isDirty || !isValid}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {isLoading ? "Analyzing..." : "Run AI Pre-Check"}
            </Button>
            {(plagiarismResult || acceptanceResult) && !isLoading && (
              <Button variant="outline" type="button" onClick={handleDownloadFeedback} className="w-full sm:w-auto text-sm sm:text-base" disabled={isLoading}>
                <Download className="mr-2 h-4 w-4" /> Download Feedback
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>

      {(plagiarismResult || acceptanceResult) && !isLoading && (
        <div className="mt-6 sm:mt-8 space-y-4 sm:space-y-6">
          {acceptanceResult && <AcceptanceProbabilityReport result={acceptanceResult} />}
          {plagiarismResult && <PlagiarismReport result={plagiarismResult} />}
        </div>
      )}
    </div>
  );
}

export default function AiPreCheckPage() {
    return (
        <ProtectedRoute>
            <AiPreCheckContent />
        </ProtectedRoute>
    )
}

