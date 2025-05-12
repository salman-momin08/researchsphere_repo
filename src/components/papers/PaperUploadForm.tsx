"use client";

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import type { Paper } from '@/types';
import { UploadCloud, Loader2, AlertTriangle } from 'lucide-react';
import { plagiarismCheck, PlagiarismCheckInput, PlagiarismCheckOutput } from '@/ai/flows/plagiarism-check';
import { acceptanceProbability, AcceptanceProbabilityInput, AcceptanceProbabilityOutput } from '@/ai/flows/acceptance-probability';
import PlagiarismReport from './PlagiarismReport';
import AcceptanceProbabilityReport from './AcceptanceProbabilityReport';

const paperSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  abstract: z.string().min(50, "Abstract must be at least 50 characters.").max(2000, "Abstract must be less than 2000 characters."),
  authors: z.string().min(1, "At least one author is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  keywords: z.string().min(1, "At least one keyword is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  file: z.any()
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && files.length > 0), "A paper file is required.")
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && files?.[0]?.size <= 5 * 1024 * 1024), "File size must be less than 5MB.") // Max 5MB
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(files?.[0]?.type)), "Only PDF or DOCX files are allowed."),
});

type PaperFormValues = z.infer<typeof paperSchema>;

export default function PaperUploadForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismCheckOutput | null>(null);
  const [acceptanceResult, setAcceptanceResult] = useState<AcceptanceProbabilityOutput | null>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);

  const form = useForm<PaperFormValues>({
    resolver: zodResolver(paperSchema),
    defaultValues: {
      title: "",
      abstract: "",
      authors: [],
      keywords: [],
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setFileName(event.target.files[0].name);
      form.setValue("file", event.target.files); // Set value for react-hook-form
    } else {
      setFileName(null);
    }
  };
  
  // Mock function to simulate reading file content as text
  // In a real app, this would involve server-side processing of PDF/DOCX
  const readFileAsText = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      // For simplicity, we'll use the file name and some metadata as "content"
      // A real implementation would use libraries like pdf-parse or mammoth.js on the server
      setTimeout(() => {
        const mockTextContent = `Filename: ${file.name}\nFilesize: ${file.size} bytes\nAbstract: ${form.getValues().abstract}\n\nThis is simulated text content for AI processing. A real system would extract text from the uploaded PDF/DOCX.`;
        resolve(mockTextContent);
      }, 500);
    });
  };


  const onSubmit = async (data: PaperFormValues) => {
    if (!user) {
      toast({ variant: "destructive", title: "Authentication Error", description: "You must be logged in to submit a paper." });
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    setPlagiarismResult(null);
    setAcceptanceResult(null);

    try {
      // Simulate file upload, in a real app, this would upload to a storage service
      const fileToUpload = data.file[0];
      const newPaperId = Date.now().toString(); // Mock ID

      const newPaper: Paper = {
        id: newPaperId,
        userId: user.id,
        title: data.title,
        abstract: data.abstract,
        authors: data.authors,
        keywords: data.keywords,
        fileName: fileToUpload.name,
        // fileUrl: "mock/url/to/" + fileToUpload.name, // Mock URL
        uploadDate: new Date().toISOString(),
        status: "Submitted", // Initial status
      };

      // Simulate saving paper metadata
      console.log("Submitting paper:", newPaper);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
      
      toast({ title: "Paper Submitted Successfully!", description: `${data.title} has been uploaded.` });
      
      // AI Processing
      setIsProcessingAI(true);
      const paperTextContent = await readFileAsText(fileToUpload);

      try {
        const plagiarismInput: PlagiarismCheckInput = { documentText: paperTextContent };
        const plagiarismOutput = await plagiarismCheck(plagiarismInput);
        setPlagiarismResult(plagiarismOutput);
        newPaper.plagiarismScore = plagiarismOutput.plagiarismScore;
        newPaper.plagiarismReport = { highlightedSections: plagiarismOutput.highlightedSections };
      } catch (aiError) {
        console.error("Plagiarism check failed:", aiError);
        toast({ variant: "destructive", title: "AI Error", description: "Plagiarism check could not be completed." });
      }

      try {
        const acceptanceInput: AcceptanceProbabilityInput = { paperText: paperTextContent };
        const acceptanceOutput = await acceptanceProbability(acceptanceInput);
        setAcceptanceResult(acceptanceOutput);
        newPaper.acceptanceProbability = acceptanceOutput.probabilityScore;
        newPaper.acceptanceReport = { reasoning: acceptanceOutput.reasoning };
      } catch (aiError) {
        console.error("Acceptance probability check failed:", aiError);
        toast({ variant: "destructive", title: "AI Error", description: "Acceptance probability check could not be completed." });
      }

      setIsProcessingAI(false);

      // In a real app, you'd save `newPaper` to your database here, including AI results.
      // For now, we'll just log it and redirect.
      console.log("Paper with AI results:", newPaper);
      
      // Add to mockPapers (if this component was part of dashboard) or redirect to paper page
      // For now, redirect to a generic success or dashboard, ideally paper page
      // router.push(`/papers/${newPaperId}`); // If paper page shows this immediately
      // Temporary: go to dashboard after submission
      router.push('/dashboard');

    } catch (error) {
      console.error("Submission error:", error);
      setFormError(error instanceof Error ? error.message : "An unexpected error occurred during submission.");
      toast({ variant: "destructive", title: "Submission Failed", description: formError ?? "Unknown error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="text-2xl md:text-3xl">Submit Your Research Paper</CardTitle>
        <CardDescription>Fill in the details below and upload your paper (PDF or DOCX, max 5MB).</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent className="space-y-6">
          {formError && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {formError}
            </div>
          )}
          
          <div>
            <Label htmlFor="title">Paper Title</Label>
            <Input id="title" {...form.register("title")} disabled={isSubmitting || isProcessingAI} />
            {form.formState.errors.title && <p className="text-sm text-destructive mt-1">{form.formState.errors.title.message}</p>}
          </div>

          <div>
            <Label htmlFor="abstract">Abstract</Label>
            <Textarea id="abstract" {...form.register("abstract")} rows={6} disabled={isSubmitting || isProcessingAI} />
            {form.formState.errors.abstract && <p className="text-sm text-destructive mt-1">{form.formState.errors.abstract.message}</p>}
          </div>

          <div>
            <Label htmlFor="authors">Authors (comma-separated)</Label>
            <Input id="authors" placeholder="e.g., John Doe, Jane Smith" {...form.register("authors")} disabled={isSubmitting || isProcessingAI} />
            {form.formState.errors.authors && <p className="text-sm text-destructive mt-1">{form.formState.errors.authors.message}</p>}
          </div>

          <div>
            <Label htmlFor="keywords">Keywords (comma-separated)</Label>
            <Input id="keywords" placeholder="e.g., AI, Machine Learning, Academia" {...form.register("keywords")} disabled={isSubmitting || isProcessingAI} />
            {form.formState.errors.keywords && <p className="text-sm text-destructive mt-1">{form.formState.errors.keywords.message}</p>}
          </div>
          
          <div>
            <Label htmlFor="file">Upload Paper (PDF or DOCX, max 5MB)</Label>
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
                           accept=".pdf,.docx" 
                           onChange={handleFileChange}  // Use custom handler
                           disabled={isSubmitting || isProcessingAI}
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

          {(isProcessingAI) && (
            <div className="p-4 border rounded-md bg-secondary">
              <div className="flex items-center text-primary font-medium">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                <span>Processing with AI tools... This may take a moment.</span>
              </div>
            </div>
          )}

          {plagiarismResult && <PlagiarismReport result={plagiarismResult} />}
          {acceptanceResult && <AcceptanceProbabilityReport result={acceptanceResult} />}

        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={isSubmitting || isProcessingAI}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
            ) : (
              <><UploadCloud className="mr-2 h-4 w-4" /> Submit Paper</>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
