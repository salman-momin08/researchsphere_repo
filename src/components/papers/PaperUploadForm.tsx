
"use client";

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import type { Paper } from '@/types';
import { UploadCloud, Loader2, AlertTriangle, DollarSign, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { addPaper } from '@/lib/paper-service'; // New service

const paperSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  abstract: z.string().min(50, "Abstract must be at least 50 characters.").max(2000, "Abstract must be less than 2000 characters."),
  authors: z.string().min(1, "At least one author is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  keywords: z.string().min(1, "At least one keyword is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  file: z.any()
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && files.length > 0), "A paper file is required.")
    .refine(files => typeof window === 'undefined' || !(files instanceof FileList) || files.length === 0 || files[0].size <= 5 * 1024 * 1024, "File size must be less than 5MB.")
    .refine(files => typeof window === 'undefined' || !(files instanceof FileList) || files.length === 0 || ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(files[0].type), "Only PDF or DOCX files are allowed."),
  paymentOption: z.enum(["payNow", "payLater"], { required_error: "Please select a payment option." }),
});

type PaperFormValues = z.infer<typeof paperSchema>;

export default function PaperUploadForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  const form = useForm<PaperFormValues>({
    resolver: zodResolver(paperSchema),
    defaultValues: {
      title: "",
      abstract: "",
      authors: [],
      keywords: [],
      file: undefined,
      paymentOption: "payLater", // Default to payLater
    },
  });

  const watchedFile = form.watch("file");
  useEffect(() => {
    if (watchedFile && typeof window !== 'undefined' && watchedFile instanceof FileList && watchedFile.length > 0) {
      setFileName(watchedFile[0].name);
    } else {
      setFileName(null);
    }
  }, [watchedFile]);
  
  const onFormSubmit = async (data: PaperFormValues) => {
    if (!user) {
      toast({ variant: "destructive", title: "Authentication Error", description: "You must be logged in to submit a paper." });
      return;
    }
    
    setIsSubmitting(true);
    setFormError(null);

    try {
      const fileToUpload = (data.file as FileList)[0];
      if (!fileToUpload) { 
        throw new Error("File not available for submission.");
      }

      // In a real app, upload fileToUpload to Firebase Storage here and get fileUrl
      // For now, we'll just use fileName.
      const mockFileUrl = `/uploads/mock/${fileToUpload.name}`; // Placeholder

      let paymentDueDate: string | null = null;
      if (data.paymentOption === "payLater") {
        const dueDate = new Date();
        dueDate.setHours(dueDate.getHours() + 2);
        paymentDueDate = dueDate.toISOString();
      }

      const newPaperData: Omit<Paper, 'id' | 'uploadDate'> = {
        userId: user.id,
        title: data.title,
        abstract: data.abstract,
        authors: data.authors,
        keywords: data.keywords,
        fileName: fileToUpload.name,
        fileUrl: mockFileUrl, // Replace with actual URL from Firebase Storage
        status: data.paymentOption === "payLater" ? "Payment Pending" : "Submitted", // Or "Payment Pending" if payNow needs immediate payment step
        paymentOption: data.paymentOption,
        paymentDueDate: paymentDueDate,
        submissionDate: data.paymentOption === "payNow" ? new Date().toISOString() : null, // Set if "Pay Now" and payment is immediate
        // AI fields initialized to null
        plagiarismScore: null,
        plagiarismReport: null,
        acceptanceProbability: null,
        acceptanceReport: null,
        paidAt: null,
      };
      
      const newPaperId = await addPaper(newPaperData);
      
      toast({ title: "Paper Submitted Successfully!", description: `${data.title} has been uploaded.` });
      form.reset();
      
      if (data.paymentOption === "payNow") {
        router.push(`/papers/${newPaperId}?action=pay`);
      } else {
        router.push(`/papers/${newPaperId}`);
      }

    } catch (error) {
      console.error("Submission error:", error);
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred during submission.";
      setFormError(errorMessage);
      toast({ variant: "destructive", title: "Submission Failed", description: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto shadow-xl my-8">
        <CardHeader>
          <CardTitle className="text-2xl md:text-3xl">Submit Your Research Paper</CardTitle>
          <CardDescription>Fill in the details below, upload your paper, and choose a payment option.</CardDescription>
        </CardHeader>
        <form onSubmit={form.handleSubmit(onFormSubmit)}>
          <CardContent className="space-y-6">
            {formError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
            )}
            
            <div>
              <Label htmlFor="title">Paper Title</Label>
              <Input id="title" {...form.register("title")} disabled={isSubmitting} />
              {form.formState.errors.title && <p className="text-sm text-destructive mt-1">{form.formState.errors.title.message}</p>}
            </div>

            <div>
              <Label htmlFor="abstract">Abstract</Label>
              <Textarea id="abstract" {...form.register("abstract")} rows={6} disabled={isSubmitting} />
              {form.formState.errors.abstract && <p className="text-sm text-destructive mt-1">{form.formState.errors.abstract.message}</p>}
            </div>

            <div>
              <Label htmlFor="authors">Authors (comma-separated)</Label>
              <Input id="authors" placeholder="e.g., John Doe, Jane Smith" {...form.register("authors")} disabled={isSubmitting} />
              {form.formState.errors.authors && <p className="text-sm text-destructive mt-1">{form.formState.errors.authors.message as string}</p>}
            </div>

            <div>
              <Label htmlFor="keywords">Keywords (comma-separated)</Label>
              <Input id="keywords" placeholder="e.g., AI, Machine Learning, Academia" {...form.register("keywords")} disabled={isSubmitting} />
              {form.formState.errors.keywords && <p className="text-sm text-destructive mt-1">{form.formState.errors.keywords.message as string}</p>}
            </div>
            
            <div>
              <Label htmlFor="file-upload">Upload Paper (PDF or DOCX, max 5MB)</Label>
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
                            disabled={isSubmitting}
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
              {form.formState.errors.file && <p className="text-sm text-destructive mt-1">{form.formState.errors.file.message as string}</p>}
            </div>

            <div>
              <Label>Payment Option</Label>
              <RadioGroup
                defaultValue="payLater"
                onValueChange={(value) => form.setValue("paymentOption", value as "payNow" | "payLater")}
                className="mt-2 space-y-2"
                disabled={isSubmitting}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="payNow" id="payNow" />
                  <Label htmlFor="payNow" className="font-normal flex items-center">
                    <DollarSign className="mr-2 h-4 w-4 text-green-600" /> Pay Now ($50.00 Submission Fee)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="payLater" id="payLater" />
                  <Label htmlFor="payLater" className="font-normal flex items-center">
                    <Clock className="mr-2 h-4 w-4 text-orange-500" /> Pay Later (Within 2 hours)
                  </Label>
                </div>
              </RadioGroup>
              {form.formState.errors.paymentOption && <p className="text-sm text-destructive mt-1">{form.formState.errors.paymentOption.message}</p>}
            </div>

          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting Paper...</>
              ) : (
                <><UploadCloud className="mr-2 h-4 w-4" /> Submit Paper</>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}
