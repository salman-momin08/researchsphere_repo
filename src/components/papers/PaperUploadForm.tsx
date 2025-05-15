
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

// Schema for form validation
const paperSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  abstract: z.string().min(50, "Abstract must be at least 50 characters.").max(2000, "Abstract must be less than 2000 characters."),
  authors: z.string().min(1, "At least one author is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  keywords: z.string().min(1, "At least one keyword is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  file: z.any()
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
  const [pendingSubmissionData, setPendingSubmissionData] = useState<PaperFormValues | null>(null); // Declaration

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

  const proceedWithSubmission = async (data: PaperFormValues, isUpdatingAfterPayNow?: boolean): Promise<PaperType | null> => {
    console.log("PaperUploadForm: proceedWithSubmission called. isUpdatingAfterPayNow:", isUpdatingAfterPayNow, "Data keys:", Object.keys(data));
    if (!user || !user.id) {
      setFormError("Authentication Error: User session is invalid. Please log in again.");
      toast({ variant: "destructive", title: "Auth Error", description: "User session invalid. Please re-login." });
      return null;
    }
    setFormError(null);

    const fileList = data.file as FileList | undefined;
    let fileToUpload: File | null = null;

    if (!isUpdatingAfterPayNow) {
      if (typeof window === 'undefined' || !(fileList instanceof FileList) || fileList.length === 0) {
        console.error("PaperUploadForm: proceedWithSubmission - No file provided or file list is invalid for new submission.");
        setFormError("No file provided or file list is invalid. Please select a file.");
        form.setError("file", { type: "manual", message: "A paper file is required." });
        return null;
      }
      fileToUpload = fileList[0];
      console.log("PaperUploadForm: proceedWithSubmission - File to upload:", fileToUpload.name, fileToUpload.type);
    } else {
      console.log("PaperUploadForm: proceedWithSubmission - Updating after PayNow, file upload skipped.");
    }

    const paperApiServiceData = {
      title: data.title,
      abstract: data.abstract,
      authors: data.authors,
      keywords: data.keywords,
      paymentOption: data.paymentOption,
    };

    try {
      console.log("PaperUploadForm: proceedWithSubmission - Calling addPaper service. ExistingPaperId:", isUpdatingAfterPayNow ? newlyCreatedPaperForPayment?.id : undefined);
      const createdOrUpdatedPaper = await addPaper(
        paperApiServiceData,
        fileToUpload,
        user.id,
        isUpdatingAfterPayNow ? newlyCreatedPaperForPayment?.id : undefined
      );
      console.log("PaperUploadForm: proceedWithSubmission - addPaper service call successful. Paper:", createdOrUpdatedPaper);
      return createdOrUpdatedPaper;
    } catch (error: any) {
      const errorMessage = error.message || "An unexpected error occurred during paper submission.";
      console.error("PaperUploadForm: proceedWithSubmission - Error from addPaper service:", errorMessage, error);
      setFormError(errorMessage);
      toast({ variant: "destructive", title: "Submission Failed", description: errorMessage });
      return null;
    }
  };

  const onFormSubmit = async (data: PaperFormValues) => {
    setIsSubmitting(true);
    setFormError(null);
    console.log("PaperUploadForm: onFormSubmit called with data:", data);

    if (data.paymentOption === "payNow") {
      console.log("PaperUploadForm: PayNow option selected. Proceeding with initial paper creation.");
      const initialPaperDataForPayNow = { ...data, paymentOption: "payLater" as "payLater" };
      const createdPaper = await proceedWithSubmission(initialPaperDataForPayNow, false);

      if (createdPaper) {
        console.log("PaperUploadForm: Initial paper created for PayNow, ID:", createdPaper.id, "Data:", createdPaper);
        setNewlyCreatedPaperForPayment(createdPaper);
        setPendingSubmissionData(data); // Store original form data (with paymentOption: "payNow")
        setShowPayNowModal(true);
      } else {
        console.error("PaperUploadForm: Failed to create initial paper for PayNow flow.");
        setIsSubmitting(false);
      }
    } else { // Pay Later
      console.log("PaperUploadForm: PayLater option selected.");
      const createdPaper = await proceedWithSubmission(data, false);
      if (createdPaper) {
        console.log("PaperUploadForm: Paper submitted successfully for PayLater. Paper ID:", createdPaper.id);
        toast({ title: "Paper Submission Initiated!", description: `"${data.title}" processed. Payment is due shortly.` });
        form.reset();
        setFileNameDisplay(null);
        router.push(`/papers/${createdPaper.id}`);
      } else {
        console.error("PaperUploadForm: Paper submission failed for PayLater flow.");
      }
      setIsSubmitting(false);
    }
  };

  const handleSuccessfulPayNowPayment = async () => {
    console.log("PaperUploadForm: handleSuccessfulPayNowPayment Entered. newlyCreatedPaperForPayment:", newlyCreatedPaperForPayment);
    if (!newlyCreatedPaperForPayment || !newlyCreatedPaperForPayment.id || !pendingSubmissionData) {
      console.error("PaperUploadForm: Error in handleSuccessfulPayNowPayment - No paper data found to finalize payment.");
      toast({ variant: "destructive", title: "Error", description: "No paper data found to finalize payment." });
      setShowPayNowModal(false);
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null);
      return;
    }
    
    console.log("PaperUploadForm: Proceeding to update paper status after PayNow. Using pendingSubmissionData:", pendingSubmissionData);
    const updatedPaper = await proceedWithSubmission(pendingSubmissionData, true);

    if (updatedPaper) {
      console.log("PaperUploadForm: Paper updated successfully after PayNow. Paper ID:", updatedPaper.id);
      toast({ title: "Paper Submitted & Paid Successfully!", description: `"${updatedPaper.title}" has been processed.` });
      form.reset();
      setFileNameDisplay(null);
      router.push(`/papers/${updatedPaper.id}`);
    } else {
      console.error("PaperUploadForm: Post-payment update failed for PayNow. Form error:", formError);
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
    if (!open) { 
      if (isSubmitting && newlyCreatedPaperForPayment) {
        console.log("PaperUploadForm: PayNow modal closed before successful payment. Paper ID:", newlyCreatedPaperForPayment.id);
        toast({ title: "Payment Incomplete", description: `Submission for "${newlyCreatedPaperForPayment.title}" is saved but payment is still pending. You can pay later from the paper details page.`, duration: 7000});
        router.push(`/papers/${newlyCreatedPaperForPayment.id}`);
      }
      setIsSubmitting(false);
      setNewlyCreatedPaperForPayment(null);
      setPendingSubmissionData(null); // Usage of the setter
    } else if (open && newlyCreatedPaperForPayment) {
      console.log("PaperUploadForm: PayNow modal opened. Pending data for paper ID:", newlyCreatedPaperForPayment.id, "is:", pendingSubmissionData);
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

