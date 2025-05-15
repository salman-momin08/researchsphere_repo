
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
import type { Paper as PaperType } from '@/types';
import { UploadCloud, Loader2, AlertTriangle, DollarSign, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { addPaper } from '@/lib/paper-service';
import PaymentModal from '@/components/payment/PaymentModal';

const paperSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  abstract: z.string().min(50, "Abstract must be at least 50 characters.").max(2000, "Abstract must be less than 2000 characters."),
  authors: z.string().min(1, "At least one author is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  keywords: z.string().min(1, "At least one keyword is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  file: z.any()
    .refine(files => {
      if (typeof window === 'undefined') return true;
      return files instanceof FileList && files.length > 0;
    }, "A paper file is required.")
    .refine(files => {
      if (typeof window === 'undefined' || !(files instanceof FileList) || files.length === 0) return true;
      return files[0].size <= 10 * 1024 * 1024; // Max 10MB
    }, "File size must be less than 10MB.")
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
  const [pendingSubmissionData, setPendingSubmissionData] = useState<PaperFormValues | null>(null);
  const [newlyCreatedPaperForPayment, setNewlyCreatedPaperForPayment] = useState<PaperType | null>(null);


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
      setFileName(watchedFile[0].name);
      form.clearErrors("file");
      console.log("PaperUploadForm: File selected:", watchedFile[0].name, "Type:", watchedFile[0].type, "Size:", watchedFile[0].size);
    } else {
      setFileName(null);
    }
  }, [watchedFile, form]);

  const proceedWithSubmission = async (data: PaperFormValues, isPayingNow: boolean): Promise<PaperType | null> => {
    console.log("PaperUploadForm: proceedWithSubmission called. Data:", data, "IsPayingNow:", isPayingNow);
    if (!user || !user.id) {
      console.error("PaperUploadForm: proceedWithSubmission - User or user.id is not available.");
      setFormError("Authentication Error: User session is invalid. Please log in again.");
      return null;
    }
    setFormError(null);

    const fileList = data.file as FileList;
    if (typeof window === 'undefined' || !(fileList instanceof FileList) || fileList.length === 0) {
      console.error("PaperUploadForm: proceedWithSubmission - File is not a valid FileList or is empty. Data.file:", data.file);
      setFormError("No file provided or file list is invalid.");
      return null;
    }
    const fileToUpload = fileList[0];
    console.log("PaperUploadForm: proceedWithSubmission - File to upload:", fileToUpload.name);

    const paperApiServiceData = {
      title: data.title,
      abstract: data.abstract,
      authors: data.authors,
      keywords: data.keywords,
      paymentOption: data.paymentOption, // Will be "payNow" or "payLater"
    };

    try {
      console.log("PaperUploadForm: Calling addPaper service with paperData:", paperApiServiceData, "and file:", fileToUpload.name);
      // The addPaper service will handle setting status, paidAt, submissionDate, paymentDueDate based on paymentOption
      const createdPaper = await addPaper(paperApiServiceData, fileToUpload, user.id);
      console.log("PaperUploadForm: addPaper service successful, newPaper:", createdPaper);
      return createdPaper;
    } catch (error: any) {
      console.error("PaperUploadForm: Error in proceedWithSubmission calling addPaper service:", error);
      const errorMessage = error.message || "An unexpected error occurred during paper submission.";
      setFormError(errorMessage);
      toast({ variant: "destructive", title: "Submission Failed", description: errorMessage });
      return null;
    }
  };


  const onFormSubmit = async (data: PaperFormValues) => {
    console.log("PaperUploadForm: onFormSubmit triggered. Data:", data);
    setIsSubmitting(true);
    setFormError(null);

    if (data.paymentOption === "payNow") {
      console.log("PaperUploadForm: PayNow selected. Setting pendingSubmissionData, creating paper with 'Payment Pending' then opening modal.");
      // For "Pay Now", we first create the paper with "Payment Pending" status.
      // If payment is successful, we update its status.
      const tempPaperData = { ...data, paymentOption: "payNow" } as PaperFormValues; 
      const createdPaper = await proceedWithSubmission(tempPaperData, true); // Pass true for isPayingNow
      
      if (createdPaper) {
        setNewlyCreatedPaperForPayment(createdPaper); // Store the full paper object
        setShowPayNowModal(true);
        // isSubmitting remains true, button disabled until modal flow completes or cancels
      } else {
        // Error already handled by proceedWithSubmission
        setIsSubmitting(false); // Re-enable form if initial paper creation fails
      }
    } else { // Pay Later
      console.log("PaperUploadForm: PayLater selected. Proceeding with submission.");
      const createdPaper = await proceedWithSubmission(data, false); // Pass false for isPayingNow
      if (createdPaper) {
        toast({ title: "Paper Submitted Successfully!", description: `"${data.title}" has been processed. Payment is due shortly.` });
        form.reset();
        setFileName(null);
        router.push(`/papers/${createdPaper.id}`);
      } else {
        // formError should be set by proceedWithSubmission
        console.error("PaperUploadForm: Error during 'Pay Later' submission. Form error state:", formError);
      }
      setIsSubmitting(false);
    }
  };

  const handleSuccessfulPayNowPayment = async () => {
    console.log("PaperUploadForm: handleSuccessfulPayNowPayment Entered. newlyCreatedPaperForPayment:", newlyCreatedPaperForPayment);
    if (!newlyCreatedPaperForPayment || !newlyCreatedPaperForPayment.id) {
      toast({ variant: "destructive", title: "Error", description: "No paper data found to finalize payment." });
      setShowPayNowModal(false);
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
      return;
    }
    
    // Paper is already created, now update its status to "Submitted" and add payment details
    try {
      await addPaper( // Using addPaper to update status after payment as it has the logic
        { 
          title: newlyCreatedPaperForPayment.title,
          abstract: newlyCreatedPaperForPayment.abstract,
          authors: newlyCreatedPaperForPayment.authors,
          keywords: newlyCreatedPaperForPayment.keywords,
          paymentOption: "payNow", // Indicate payment was made now
        },
        null, // File already uploaded, pass null or handle in addPaper
        user!.id,
        newlyCreatedPaperForPayment.id // Pass existing paper ID to update
      );

      toast({ title: "Paper Submitted & Paid Successfully!", description: `"${newlyCreatedPaperForPayment.title}" has been processed.` });
      form.reset();
      setFileName(null);
      router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
    } catch (error: any) {
      const errorMessage = error.message || "Failed to update paper status after payment.";
      setFormError(errorMessage);
      toast({ variant: "destructive", title: "Post-Payment Update Failed", description: errorMessage });
      console.error("PaperUploadForm: Error updating paper after 'Pay Now' success:", error);
      // User might need to contact support if payment went through but paper status update failed.
      // Optionally, redirect to paper details page anyway, as paper *is* created.
      router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
    } finally {
      setShowPayNowModal(false);
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
    }
  };

  const handlePayNowModalOpenChange = (open: boolean) => {
    console.log("PaperUploadForm: PayNow modal open state changed to:", open);
    setShowPayNowModal(open);
    if (!open) { // Modal is closing
      if (isSubmitting && newlyCreatedPaperForPayment) {
        // Modal closed by user before successful payment simulation for a pending paper
        console.log("PaperUploadForm: PayNow modal closed by user before payment success, re-enabling form for paper:", newlyCreatedPaperForPayment.id);
        // Optionally, inform user that the paper is still 'Payment Pending'
        toast({ title: "Payment Incomplete", description: `Submission for "${newlyCreatedPaperForPayment.title}" is saved but payment is still pending. You can pay later from the paper details page.`, duration: 7000});
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`); // Navigate to paper to allow payment later
      }
      // Always reset these when modal closes, regardless of why it closed
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
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
                  <AlertTitle>Submission Error</AlertTitle>
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
              <Input id="authors" placeholder="e.g., John Doe, Jane Smith" {...form.register("authors" as any)} disabled={isSubmitting} />
              {form.formState.errors.authors && <p className="text-sm text-destructive mt-1">{form.formState.errors.authors.message as string}</p>}
            </div>

            <div>
              <Label htmlFor="keywords">Keywords (comma-separated)</Label>
              <Input id="keywords" placeholder="e.g., AI, Machine Learning, Academia" {...form.register("keywords" as any)} disabled={isSubmitting} />
              {form.formState.errors.keywords && <p className="text-sm text-destructive mt-1">{form.formState.errors.keywords.message as string}</p>}
            </div>

            <div>
              <Label htmlFor="file-upload">Upload Paper (PDF or DOCX, max 10MB)</Label>
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
                    <p className="text-xs text-muted-foreground">PDF, DOCX up to 10MB</p>
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
              {form.formState.errors.paymentOption && <p className="text-sm text-destructive mt-1">{form.formState.errors.paymentOption.message}</p>}
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
            // Pass the full paper object so modal can display its title
            paper={newlyCreatedPaperForPayment} 
            onPaymentSuccess={handleSuccessfulPayNowPayment}
        />
      )}
    </>
  );
}
