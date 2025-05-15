
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
import type { Paper as PaperType } from '@/types'; // Renamed to avoid conflict
import { UploadCloud, Loader2, AlertTriangle, DollarSign, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { addPaper } from '@/lib/paper-service'; // This will now call the API
import PaymentModal from '@/components/payment/PaymentModal';

const paperSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  abstract: z.string().min(50, "Abstract must be at least 50 characters.").max(2000, "Abstract must be less than 2000 characters."),
  authors: z.string().min(1, "At least one author is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  keywords: z.string().min(1, "At least one keyword is required.").transform(val => val.split(',').map(s => s.trim()).filter(Boolean)),
  file: z.any() 
    .refine(files => {
      if (typeof window === 'undefined') return true; // SSR check
      return files instanceof FileList && files.length > 0;
    }, "A paper file is required.")
    .refine(files => {
      if (typeof window === 'undefined' || !(files instanceof FileList) || files.length === 0) return true;
      return files[0].size <= 10 * 1024 * 1024; // Max 10MB for MongoDB BSON embedding
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
  // Store the full form data (including the File object) for when payment is confirmed
  const [pendingSubmissionData, setPendingSubmissionData] = useState<PaperFormValues | null>(null);


  const form = useForm<PaperFormValues>({
    resolver: zodResolver(paperSchema),
    defaultValues: {
      title: "",
      abstract: "",
      authors: [], // Will be string, then transformed
      keywords: [], // Will be string, then transformed
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


  // This function now only prepares data and calls the service. Toasts and redirects are in calling functions.
  const processPaperSubmission = async (data: PaperFormValues): Promise<PaperType> => {
    console.log("PaperUploadForm: processPaperSubmission called with data:", data);
    if (!user || !user.id) {
      console.error("PaperUploadForm: processPaperSubmission - User or user.id is not available.");
      throw new Error("Authentication Error: User session is invalid. Please log in again.");
    }
    setFormError(null);

    if (typeof window === 'undefined' || !(data.file instanceof FileList) || data.file.length === 0) {
      console.error("PaperUploadForm: processPaperSubmission - File is not a valid FileList or is empty. Data.file:", data.file);
      throw new Error("No file provided or file list is invalid.");
    }
    const fileToUpload = data.file[0];
    console.log("PaperUploadForm: processPaperSubmission - File to upload:", fileToUpload.name);

    // Prepare paper data for the service (excluding fields handled by API or not directly from form)
    const paperApiData = {
      title: data.title,
      abstract: data.abstract,
      authors: data.authors, // Already transformed to array of strings by Zod
      keywords: data.keywords, // Already transformed
      paymentOption: data.paymentOption,
    };

    try {
      console.log("PaperUploadForm: processPaperSubmission - Calling addPaper service with paperData:", paperApiData, "and file:", fileToUpload.name);
      const createdPaper = await addPaper(paperApiData, fileToUpload, user.id); // addPaper now calls the API
      console.log("PaperUploadForm: processPaperSubmission - addPaper service successful, newPaper:", createdPaper);
      return createdPaper;
    } catch (error: any) {
      console.error("PaperUploadForm: Error in processPaperSubmission calling addPaper service:", error);
      setFormError(error.message || "An unexpected error occurred during paper submission.");
      throw error; // Re-throw to be caught by calling function
    }
  };


  const onFormSubmit = async (data: PaperFormValues) => {
    console.log("PaperUploadForm: onFormSubmit triggered. Data:", data);
    setIsSubmitting(true);
    setFormError(null);

    if (data.paymentOption === "payNow") {
      console.log("PaperUploadForm: PayNow selected. Setting pendingSubmissionData and opening modal.");
      setPendingSubmissionData(data); // Store data including the File object
      setShowPayNowModal(true);
      // setIsSubmitting will be true, button remains disabled until modal flow completes or cancels
    } else { // Pay Later
      console.log("PaperUploadForm: PayLater selected. Proceeding with submission.");
      try {
        const newPaper = await processPaperSubmission(data);
        toast({ title: "Paper Submitted Successfully!", description: `"${newPaper.title}" has been processed. Payment is due shortly.` });
        form.reset();
        setFileName(null);
        router.push(`/papers/${newPaper.id}`);
      } catch (error: any) {
        // formError should be set by processPaperSubmission
        toast({variant: "destructive", title: "Submission Failed", description: formError || error.message || "Could not submit paper."});
        console.error("PaperUploadForm: Error during 'Pay Later' submission:", error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleSuccessfulPayNowPayment = async () => {
    console.log("PaperUploadForm: handleSuccessfulPayNowPayment Entered. pendingSubmissionData:", pendingSubmissionData);
    if (!pendingSubmissionData) {
      toast({ variant: "destructive", title: "Error", description: "No submission data found to process payment." });
      setShowPayNowModal(false);
      setIsSubmitting(false); // Ensure form is re-enabled
      return;
    }

    setFormError(null);
    // isSubmitting should already be true from onFormSubmit

    try {
      console.log("PaperUploadForm: handleSuccessfulPayNowPayment - Calling processPaperSubmission.");
      // pendingSubmissionData.file should be a FileList here
      if (typeof window !== 'undefined' && pendingSubmissionData.file instanceof FileList && pendingSubmissionData.file.length > 0) {
        console.log("PaperUploadForm: File details in pendingSubmissionData for PayNow:", pendingSubmissionData.file[0]?.name);
      } else {
        console.error("PaperUploadForm: handleSuccessfulPayNowPayment - File data missing or invalid in pendingSubmissionData.file:", pendingSubmissionData.file);
        throw new Error("File data is missing or invalid. Cannot proceed.");
      }

      const newPaper = await processPaperSubmission(pendingSubmissionData);

      toast({ title: "Paper Submitted & Paid Successfully!", description: `"${newPaper.title}" has been processed.` });
      form.reset();
      setFileName(null);
      setPendingSubmissionData(null); // Clear pending data
      setShowPayNowModal(false);
      router.push(`/papers/${newPaper.id}`);

    } catch (error: any) {
      toast({ variant: "destructive", title: "Submission Failed After Payment", description: formError || error.message || "Could not submit paper after payment." });
      console.error("PaperUploadForm: Error during 'Pay Now' submission after payment:", error);
      // Form error might be set by processPaperSubmission
      setShowPayNowModal(false); // Close modal on error
    } finally {
      setIsSubmitting(false); // Always re-enable form after this flow
      setPendingSubmissionData(null); // Ensure cleared
    }
  };

  const handlePayNowModalOpenChange = (open: boolean) => {
    setShowPayNowModal(open);
    if (!open) { // Modal is closing
      console.log("PaperUploadForm: PayNow modal closed.");
      // If modal is closed without payment success, reset isSubmitting only if it wasn't an error from submission itself
      if (!formError) { // If no active submission error, means user cancelled or payment failed before submission attempt
          setIsSubmitting(false); // Allow form resubmission
      }
      setPendingSubmissionData(null); // Clear data if modal closed for any reason before successful submission
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
                            {...form.register("file")} // react-hook-form handles FileList
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
                    <DollarSign className="mr-2 h-4 w-4 text-green-600" /> Pay Now ($50.00 Submission Fee)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="payLater" id="payLater" disabled={isSubmitting} />
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

      {user && pendingSubmissionData && ( // Pass minimal paper info for modal display
        <PaymentModal
            isOpen={showPayNowModal}
            onOpenChange={handlePayNowModalOpenChange}
            paper={ { title: pendingSubmissionData.title } as PaperType } 
            onPaymentSuccess={handleSuccessfulPayNowPayment}
        />
      )}
    </>
  );
}
