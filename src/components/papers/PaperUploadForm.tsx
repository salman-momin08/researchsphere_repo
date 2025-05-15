
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
  file: z.any() // FileList validation is tricky with Zod and server-side; we'll do basic client-side check
    .refine(files => {
      if (typeof window === 'undefined') return true; // Skip validation on server
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
      form.clearErrors("file");
    } else {
      setFileNameDisplay(null);
    }
  }, [watchedFile, form]);

  // This function now only deals with calling the addPaper service
  const proceedWithSubmission = async (data: PaperFormValues, existingPaperId?: string): Promise<PaperType | null> => {
    if (!user || !user.id) {
      setFormError("Authentication Error: User session is invalid. Please log in again.");
      return null;
    }
    setFormError(null);

    let fileToUpload: File | null = null;
    if (!existingPaperId) { // Only need file for new submissions, not for post-payment status updates
      const fileList = data.file as FileList | undefined;
      if (typeof window === 'undefined' || !(fileList instanceof FileList) || fileList.length === 0) {
        setFormError("No file provided or file list is invalid. Please select a file.");
        form.setError("file", { type: "manual", message: "A paper file is required." });
        return null;
      }
      fileToUpload = fileList[0];
    }

    const paperApiServiceData = {
      title: data.title,
      abstract: data.abstract,
      authors: data.authors,
      keywords: data.keywords,
      paymentOption: data.paymentOption, // This will guide status setting in addPaper
    };

    try {
      const createdOrUpdatedPaper = await addPaper(
        paperApiServiceData,
        fileToUpload, // Will be null if existingPaperId is provided, handled by addPaper
        user.id,
        existingPaperId
      );
      return createdOrUpdatedPaper;
    } catch (error: any) {
      const errorMessage = error.message || "An unexpected error occurred during paper submission.";
      // console.error("PaperUploadForm: proceedWithSubmission - Error from addPaper service:", errorMessage, error);
      setFormError(errorMessage);
      return null;
    }
  };

  const onFormSubmit = async (data: PaperFormValues) => {
    setIsSubmitting(true);
    setFormError(null);
    // console.log("PaperUploadForm: onFormSubmit called with data:", data);

    if (data.paymentOption === "payNow") {
      // Create paper first (will upload file and set to 'Payment Pending' or 'Submitted' based on addPaper logic)
      // For "PayNow", addPaper should set initial status that reflects intent to pay immediately.
      // Let's assume addPaper with 'payNow' option correctly handles initial state.
      const initialPaperForPayNow = { ...data, paymentOption: "payNow" as "payNow" };
      const createdPaper = await proceedWithSubmission(initialPaperForPayNow, undefined); // Pass undefined for existingPaperId

      if (createdPaper) {
        // console.log("PaperUploadForm: Initial paper created for PayNow, ID:", createdPaper.id);
        setNewlyCreatedPaperForPayment(createdPaper);
        setPendingSubmissionData(data); // Store original form data for post-payment update
        setShowPayNowModal(true);
        // isSubmitting will be false by PaymentModal or its close handler
      } else {
        toast({variant: "destructive", title: "Submission Error", description: formError || "Could not initiate paper submission for payment."});
        setIsSubmitting(false); // Error occurred before modal
      }
    } else { // Pay Later
      // console.log("PaperUploadForm: PayLater option selected.");
      const createdPaper = await proceedWithSubmission(data, undefined); // Pass undefined for existingPaperId
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
    // console.log("PaperUploadForm: handleSuccessfulPayNowPayment. newlyCreatedPaperForPayment:", newlyCreatedPaperForPayment);
    if (!newlyCreatedPaperForPayment || !newlyCreatedPaperForPayment.id || !pendingSubmissionData) {
      toast({ variant: "destructive", title: "Error", description: "No paper data found to finalize payment." });
      setShowPayNowModal(false); // Close modal
      setIsSubmitting(false); // Reset form submission state
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
      return;
    }
    
    // This call will update the status to 'Submitted', set paidAt, submissionDate
    const updatedPaper = await proceedWithSubmission(pendingSubmissionData, newlyCreatedPaperForPayment.id);

    if (updatedPaper) {
      toast({ title: "Paper Submitted & Paid Successfully!", description: `"${updatedPaper.title}" has been processed.` });
      form.reset();
      setFileNameDisplay(null);
      router.push(`/papers/${updatedPaper.id}`);
    } else {
      toast({ variant: "destructive", title: "Post-Payment Update Failed", description: formError || "Could not update paper status after payment. Your paper is saved but payment status may be incorrect.", duration: 7000 });
      router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
    }
    
    setShowPayNowModal(false);
    setIsSubmitting(false);
    setNewlyCreatedPaperForPayment(null);
    setPendingSubmissionData(null);
  };

  const handlePayNowModalOpenChange = (open: boolean) => {
    setShowPayNowModal(open);
    if (!open) { // Modal is closing
      if (isSubmitting && newlyCreatedPaperForPayment && !pendingSubmissionData) { // Check if payment was NOT successful (pendingSubmissionData would be cleared on success)
        // This means modal was closed before payment was confirmed
        // console.log("PaperUploadForm: PayNow modal closed by user before payment for paper ID:", newlyCreatedPaperForPayment.id);
        toast({ title: "Payment Incomplete", description: `Submission for "${newlyCreatedPaperForPayment.title}" is saved. You can complete payment from the paper details page.`, duration: 7000});
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`); // Redirect to the paper where they can try to pay again
      }
      // Always reset submission state and temp data when modal closes, regardless of success path
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
    } else if (open && newlyCreatedPaperForPayment) {
      // Modal is opening, ensure pendingSubmissionData is set if not already
      if(!pendingSubmissionData) setPendingSubmissionData(form.getValues());
      // console.log("PaperUploadForm: PayNow modal opened for paper ID:", newlyCreatedPaperForPayment.id);
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
                            {...form.register("file")} // RHF handles file input
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
            paper={newlyCreatedPaperForPayment} // Pass the full paper object
            onPaymentSuccess={handleSuccessfulPayNowPayment}
        />
      )}
    </>
  );
}

