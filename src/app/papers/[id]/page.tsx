
"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import type { Paper, PaperStatus, User, Review } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileText as FileTextIcon, User as UserIcon, Users, Tag, CalendarDays, MessageSquare, DollarSign, Loader2, AlertTriangle, Sparkles, Clock, Download, Eye, UserCheck, UserPlus, Send, Star, MessageCircle, LayoutDashboard as AdminDashboardIcon, Trash2 } from 'lucide-react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import PlagiarismReport from '@/components/papers/PlagiarismReport';
import AcceptanceProbabilityReport from '@/components/papers/AcceptanceProbabilityReport';
import PaymentModal from '@/components/payment/PaymentModal';
import { plagiarismCheck } from '@/ai/flows/plagiarism-check';
import { acceptanceProbability } from '@/ai/flows/acceptance-probability';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { getPaper, updatePaperStatus, updatePaperData, addReviewToPaper, deletePaper } from '@/lib/paper-service';
import CountdownTimer from '@/components/shared/CountdownTimer';
import { getAllUsers, getUserProfile } from '@/lib/user-service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Timestamp } from 'firebase/firestore';
import { Progress } from "@/components/ui/progress";

function PaperDetailsContent() {
  const params = useParams();
  const searchParamsHook = useNextSearchParams();
  const router = useRouter();
  const { user, isAdminUser } = useAuth(); 

  const [currentPaper, setCurrentPaper] = useState<Paper | null>(null);
  const [loadingPaper, setLoadingPaper] = useState(true);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [adminFeedbackText, setAdminFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isPaperOverdue, setIsPaperOverdue] = useState(false);

  const [isCheckingPlagiarism, setIsCheckingPlagiarism] = useState(false);
  const [isCheckingAcceptance, setIsCheckingAcceptance] = useState(false);

  const [availableReviewers, setAvailableReviewers] = useState<User[]>([]);
  const [assignedReviewerDetails, setAssignedReviewerDetails] = useState<User[]>([]);
  const [allReviewData, setAllReviewData] = useState<Array<Review & {reviewerDisplayName?: string}>>([]);


  const [selectedReviewer, setSelectedReviewer] = useState<string>("");
  const [isAssigningReviewer, setIsAssigningReviewer] = useState(false);

  const [reviewComments, setReviewComments] = useState("");
  const [reviewRecommendation, setReviewRecommendation] = useState<Review['recommendation'] | undefined>(undefined);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const [isDownloadingFile, setIsDownloadingFile] = useState(false);
  const [fileDownloadProgress, setFileDownloadProgress] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);


  const isUserAssignedReviewer = user && currentPaper?.assignedReviewerIds?.includes(user.id);
  const hasUserAlreadyReviewed = user && currentPaper?.reviews?.some(r => r.reviewerId === user.id);

  const fetchPaperDetails = useCallback(async () => {
    const paperId = params.id as string;
    if (paperId && user) {
      setLoadingPaper(true);
      try {
        const paper = await getPaper(paperId);
        if (paper) {
          const isOwner = paper.userId === user.id;
          const isAssigned = paper.assignedReviewerIds?.includes(user.id);

          if (!isOwner && !isAdminUser && !isAssigned && paper.status !== "Published") {
            setCurrentPaper(null);
            router.push(isAdminUser ? '/admin/dashboard' : (user?.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
            return;
          }
          setCurrentPaper(paper);
          if (paper.adminFeedback) setAdminFeedbackText(paper.adminFeedback);
          const paymentDueDateValid = paper.paymentDueDate && !isNaN(new Date(paper.paymentDueDate).getTime());
          if (paper.status === "Payment Pending" && paymentDueDateValid) {
            if (new Date() > new Date(paper.paymentDueDate!)) {
              setIsPaperOverdue(true);
            }
          }

          if (paper.assignedReviewerIds && paper.assignedReviewerIds.length > 0) {
            const reviewerPromises = paper.assignedReviewerIds.map(id => getUserProfile(id));
            const reviewers = (await Promise.all(reviewerPromises)).filter(Boolean) as User[];
            setAssignedReviewerDetails(reviewers);
          } else {
            setAssignedReviewerDetails([]);
          }

          if (paper.reviews && paper.reviews.length > 0) {
             const reviewDetailPromises = paper.reviews.map(async (review) => {
                const reviewerProfile = await getUserProfile(review.reviewerId);
                return {
                    ...review,
                    reviewerDisplayName: reviewerProfile?.displayName || `Reviewer (ID: ${review.reviewerId.substring(0,6)})`
                };
             });
             setAllReviewData(await Promise.all(reviewDetailPromises));
          } else {
            setAllReviewData([]);
          }


        } else {
          setCurrentPaper(null);
          router.push(isAdminUser ? '/admin/dashboard' : (user?.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
        }
      } catch (err: any) {
        setCurrentPaper(null);
         router.push(isAdminUser ? '/admin/dashboard' : (user?.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'));
      } finally {
        setLoadingPaper(false);
      }
    } else if (!user && loadingPaper && params.id) {
        // Handled by ProtectedRoute or initial loading screen
    } else if (!user && !loadingPaper) {
      setCurrentPaper(null);
      setLoadingPaper(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, user, isAdminUser, router]); 

  useEffect(() => {
    fetchPaperDetails();
  }, [fetchPaperDetails]);


  useEffect(() => {
    const paymentDueDateValid = currentPaper?.paymentDueDate && !isNaN(new Date(currentPaper.paymentDueDate).getTime());
    if (searchParamsHook.get('action') === 'pay' && currentPaper?.status === 'Payment Pending' && paymentDueDateValid && !isPaperOverdue && user && currentPaper.userId === user.id && !isAdminUser) {
      setIsPaymentModalOpen(true);
    }
  }, [searchParamsHook, currentPaper, isPaperOverdue, user, isAdminUser]);

  useEffect(() => {
    if (isAdminUser) {
      getAllUsers()
        .then(users => setAvailableReviewers(users.filter(u => u.role === "Reviewer" && !u.isSuspended)))
        .catch(() => toast({ variant: "destructive", title: "Error", description: "Could not load reviewers." }));
    }
  }, [isAdminUser]);

  const handlePaymentSuccess = async (paperIdToUpdate?: string) => {
    const targetPaperId = paperIdToUpdate || currentPaper?.id;
    if (!targetPaperId) return;

    try {
      await updatePaperStatus(targetPaperId, 'Submitted', { paidAt: new Date().toISOString() });
      await fetchPaperDetails();
      setIsPaymentModalOpen(false);
      toast({title: "Payment Successful", description: "Paper status updated to Submitted."});
    } catch (error: any) {
      toast({variant: "destructive", title: "Payment Update Failed", description: error.message || "Could not update paper status after payment."});
    }
  };

  const handleAdminFeedbackSubmit = async () => {
    if (!currentPaper || !isAdminUser || !adminFeedbackText.trim()) return;
    setIsSubmittingFeedback(true);
    try {
      await updatePaperData(currentPaper.id, { adminFeedback: adminFeedbackText });
      setCurrentPaper(prev => prev ? { ...prev, adminFeedback: adminFeedbackText } : null);
      toast({
        title: "Feedback Submitted",
        description: `Your feedback for "${currentPaper.title}" has been saved. The author would typically be notified by email (this is simulated).`,
        duration: 7000
      });
      setAdminFeedbackText("");
    } catch (error: any) {
      toast({variant: "destructive", title: "Feedback Submission Failed", description: error.message || "Could not submit feedback."});
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleStatusChange = async (newStatus: Paper['status']) => {
    if (!currentPaper || !isAdminUser) return;
    try {
      await updatePaperStatus(currentPaper.id, newStatus);
      await fetchPaperDetails();
      if (newStatus === "Rejected" && isPaperOverdue) {
        toast({title: "Paper Rejected", description: `Paper marked as rejected due to overdue payment.`});
      } else {
        toast({title: "Status Updated", description: `Paper status changed to ${newStatus}.`});
      }
      if (newStatus !== "Payment Pending") {
        setIsPaperOverdue(false);
      }
    } catch (error: any) {
      toast({variant: "destructive", title: "Status Update Failed", description: error.message || "Could not update status."});
    }
  };

  const handleRunPlagiarismValidation = async () => {
    if (!currentPaper || !currentPaper.fileUrl) {
        toast({ variant: "destructive", title: "Error", description: "Paper file URL is missing for plagiarism validation." });
        return;
    }
    setIsCheckingPlagiarism(true);
    try {
      let inferredFileType: string | undefined = undefined;
      if (currentPaper.fileName) {
        if (currentPaper.fileName.toLowerCase().endsWith('.pdf')) inferredFileType = 'application/pdf';
        else if (currentPaper.fileName.toLowerCase().endsWith('.docx')) inferredFileType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (currentPaper.fileName.toLowerCase().endsWith('.txt')) inferredFileType = 'text/plain';
      }

      const result = await plagiarismCheck({
        documentUrl: currentPaper.fileUrl,
        fileName: currentPaper.fileName || undefined,
        fileType: inferredFileType
      });
      await updatePaperData(currentPaper.id, {
        plagiarismScore: result.plagiarismScore,
        plagiarismReport: { highlightedSections: result.highlightedSections }
      });
      setCurrentPaper(prev => prev ? {
        ...prev,
        plagiarismScore: result.plagiarismScore,
        plagiarismReport: { highlightedSections: result.highlightedSections }
      } : null);
      toast({ title: "Plagiarism Validation (File) Complete" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Plagiarism Validation (File) Failed", description: error.message || "An error occurred." });
    } finally {
      setIsCheckingPlagiarism(false);
    }
  };

  const handleRunAcceptanceValidation = async () => {
    if (!currentPaper || !currentPaper.abstract) {
        toast({ variant: "destructive", title: "Error", description: "Paper abstract is missing for acceptance validation." });
        return;
    }
    setIsCheckingAcceptance(true);
    try {
      const result = await acceptanceProbability({ paperText: `${currentPaper.title}\n\n${currentPaper.abstract}` });
      await updatePaperData(currentPaper.id, {
        acceptanceProbability: result.probabilityScore,
        acceptanceReport: { reasoning: result.reasoning }
      });
      setCurrentPaper(prev => prev ? {
        ...prev,
        acceptanceProbability: result.probabilityScore,
        acceptanceReport: { reasoning: result.reasoning }
      } : null);
      toast({ title: "Acceptance Validation (Abstract) Complete" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Acceptance Validation (Abstract) Failed", description: error.message || "An error occurred." });
    } finally {
      setIsCheckingAcceptance(false);
    }
  };

  const handleDownloadOriginalFile = async () => {
    if (!currentPaper?.fileUrl || isDownloadingFile) return;

    setIsDownloadingFile(true);
    setFileDownloadProgress(0);
    toast({ title: "Download Starting", description: `Preparing to download ${currentPaper.fileName || 'the paper'}...` });

    try {
      const response = await fetch(currentPaper.fileUrl);
      if (!response.ok) {
        // throw new Error(`Download failed: ${response.statusText} (${response.status})`);
        let userMessage = `Download failed: ${response.statusText} (${response.status})`;
        if (response.status === 401) {
            userMessage = "Download unauthorized (401). The file may be private or access is restricted on the server. Please check file permissions on Cloudinary.";
        }
        throw new Error(userMessage);
      }
      if (!response.body) {
        throw new Error('Response body is null, cannot download.');
      }

      const contentLength = response.headers.get('Content-Length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              loaded += value.length;
              if (total > 0) {
                setFileDownloadProgress(Math.round((loaded / total) * 100));
              } else {
                setFileDownloadProgress(prev => Math.min(prev + 5, 95));
              }
            }
            controller.enqueue(value);
          }
          controller.close();
          reader.releaseLock();
        },
        cancel() {
          reader.cancel();
        }
      });

      const blob = await new Response(stream).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentPaper.fileName || 'downloaded_paper_file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "Download Complete", description: `${currentPaper.fileName || 'File'} downloaded.` });
      setFileDownloadProgress(100);
    } catch (error: any) {
      console.error("Download error in PaperDetailsContent:", error);
      let userMessage = error.message || "Could not download the file.";
      // The specific 401 message is now set before throwing the error above.
      toast({ variant: "destructive", title: "Download Failed", description: userMessage });
      setFileDownloadProgress(0);
    } finally {
      setIsDownloadingFile(false);
      setTimeout(() => {
        if (!isDownloadingFile) setFileDownloadProgress(0);
      }, 2000);
    }
  };

  const handleDownloadMetadata = () => {
    if (!currentPaper) return;
    const safeTitle = currentPaper.title.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
    const filename = `${safeTitle}_Details.txt`;
    let content = `Paper Title: ${currentPaper.title}\n`;
    content += `Authors: ${currentPaper.authors.join(', ')}\n`;
    content += `Keywords: ${currentPaper.keywords.join(', ')}\n`;
    content += `Status: ${currentPaper.status}\n`;
    content += `Upload Date: ${currentPaper.uploadDate ? new Date(currentPaper.uploadDate).toLocaleDateString() : 'N/A'}\n\n`;
    content += `Abstract:\n${currentPaper.abstract}\n\n`;
    content += `Original File Name: ${currentPaper.fileName || 'Not available'}\n`;
    content += `File URL: ${currentPaper.fileUrl || 'Not available'}\n`;

    if (isAdminUser || (user && isUserAssignedReviewer)) {
      if (currentPaper.plagiarismScore !== null && currentPaper.plagiarismScore !== undefined) content += `Plagiarism Score: ${(currentPaper.plagiarismScore === -1 ? 'N/A (Analysis Inconclusive)' : (currentPaper.plagiarismScore * 100).toFixed(1) + '%')}\n`;
      if (currentPaper.acceptanceProbability !== null && currentPaper.acceptanceProbability !== undefined) content += `Acceptance Probability: ${(currentPaper.acceptanceProbability * 100).toFixed(1)}%\n`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Details Downloaded", description: `${filename} prepared.` });
  };

  const handleAssignReviewer = async () => {
    if (!currentPaper || !selectedReviewer || !isAdminUser) return;
    setIsAssigningReviewer(true);
    const currentAssigned = currentPaper.assignedReviewerIds || [];
    if (currentAssigned.includes(selectedReviewer)) {
      toast({ variant: "default", title: "Already Assigned", description: "This reviewer is already assigned to this paper." });
      setIsAssigningReviewer(false);
      return;
    }
    try {
      await updatePaperData(currentPaper.id, { assignedReviewerIds: [...currentAssigned, selectedReviewer] });
      await fetchPaperDetails();
      toast({ title: "Reviewer Assigned", description: `Reviewer assigned successfully.` });
      setSelectedReviewer("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Assignment Failed", description: error.message || "Could not assign reviewer." });
    } finally {
      setIsAssigningReviewer(false);
    }
  };

  const handleUnassignReviewer = async (reviewerIdToUnassign: string) => {
    if (!currentPaper || !isAdminUser) return;
    setIsAssigningReviewer(true);
    const currentAssigned = currentPaper.assignedReviewerIds || [];
    const updatedAssigned = currentAssigned.filter(id => id !== reviewerIdToUnassign);
    try {
      await updatePaperData(currentPaper.id, { assignedReviewerIds: updatedAssigned });
      await fetchPaperDetails();
      toast({ title: "Reviewer Unassigned", description: `Reviewer unassigned successfully.` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unassignment Failed", description: error.message || "Could not unassign reviewer." });
    } finally {
      setIsAssigningReviewer(false);
    }
  };

  const handleReviewSubmit = async () => {
    if (!currentPaper || !user || !isUserAssignedReviewer || !reviewComments.trim() || !reviewRecommendation) {
      toast({ variant: "destructive", title: "Missing Information", description: "Please provide comments and a recommendation." });
      return;
    }
    setIsSubmittingReview(true);
    const newReview: Review = {
      reviewerId: user.id,
      comments: reviewComments,
      recommendation: reviewRecommendation,
      submittedAt: new Date().toISOString(),
    };
    try {
      await addReviewToPaper(currentPaper.id, newReview);
      await fetchPaperDetails();
      toast({ title: "Review Submitted", description: "Your review has been successfully submitted." });
      setReviewComments("");
      setReviewRecommendation(undefined);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Review Submission Failed", description: error.message || "Could not submit your review." });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleDeletePaperConfirm = async () => {
    if (!currentPaper || !isAdminUser) return;
    setShowDeleteConfirm(false);
    try {
      await deletePaper(currentPaper.id);
      toast({ title: "Paper Deleted", description: `Paper "${currentPaper.title}" has been successfully deleted.` });
      router.push('/admin/dashboard'); // Navigate admin to dashboard after deletion
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error Deleting Paper", description: error.message || "Could not delete the paper." });
    }
  };


  if (loadingPaper) {
    return <div className="flex justify-center items-center py-20"><LoadingSpinner size={48} /></div>;
  }

  if (!currentPaper) {
    return (
      <div className="container py-12 text-center px-4">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold">Paper Not Found or Access Denied</h2>
        <p className="text-muted-foreground">The paper may have been removed, or you might not have permission to view it.</p>
        <Button onClick={() => router.push(isAdminUser ? '/admin/dashboard' : (user?.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard'))} className="mt-6">Go to Dashboard</Button>
      </div>
    );
  }

  const getStatusBadgeVariant = (status: Paper['status']) => {
    switch (status) {
      case 'Accepted': case 'Published': return 'default';
      case 'Rejected': case 'Payment Overdue': return 'destructive';
      case 'Under Review': case 'Submitted': return 'secondary';
      case 'Payment Pending': case 'Action Required': return 'outline';
      default: return 'secondary';
    }
  };

  const effectiveStatus = isPaperOverdue && currentPaper.status === "Payment Pending" ? "Payment Overdue" : currentPaper.status;

  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="shadow-xl max-w-5xl mx-auto">
        <CardHeader className="border-b">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <Badge variant={getStatusBadgeVariant(effectiveStatus)} className="mb-2">{effectiveStatus}</Badge>
              <CardTitle className="text-2xl md:text-3xl font-bold">{currentPaper.title}</CardTitle>
              <CardDescription className="mt-1 text-md">
                {currentPaper.fileName ? (
                  <span className="flex items-center"><FileTextIcon className="h-4 w-4 mr-2" />{currentPaper.fileName}</span>
                ) : "File information not available"}
              </CardDescription>
              {effectiveStatus === 'Payment Pending' && currentPaper.paymentDueDate && (
                <div className="mt-2 text-sm text-orange-600 flex items-center">
                  <Clock className="h-4 w-4 mr-1.5" />
                  <CountdownTimer targetDateISO={currentPaper.paymentDueDate} />
                </div>
              )}
              {effectiveStatus === 'Payment Overdue' && (
                  <Alert variant="destructive" className="mt-2 text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Payment Overdue</AlertTitle>
                    <AlertDescription>The payment deadline for this paper has passed.</AlertDescription>
                  </Alert>
              )}
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full md:w-auto items-stretch md:items-center">
                {currentPaper.fileUrl && (
                  <div className="flex flex-col w-full sm:w-auto">
                    <Button 
                      onClick={handleDownloadOriginalFile} 
                      size="lg" 
                      variant="outline" 
                      className="w-full"
                      disabled={isDownloadingFile || !currentPaper.fileUrl}
                    >
                      {isDownloadingFile ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                      {isDownloadingFile ? 'Downloading...' : 'Download Original File'}
                    </Button>
                    {isDownloadingFile && (
                      <div className="mt-1 w-full">
                        <Progress value={fileDownloadProgress} className="h-1.5" />
                         <p className="text-xs text-muted-foreground text-center">{fileDownloadProgress}%</p>
                      </div>
                    )}
                  </div>
                )}
                 <Button onClick={handleDownloadMetadata} variant="outline" size="lg" className="w-full sm:w-auto" disabled={isDownloadingFile}>
                    <FileTextIcon className="mr-2 h-4 w-4" /> Download Details
                </Button>
                {effectiveStatus === 'Payment Pending' && user && currentPaper.userId === user.id && !isAdminUser && !isPaperOverdue && (
                <Button onClick={() => setIsPaymentModalOpen(true)} size="lg" className="w-full sm:w-auto" disabled={isDownloadingFile}>
                    <DollarSign className="mr-2 h-5 w-5" /> Proceed to Payment
                </Button>
                )}
                {isAdminUser && (
                    <Button onClick={() => router.push('/admin/dashboard')} variant="outline" className="w-full sm:w-auto" disabled={isDownloadingFile}>
                        <AdminDashboardIcon className="mr-2 h-4 w-4" /> Admin Dashboard
                    </Button>
                )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center"><UserIcon className="h-5 w-5 mr-2 text-primary" />Abstract</h3>
              <p className="text-muted-foreground whitespace-pre-wrap">{currentPaper.abstract}</p>
            </div>

            <Separator />

            {(isAdminUser || (user && isUserAssignedReviewer)) && (
              <>
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center">
                    <Sparkles className="h-5 w-5 mr-2 text-primary" /> AI Validation Tools
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-4 mb-6">
                    <Button onClick={handleRunPlagiarismValidation} disabled={isCheckingPlagiarism || isCheckingAcceptance || !currentPaper.fileUrl} variant="outline">
                      {isCheckingPlagiarism ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4" />}
                      {currentPaper.plagiarismScore !== null && currentPaper.plagiarismScore !== undefined ? 'Re-run Plagiarism Validation (File)' : 'Run Plagiarism Validation (File)'}
                    </Button>
                    <Button onClick={handleRunAcceptanceValidation} disabled={isCheckingPlagiarism || isCheckingAcceptance || !currentPaper.abstract} variant="outline">
                      {isCheckingAcceptance ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4" />}
                      {currentPaper.acceptanceProbability !== null && currentPaper.acceptanceProbability !== undefined ? 'Re-run Acceptance Validation (Abstract)' : 'Run Acceptance Validation (Abstract)'}
                    </Button>
                  </div>

                  {currentPaper.plagiarismScore !== null && currentPaper.plagiarismScore !== undefined && currentPaper.plagiarismReport && (
                      <PlagiarismReport result={{ plagiarismScore: currentPaper.plagiarismScore, highlightedSections: currentPaper.plagiarismReport.highlightedSections }} />
                  )}
                  {currentPaper.acceptanceProbability !== null && currentPaper.acceptanceProbability !== undefined && currentPaper.acceptanceReport && (
                      <AcceptanceProbabilityReport result={{ probabilityScore: currentPaper.acceptanceProbability, reasoning: currentPaper.acceptanceReport.reasoning }} />
                  )}
                  {((currentPaper.plagiarismScore === null || currentPaper.plagiarismScore === undefined) && (currentPaper.acceptanceProbability === null || currentPaper.acceptanceProbability === undefined) && !isCheckingPlagiarism && !isCheckingAcceptance) && (
                      <Alert variant="default" className="mt-4">
                        <Sparkles className="h-4 w-4" />
                        <AlertTitle>AI Validation Available</AlertTitle>
                        <AlertDescription>
                          Run plagiarism validation on the uploaded file and acceptance validation on the paper's abstract using the buttons above.
                        </AlertDescription>
                      </Alert>
                  )}
                </div>
                 <Separator className="my-6"/>
              </>
            )}


            {currentPaper.adminFeedback && (user?.id === currentPaper.userId || isAdminUser) && (
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center"><MessageSquare className="h-5 w-5 mr-2 text-primary" />
                  {isAdminUser? "Current Feedback Sent to Author" : "Admin/Reviewer Feedback"}
                </h3>
                <Alert variant={currentPaper.status === "Action Required" ? "destructive" : "default"} className="bg-secondary/50">
                  {currentPaper.status === "Action Required" ? <AlertTriangle className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  <AlertTitle>Feedback</AlertTitle>
                  <AlertDescription className="whitespace-pre-wrap">{currentPaper.adminFeedback}</AlertDescription>
                </Alert>
              </div>
            )}


            {isAdminUser && effectiveStatus !== "Payment Overdue" && (
              <Card className="mt-6 p-4 border rounded-md bg-card">
                <CardHeader className="p-2">
                    <CardTitle className="text-lg flex items-center"><MessageSquare className="h-5 w-5 mr-2 text-primary" />Provide Feedback to Author</CardTitle>
                </CardHeader>
                <CardContent className="p-2 space-y-2">
                <Label htmlFor="adminFeedback">Feedback / Comments (this will be visible to the author)</Label>
                <Textarea
                  id="adminFeedback"
                  value={adminFeedbackText}
                  onChange={(e) => setAdminFeedbackText(e.target.value)}
                  rows={4}
                  placeholder="Enter feedback for the author..."
                  className="mb-2"
                  disabled={isSubmittingFeedback}
                />
                <Button onClick={handleAdminFeedbackSubmit} disabled={isSubmittingFeedback || !adminFeedbackText.trim()}>
                  {isSubmittingFeedback ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                  Submit Feedback
                </Button>
                </CardContent>
              </Card>
            )}

             {isAdminUser && (
                <Card className="mt-6 p-4 border rounded-md bg-card">
                  <CardHeader className="p-2">
                    <CardTitle className="text-lg">Manage Paper</CardTitle>
                  </CardHeader>
                  <CardContent className="p-2 space-y-3">
                    <div>
                      <h4 className="font-medium mb-1">Change Status:</h4>
                      <div className="flex flex-wrap gap-2">
                          {(["Submitted", "Under Review", "Accepted", "Rejected", "Action Required", "Published", "Payment Pending"] as Paper['status'][]).map(statusOption => (
                          <Button
                              key={statusOption}
                              variant={currentPaper.status === statusOption ? "default" : "outline"}
                              size="sm"
                              onClick={() => handleStatusChange(statusOption)}
                              disabled={isSubmittingFeedback || currentPaper.status === statusOption || (isPaperOverdue && currentPaper.status === "Payment Pending" && statusOption !== "Rejected")}
                          >
                              Mark as {statusOption}
                          </Button>
                          ))}
                          {isPaperOverdue && currentPaper.status === "Payment Pending" && (
                              <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleStatusChange("Rejected")}
                                  disabled={isSubmittingFeedback}
                              >
                                  Confirm Rejection (Overdue)
                              </Button>
                          )}
                      </div>
                    </div>
                    {currentPaper.status === 'Published' && (
                      <div className="pt-3">
                        <h4 className="font-medium mb-1">Delete Paper:</h4>
                          <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete This Published Paper
                          </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

            {isAdminUser && (
              <Card className="mt-6 p-4 border rounded-md bg-card">
                <CardHeader className="p-2">
                  <CardTitle className="text-lg flex items-center"><UserCheck className="h-5 w-5 mr-2 text-primary" />Manage Reviewers</CardTitle>
                </CardHeader>
                <CardContent className="p-2 space-y-3">
                {assignedReviewerDetails && assignedReviewerDetails.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-md font-medium mb-1">Currently Assigned:</h4>
                    <ul className="list-disc list-inside pl-2 text-sm space-y-1">
                      {assignedReviewerDetails.map(reviewer => (
                        <li key={reviewer.id} className="flex justify-between items-center py-1">
                          <span>{reviewer.displayName || reviewer.email}</span>
                          <Button variant="ghost" size="sm" onClick={() => handleUnassignReviewer(reviewer.id)} disabled={isAssigningReviewer}>
                            Unassign
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {availableReviewers.filter(r => !currentPaper.assignedReviewerIds?.includes(r.id)).length > 0 ? (
                  <div className="flex items-center gap-2">
                    <Select value={selectedReviewer} onValueChange={setSelectedReviewer} disabled={isAssigningReviewer}>
                      <SelectTrigger className="flex-grow">
                        <SelectValue placeholder="Select a reviewer to assign" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableReviewers
                          .filter(r => !currentPaper.assignedReviewerIds?.includes(r.id))
                          .map(rev => (
                            <SelectItem key={rev.id} value={rev.id}>
                              {rev.displayName} ({rev.email})
                            </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleAssignReviewer} disabled={!selectedReviewer || isAssigningReviewer}>
                      {isAssigningReviewer ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                      Assign
                    </Button>
                  </div>
                ) : (
                   assignedReviewerDetails && assignedReviewerDetails.length === 0 && <p className="text-sm text-muted-foreground">No reviewers currently assigned. No available reviewers to assign.</p>
                )}
                {availableReviewers.filter(r => !currentPaper.assignedReviewerIds?.includes(r.id)).length === 0 && assignedReviewerDetails && assignedReviewerDetails.length > 0 && (
                     <p className="text-sm text-muted-foreground">All available reviewers are assigned or no other reviewers to assign.</p>
                )}
                </CardContent>
              </Card>
            )}

            {isUserAssignedReviewer && !hasUserAlreadyReviewed && user && !isAdminUser && (
              <Card className="mt-6 p-4 border-primary/30 bg-card">
                <CardHeader className="p-2">
                  <CardTitle className="text-lg flex items-center"><MessageCircle className="mr-2 h-6 w-6 text-primary" />Submit Your Review</CardTitle>
                  <CardDescription>Provide your feedback and recommendation for this paper.</CardDescription>
                </CardHeader>
                <CardContent className="p-2 space-y-4">
                  <div>
                    <Label htmlFor="reviewComments">Comments *</Label>
                    <Textarea
                      id="reviewComments"
                      value={reviewComments}
                      onChange={(e) => setReviewComments(e.target.value)}
                      rows={6}
                      placeholder="Provide detailed comments on the paper's strengths, weaknesses, and suggestions for improvement..."
                      className="mt-1"
                      disabled={isSubmittingReview}
                    />
                  </div>
                  <div>
                    <Label htmlFor="reviewRecommendation">Recommendation *</Label>
                    <Select
                      value={reviewRecommendation}
                      onValueChange={(value) => setReviewRecommendation(value as Review['recommendation'])}
                      disabled={isSubmittingReview}
                    >
                      <SelectTrigger id="reviewRecommendation" className="mt-1">
                        <SelectValue placeholder="Select your recommendation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Accept">Accept</SelectItem>
                        <SelectItem value="Minor Revision">Minor Revision</SelectItem>
                        <SelectItem value="Major Revision">Major Revision</SelectItem>
                        <SelectItem value="Reject">Reject</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleReviewSubmit} disabled={isSubmittingReview || !reviewComments.trim() || !reviewRecommendation} className="w-full">
                    {isSubmittingReview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Submit Review
                  </Button>
                </CardContent>
              </Card>
            )}

            {allReviewData && allReviewData.length > 0 && (user?.id === currentPaper.userId || isAdminUser) && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold mb-2 flex items-center"><Star className="h-5 w-5 mr-2 text-primary" />Reviews Received</h3>
                <div className="space-y-4">
                  {allReviewData.map((review, index) => {
                    let reviewerDisplayName = `Reviewer ${index + 1}`; 
                    if (isAdminUser) {
                        reviewerDisplayName = review.reviewerDisplayName || `Reviewer (ID: ${review.reviewerId.substring(0,6)})`;
                    } else if (user?.id === review.reviewerId && user?.role === "Reviewer") { 
                        reviewerDisplayName = "Your Review";
                    }

                    return (
                      <Card key={index} className="bg-secondary/50">
                        <CardHeader>
                          <CardTitle className="text-md">
                            {reviewerDisplayName}
                          </CardTitle>
                          <CardDescription>
                            Recommendation: <Badge variant={review.recommendation === "Accept" ? "default" : review.recommendation === "Reject" ? "destructive" : "secondary"}>{review.recommendation}</Badge>
                            <span className="text-xs ml-2 text-muted-foreground">Submitted: {new Date(review.submittedAt).toLocaleDateString()}</span>
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm whitespace-pre-wrap">{review.comments}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}


          </div>
          <aside className="space-y-6">
            <Card className="bg-secondary/50">
              <CardHeader>
                <CardTitle className="text-lg">Paper Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start">
                  <Users className="h-4 w-4 mr-2 mt-1 text-primary flex-shrink-0" />
                  <div>
                    <strong>Authors:</strong>&nbsp;
                    <span className="text-muted-foreground">{currentPaper.authors.join(', ')}</span>
                  </div>
                </div>
                <div className="flex items-start">
                  <Tag className="h-4 w-4 mr-2 mt-1 text-primary flex-shrink-0" />
                   <div>
                    <strong>Keywords:</strong>&nbsp;
                    <span className="text-muted-foreground">{currentPaper.keywords.join(', ')}</span>
                  </div>
                </div>
                <div className="flex items-center">
                  <CalendarDays className="h-4 w-4 mr-2 text-primary" />
                  <strong>Uploaded:</strong>&nbsp;
                  <span className="text-muted-foreground">{currentPaper.uploadDate ? new Date(currentPaper.uploadDate).toLocaleDateString() : 'N/A'}</span>
                </div>
                {currentPaper.submissionDate && (
                  <div className="flex items-center">
                    <CalendarDays className="h-4 w-4 mr-2 text-primary" />
                    <strong>Submitted:</strong>&nbsp;
                    <span className="text-muted-foreground">{new Date(currentPaper.submissionDate).toLocaleDateString()}</span>
                  </div>
                )}
                {currentPaper.paidAt && (
                   <div className="flex items-center">
                    <DollarSign className="h-4 w-4 mr-2 text-green-600" />
                    <strong>Paid:</strong>&nbsp;
                    <span className="text-muted-foreground">{new Date(currentPaper.paidAt).toLocaleString()}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </CardContent>
      </Card>
      {user && currentPaper && (
        <PaymentModal
          isOpen={isPaymentModalOpen && currentPaper.userId === user.id && !isAdminUser}
          onOpenChange={setIsPaymentModalOpen}
          paper={currentPaper}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}
      {currentPaper && isAdminUser && (
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
                <AlertDialogDescription>
                    Are you sure you want to delete the published paper &quot;{currentPaper.title}&quot;? This action is permanent and cannot be undone.
                </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeletePaperConfirm} className="bg-destructive hover:bg-destructive/90">
                    Delete Paper
                </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

export default function PaperPage() {
  return (
    <ProtectedRoute>
      <PaperDetailsContent />
    </ProtectedRoute>
  );
}
