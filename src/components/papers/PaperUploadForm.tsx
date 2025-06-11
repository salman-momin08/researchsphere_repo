
"use client";

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { AnimatedInput } from '@/components/ui/AnimatedInput';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import type { Paper as PaperType } from '@/types';
import { UploadCloud, Loader2, AlertTriangle, DollarSign, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { addPaper } from '@/lib/paper-service';
import dynamic from 'next/dynamic';
import LoadingSpinner from '../shared/LoadingSpinner';

const PaymentModal = dynamic(() => import('@/components/payment/PaymentModal'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center"><LoadingSpinner size={32} /></div>,
});


const paperSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  abstract: z.string().min(50, "Abstract must be at least 50 characters.").max(2000, "Abstract must be less than 2000 characters."),
  authors: z.string().min(1, "At least one author is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  keywords: z.string().min(1, "At least one keyword is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  file: z.any()
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && files.length > 0), "A paper file is required.")
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && files.length > 0 && files[0].size <= 10 * 1024 * 1024), "File size must be less than 10MB.") // Max 10MB
    .refine(files => typeof window === 'undefined' || (files instanceof FileList && files.length > 0 && ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(files[0].type)), "Only PDF or DOCX files are allowed."),
  paymentOption: z.enum(["payNow", "payLater"], { required_error: "Please select a payment option." }),
});

export type PaperFormValues = z.infer<typeof paperSchema>;

export default function PaperUploadForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileNameDisplay, setFileNameDisplay] = useState<string | null>(null);
  const [showPayNowModal, setShowPayNowModal] = useState(false);
  const [newlyCreatedPaperForPayment, setNewlyCreatedPaperForPayment] = useState<PaperType | null>(null);
  const [pendingSubmissionData, setPendingSubmissionData] = useState<PaperFormValues | null>(null);


  const form = useForm<PaperFormValues>({
    resolver: zodResolver(paperSchema),
    defaultValues: {
      title: "",
      abstract: "",
      authors: "",
      keywords: "",
      file: undefined,
      paymentOption: "payLater",
    },
  });

  const watchedFile = form.watch("file");
  useEffect(() => {
    if (watchedFile && typeof window !== 'undefined' && watchedFile instanceof FileList && watchedFile.length > 0) {
      setFileNameDisplay(watchedFile[0].name);
      if(form.formState.errors.file) form.clearErrors("file");
    } else {
      setFileNameDisplay(null);
    }
  }, [watchedFile, form]);

  // Renamed and refactored from proceedWithSubmission for clarity
  const createInitialPaperRecord = async (data: PaperFormValues): Promise<PaperType | null> => {
    if (!user || !user.id) {
      setFormError("Authentication Error: User session is invalid. Please log in again.");
      return null;
    }
    setFormError(null);

    let fileToUpload: File | null = null;
    if (data.file) {
      const fileList = data.file as FileList | undefined;
      if (typeof window === 'undefined' || !(fileList instanceof FileList) || fileList.length === 0) {
        setFormError("No file provided or file list is invalid. Please select a file.");
        form.setError("file", { type: "manual", message: "A paper file is required." });
        return null;
      }
      fileToUpload = fileList[0];
    } else {
        setFormError("A paper file is required.");
        form.setError("file", { type: "manual", message: "A paper file is required." });
        return null;
    }

    const paperApiServiceData = {
      title: data.title,
      abstract: data.abstract,
      authors: data.authors,
      keywords: data.keywords,
      paymentOption: data.paymentOption,
    };

    try {
      // Call addPaper without existingPaperId to create a new record
      const createdPaper = await addPaper(paperApiServiceData, fileToUpload, user.id, undefined);
      return createdPaper;
    } catch (error: any) {
      const errorMessage = error.message || "An unexpected error occurred during initial paper processing.";
      setFormError(errorMessage);
      return null;
    }
  };

  const onFormSubmit = async (data: PaperFormValues) => {
    setIsSubmitting(true);
    setFormError(null);

    if (data.paymentOption === "payNow") {
      const initialPaper = await createInitialPaperRecord(data);
      if (initialPaper) {
        setNewlyCreatedPaperForPayment(initialPaper);
        setPendingSubmissionData(data); // Save form data for post-payment update
        setShowPayNowModal(true);
        // isSubmitting will be false via PaymentModal or its close handler
      } else {
        toast({variant: "destructive", title: "Submission Error", description: formError || "Could not initiate paper submission for payment."});
        setIsSubmitting(false);
      }
    } else { // Pay Later
      const createdPaper = await createInitialPaperRecord(data); // This saves with "Payment Pending" status
      if (createdPaper) {
        toast({ title: "Paper Submission Initiated!", description: `"${data.title}" processed. Payment is due shortly.` });
        form.reset();
        setFileNameDisplay(null);
        router.push(`/papers/${createdPaper.id}`);
      } else {
        toast({variant: "destructive", title: "Submission Failed", description: formError || "Could not submit your paper."});
      }
      setIsSubmitting(false);
    }
  };

  const handleSuccessfulPayNowPayment = async () => {
    if (!newlyCreatedPaperForPayment || !newlyCreatedPaperForPayment.id || !pendingSubmissionData) {
      toast({ variant: "destructive", title: "Error", description: "No paper data found to finalize payment." });
      setShowPayNowModal(false);
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
      return;
    }
    
    setIsSubmitting(true); // Show loading for the final update step
    try {
      // Call addPaper WITH existingPaperId to update status, paidAt, submissionDate
      // File upload is NOT needed again as it was done during initialPaper creation
      // Pass null for fileToUpload
      const paperApiServiceDataForUpdate = {
        title: pendingSubmissionData.title,
        abstract: pendingSubmissionData.abstract,
        authors: pendingSubmissionData.authors,
        keywords: pendingSubmissionData.keywords,
        paymentOption: "payNow" as "payNow", // Confirm it's payNow
      };

      const updatedPaper = await addPaper(
        paperApiServiceDataForUpdate,
        null, // No file needed for update
        newlyCreatedPaperForPayment.userId, // Should be current user.id
        newlyCreatedPaperForPayment.id // Pass existing ID
      );

      if (updatedPaper) {
        toast({ title: "Paper Submitted & Paid Successfully!", description: `"${updatedPaper.title}" has been processed.` });
        form.reset();
        setFileNameDisplay(null);
        router.push(`/papers/${updatedPaper.id}`);
      } else {
        // This case should be rare if addPaper throws errors, but as a fallback
        toast({ variant: "destructive", title: "Post-Payment Update Failed", description: "Could not update paper status after payment. Please check your dashboard.", duration: 7000 });
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
      }
    } catch (error: any) {
        toast({ variant: "destructive", title: "Post-Payment Update Failed", description: error.message || "An error occurred finalizing your submission.", duration: 7000 });
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`); // Redirect to the paper even if update fails
    } finally {
        setShowPayNowModal(false);
        setIsSubmitting(false);
        setNewlyCreatedPaperForPayment(null);
        setPendingSubmissionData(null);
    }
  };

  const handlePayNowModalOpenChange = (open: boolean) => {
    setShowPayNowModal(open);
    if (!open) { // Modal closed
      // Check if it was closed before payment success
      if (newlyCreatedPaperForPayment && !form.formState.isSubmitSuccessful) { // isSubmitSuccessful might not be correct here
        toast({ title: "Payment Incomplete", description: `Submission for "${newlyCreatedPaperForPayment.title}" is saved as 'Payment Pending'. You can complete payment from the paper details page.`, duration: 7000});
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
      }
      // Always reset states whether payment was successful or modal just closed
      setIsSubmitting(false); // Ensure main form button is re-enabled
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
    } else if (open && newlyCreatedPaperForPayment) { // Modal just opened
      if(!pendingSubmissionData) {
        setPendingSubmissionData(form.getValues());
      }
    }
  };

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto shadow-xl my-8">
        <CardHeader>
          <CardTitle className="text-2xl md:text-3xl">Submit Your Research Paper</CardTitle>
          <CardDescription>Fill in the details below, upload your paper (PDF/DOCX, max 10MB), and choose a payment option.</CardDescription>
        </CardHeader>
        <form onSubmit={form.handleSubmit(onFormSubmit)}>
          <CardContent className="space-y-6">
            {formError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Submission Error</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
            )}

            <div>
              <AnimatedInput id="title" {...form.register("title")} disabled={isSubmitting} label="Paper Title *"/>
              {form.formState.errors.title && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.title.message}</p>}
            </div>

            <div>
              <Label htmlFor="abstract">Abstract *</Label>
              <Textarea id="abstract" placeholder="Enter abstract here..." {...form.register("abstract")} rows={6} disabled={isSubmitting} className="mt-1" />
              {form.formState.errors.abstract && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.abstract.message}</p>}
            </div>

            <div>
              <AnimatedInput 
                id="authors" 
                {...form.register("authors")} 
                disabled={isSubmitting} 
                label="Authors (comma-separated) *"
              />
              <p className="text-xs text-muted-foreground mt-1 px-1">e.g., John Doe, Jane Smith</p>
              {form.formState.errors.authors && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.authors.message as string}</p>}
            </div>

            <div>
              <AnimatedInput 
                id="keywords" 
                {...form.register("keywords")} 
                disabled={isSubmitting} 
                label="Keywords (comma-separated) *"
              />
              <p className="text-xs text-muted-foreground mt-1 px-1">e.g., AI, Machine Learning, Academia</p>
              {form.formState.errors.keywords && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.keywords.message as string}</p>}
            </div>

            <div>
              <Label htmlFor="file-upload">Upload Paper (PDF or DOCX, max 10MB) *</Label>
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
                  {fileNameDisplay ? (
                    <p className="text-xs text-foreground">{fileNameDisplay}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">PDF, DOCX up to 10MB</p>
                  )}
                </div>
              </div>
              {form.formState.errors.file && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.file.message as string}</p>}
            </div>

            <div>
              <Label>Payment Option *</Label>
              <RadioGroup
                value={form.watch("paymentOption")}
                onValueChange={(value) => form.setValue("paymentOption", value as "payNow" | "payLater", {shouldValidate: true})}
                className="mt-2 space-y-2"
                disabled={isSubmitting}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="payNow" id="payNow" disabled={isSubmitting} />
                  <Label htmlFor="payNow" className="font-normal flex items-center">
                    <DollarSign className="mr-2 h-4 w-4 text-green-600" /> Pay Now (₹499.00 Submission Fee)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="payLater" id="payLater" disabled={isSubmitting} />
                  <Label htmlFor="payLater" className="font-normal flex items-center">
                    <Clock className="mr-2 h-4 w-4 text-orange-500" /> Pay Later (Due within 2 hours)
                  </Label>
                </div>
              </RadioGroup>
              {form.formState.errors.paymentOption && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.paymentOption.message}</p>}
            </div>

          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {form.getValues("paymentOption") === "payNow" && showPayNowModal ? "Awaiting Payment..." : "Submitting..."}
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

      {user && newlyCreatedPaperForPayment && (
        <PaymentModal
            isOpen={showPayNowModal}
            onOpenChange={handlePayNowModalOpenChange}
            paper={newlyCreatedPaperForPayment} 
            onPaymentSuccess={handleSuccessfulPayNowPayment}
        />
      )}
    </>
  );
}
