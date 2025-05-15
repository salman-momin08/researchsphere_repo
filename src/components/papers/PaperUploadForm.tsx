
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
      if (typeof window === 'undefined') return true; // SSR validation passes
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
  const [fileNameDisplay, setFileNameDisplay] = useState<string | null>(null); // For UI display of filename

  const [showPayNowModal, setShowPayNowModal] = useState(false);
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
      setFileNameDisplay(watchedFile[0].name);
      form.clearErrors("file");
      console.log("PaperUploadForm: File selected:", watchedFile[0].name, "Type:", watchedFile[0].type, "Size:", watchedFile[0].size);
    } else {
      setFileNameDisplay(null);
    }
  }, [watchedFile, form]);

  const proceedWithSubmission = async (data: PaperFormValues, isUpdatingAfterPayNow?: boolean): Promise<PaperType | null> => {
    console.log("PaperUploadForm: proceedWithSubmission called. Data:", { ...data, file: data.file?.[0]?.name }, "isUpdatingAfterPayNow:", isUpdatingAfterPayNow);
    if (!user || !user.id) {
      console.error("PaperUploadForm: proceedWithSubmission - User or user.id is not available.");
      setFormError("Authentication Error: User session is invalid. Please log in again.");
      return null;
    }
    setFormError(null);

    const fileList = data.file as FileList | undefined;
    let fileToUpload: File | null = null;

    if (!isUpdatingAfterPayNow) { // Only require file for new submissions
        if (typeof window === 'undefined' || !(fileList instanceof FileList) || fileList.length === 0) {
            console.error("PaperUploadForm: proceedWithSubmission - File is not a valid FileList or is empty. Data.file:", data.file);
            setFormError("No file provided or file list is invalid.");
            form.setError("file", { type: "manual", message: "A paper file is required." });
            return null;
        }
        fileToUpload = fileList[0];
        console.log("PaperUploadForm: proceedWithSubmission - File to upload:", fileToUpload.name);
    }


    const paperApiServiceData = {
      title: data.title,
      abstract: data.abstract,
      authors: data.authors,
      keywords: data.keywords,
      paymentOption: data.paymentOption,
    };

    try {
      console.log("PaperUploadForm: Calling addPaper service with paperData:", paperApiServiceData, "and file:", fileToUpload?.name);
      const createdOrUpdatedPaper = await addPaper(
          paperApiServiceData,
          fileToUpload, // Pass null if updating after payNow for an existing paper
          user.id,
          isUpdatingAfterPayNow ? newlyCreatedPaperForPayment?.id : undefined
      );
      console.log("PaperUploadForm: addPaper service successful, paper:", createdOrUpdatedPaper);
      return createdOrUpdatedPaper;
    } catch (error: any) {
      console.error("PaperUploadForm: Error in proceedWithSubmission calling addPaper service:", error);
      const errorMessage = error.message || "An unexpected error occurred during paper submission.";
      setFormError(errorMessage); // Set form error to display in Alert
      // Toast is now handled by the calling function after proceedWithSubmission returns
      return null;
    }
  };

  const onFormSubmit = async (data: PaperFormValues) => {
    console.log("PaperUploadForm: onFormSubmit triggered. Data:", { ...data, file: data.file?.[0]?.name });
    setIsSubmitting(true);
    setFormError(null);

    if (data.paymentOption === "payNow") {
      console.log("PaperUploadForm: PayNow selected. Creating paper with 'Payment Pending' then opening modal.");
      // For "Pay Now", we first create the paper with "Payment Pending" status via addPaper (which handles Cloudinary upload).
      // This ensures the file is uploaded and we have a paper ID before payment simulation.
      const createdPaper = await proceedWithSubmission(data, false); // isUpdatingAfterPayNow is false

      if (createdPaper) {
        setNewlyCreatedPaperForPayment(createdPaper);
        setShowPayNowModal(true);
        // isSubmitting remains true until modal flow completes or cancels
      } else {
        // Error should be set by proceedWithSubmission and displayed in the Alert.
        // A toast is also shown by proceedWithSubmission's caller.
        setIsSubmitting(false); // Re-enable form if initial paper creation fails
      }
    } else { // Pay Later
      console.log("PaperUploadForm: PayLater selected. Proceeding with submission.");
      const createdPaper = await proceedWithSubmission(data, false); // isUpdatingAfterPayNow is false
      if (createdPaper) {
        toast({ title: "Paper Submission Initiated!", description: `"${data.title}" processed. Payment is due shortly.` });
        form.reset();
        setFileNameDisplay(null);
        router.push(`/papers/${createdPaper.id}`);
      } else {
        toast({ variant: "destructive", title: "Submission Failed", description: formError || "Could not submit paper." });
      }
      setIsSubmitting(false);
    }
  };

  const handleSuccessfulPayNowPayment = async () => {
    console.log("PaperUploadForm: handleSuccessfulPayNowPayment Entered. newlyCreatedPaperForPayment:", newlyCreatedPaperForPayment);
    if (!newlyCreatedPaperForPayment || !newlyCreatedPaperForPayment.id || !pendingSubmissionData) {
      toast({ variant: "destructive", title: "Error", description: "No paper data found to finalize payment." });
      setShowPayNowModal(false);
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
      return;
    }

    // Paper is already created (and file uploaded), now update its status to "Submitted"
    try {
      // Use proceedWithSubmission with isUpdatingAfterPayNow = true. File is not re-uploaded.
      const updatedPaper = await proceedWithSubmission(pendingSubmissionData, true);

      if (updatedPaper) {
        toast({ title: "Paper Submitted & Paid Successfully!", description: `"${updatedPaper.title}" has been processed.` });
        form.reset();
        setFileNameDisplay(null);
        router.push(`/papers/${updatedPaper.id}`);
      } else {
         // Error message should be set by proceedWithSubmission.
        toast({ variant: "destructive", title: "Post-Payment Update Failed", description: formError || "Could not update paper status after payment." });
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`); // Still go to paper page
      }
    } catch (error: any) { // Catch any unexpected errors from proceedWithSubmission
      const errorMessage = error.message || "Failed to update paper status after payment.";
      setFormError(errorMessage);
      toast({ variant: "destructive", title: "Post-Payment Update Failed", description: errorMessage });
      console.error("PaperUploadForm: Error updating paper after 'Pay Now' success:", error);
      router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
    } finally {
      setShowPayNowModal(false);
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
    }
  };


  const handlePayNowModalOpenChange = (open: boolean) => {
    setShowPayNowModal(open);
    if (!open) {
      if (isSubmitting && newlyCreatedPaperForPayment) {
        console.log("PaperUploadForm: PayNow modal closed by user before payment success for paper:", newlyCreatedPaperForPayment.title);
        toast({ title: "Payment Incomplete", description: `Submission for "${newlyCreatedPaperForPayment.title}" is saved but payment is still pending. You can pay later from the paper details page.`, duration: 7000});
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
      }
      setIsSubmitting(false); // Always reset submitting state when modal closes
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
    } else if (open && newlyCreatedPaperForPayment) {
      // When modal opens, store the current form data for post-payment update
      setPendingSubmissionData(form.getValues());
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
                            {...form.register("file")} // react-hook-form handles the FileList
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
            paper={newlyCreatedPaperForPayment}
            onPaymentSuccess={handleSuccessfulPayNowPayment}
        />
      )}
    </>
  );
}
