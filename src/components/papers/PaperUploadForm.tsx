
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
import type { Paper, PaperStatus } from '@/types';
import { UploadCloud, Loader2, AlertTriangle, DollarSign, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { addPaper } from '@/lib/paper-service';
import PaymentModal from '@/components/payment/PaymentModal';

const paperSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  abstract: z.string().min(50, "Abstract must be at least 50 characters.").max(2000, "Abstract must be less than 2000 characters."),
  authors: z.string().min(1, "At least one author is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  keywords: z.string().min(1, "At least one keyword is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  file: z.any() // For FileList, client-side validation
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && files.length > 0), "A paper file is required.")
    .refine(files => {
      if (typeof window === 'undefined' || !(files instanceof FileList) || files.length === 0) return true; // Allow if no file (e.g. for server-side validation if file is optional)
      return files[0].size <= 5 * 1024 * 1024; // 5MB
    }, "File size must be less than 5MB.")
    .refine(files => {
      if (typeof window === 'undefined' || !(files instanceof FileList) || files.length === 0) return true;
      return ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(files[0].type);
    }, "Only PDF or DOCX files are allowed."),
  paymentOption: z.enum(["payNow", "payLater"], { required_error: "Please select a payment option." }),
});

type PaperFormValues = z.infer<typeof paperSchema>;

export default function PaperUploadForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  const [showPayNowModal, setShowPayNowModal] = useState(false);
  const [formDataForSubmission, setFormDataForSubmission] = useState<PaperFormValues | null>(null);

  const form = useForm<PaperFormValues>({
    resolver: zodResolver(paperSchema),
    defaultValues: {
      title: "",
      abstract: "",
      authors: [], 
      keywords: [], 
      file: undefined,
      paymentOption: "payLater",
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

  // Core submission logic, returns newPaperId on success or throws error
  const proceedWithSubmission = async (data: PaperFormValues, initialStatus: PaperStatus, paidAt?: string): Promise<string> => {
    if (!user) {
      throw new Error("Authentication Error: You must be logged in to submit a paper.");
    }
    
    setFormError(null); // Clear previous form errors

    const fileToUpload = (data.file as FileList)[0];
    
    let paymentDueDate: string | null = null;
    if (initialStatus === "Payment Pending") {
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 2); // 2 hours from now
      paymentDueDate = dueDate.toISOString();
    }

    const newPaperFirestoreData: Omit<Paper, 'id' | 'uploadDate' | 'fileUrl' | 'fileName'> = {
      userId: user.id,
      title: data.title,
      abstract: data.abstract,
      authors: data.authors,
      keywords: data.keywords,
      status: initialStatus,
      paymentOption: data.paymentOption,
      paymentDueDate: paymentDueDate,
      submissionDate: paidAt ? new Date().toISOString() : null, // Set submission date if paid
      plagiarismScore: null,
      plagiarismReport: null,
      acceptanceProbability: null,
      acceptanceReport: null,
      paidAt: paidAt || null,
    };
    
    try {
      const newPaperId = await addPaper(newPaperFirestoreData, fileToUpload, user.id);
      return newPaperId;
    } catch (error) {
      console.error("Error in proceedWithSubmission:", error);
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred during submission.";
      setFormError(errorMessage); // Set form-level error
      throw error; // Re-throw to be caught by the caller
    }
  };
  
  const onFormSubmit = async (data: PaperFormValues) => {
    setIsSubmitting(true); 
    if (data.paymentOption === "payNow") {
      setFormDataForSubmission(data);
      setShowPayNowModal(true);
      // isSubmitting remains true, button disabled
    } else { // Pay Later
      try {
        const newPaperId = await proceedWithSubmission(data, "Payment Pending");
        toast({ title: "Paper Submitted Successfully!", description: `${data.title} has been processed. Payment is due shortly.` });
        form.reset();
        setFileName(null);
        router.push(`/papers/${newPaperId}`);
      } catch (error) {
        // Form error is set by proceedWithSubmission, toast is shown by proceedWithSubmission if needed
        // Or handled by a generic toast here if proceedWithSubmission doesn't show one for this path
        if (!formError) { // If proceedWithSubmission didn't set a specific formError
             toast({ variant: "destructive", title: "Submission Failed", description: error instanceof Error ? error.message : "An unexpected error occurred." });
        }
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleSuccessfulPayNowPayment = async () => {
    if (formDataForSubmission) {
      // Note: isSubmitting is already true from onFormSubmit
      try {
        const newPaperId = await proceedWithSubmission(formDataForSubmission, "Submitted", new Date().toISOString());
        toast({ title: "Paper Submitted & Paid Successfully!", description: `${formDataForSubmission.title} has been processed.` });
        form.reset();
        setFileName(null);
        router.push(`/papers/${newPaperId}`);
      } catch (error) {
         if (!formError) {
             toast({ variant: "destructive", title: "Submission Failed After Payment", description: error instanceof Error ? error.message : "An unexpected error occurred." });
        }
      } finally {
        setShowPayNowModal(false);
        setFormDataForSubmission(null);
        setIsSubmitting(false); // Reset submitting state for the main form
      }
    } else {
        setShowPayNowModal(false);
        setFormDataForSubmission(null);
        setIsSubmitting(false);
    }
  };

  const handlePayNowModalClose = () => {
    setShowPayNowModal(false);
    setIsSubmitting(false); // Reset submitting state if modal is closed without payment
    setFormDataForSubmission(null);
  }

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
                value={form.watch("paymentOption")}
                onValueChange={(value) => form.setValue("paymentOption", value as "payNow" | "payLater", {shouldValidate: true})}
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
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                  {form.getValues("paymentOption") === "payNow" ? "Processing Payment..." : "Submitting..."}
                </>
              ) : (
                <><UploadCloud className="mr-2 h-4 w-4" /> 
                 {form.getValues("paymentOption") === "payNow" ? "Proceed to Payment & Submit" : "Submit Paper & Pay Later"}
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {user && formDataForSubmission && ( 
        <PaymentModal 
            isOpen={showPayNowModal} 
            onOpenChange={handlePayNowModalClose}
            paper={ { title: formDataForSubmission.title } as Paper }
            onPaymentSuccess={handleSuccessfulPayNowPayment} 
        />
      )}
    </>
  );
}
