
"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import type { Paper, PaperStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileText, User, Users, Tag, CalendarDays, MessageSquare, DollarSign, Edit, Loader2, AlertTriangle, Sparkles, Clock, Download } from 'lucide-react';
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
import { getPaper, updatePaperStatus, updatePaperData } from '@/lib/paper-service';
import CountdownTimer from '@/components/shared/CountdownTimer';

function PaperDetailsContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  
  const [currentPaper, setCurrentPaper] = useState<Paper | null>(null);
  const [loadingPaper, setLoadingPaper] = useState(true);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [adminFeedbackText, setAdminFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isPaperOverdue, setIsPaperOverdue] = useState(false);

  const [isCheckingPlagiarism, setIsCheckingPlagiarism] = useState(false);
  const [isCheckingAcceptance, setIsCheckingAcceptance] = useState(false);

  useEffect(() => {
    const paperId = params.id as string;
    if (paperId && user) { 
      setLoadingPaper(true);
      getPaper(paperId)
        .then(paper => {
          if (paper && (paper.userId === user?.id || isAdmin)) {
            setCurrentPaper(paper);
            if(paper.adminFeedback) setAdminFeedbackText(paper.adminFeedback);
            if (paper.status === "Payment Pending" && paper.paymentDueDate) {
              if (new Date() > new Date(paper.paymentDueDate)) {
                setIsPaperOverdue(true);
              }
            }
          } else {
            setCurrentPaper(null); 
          }
        })
        .catch(err => {
          console.error("Error fetching paper:", err);
          setCurrentPaper(null);
          toast({ variant: "destructive", title: "Error", description: "Could not load paper details." });
        })
        .finally(() => setLoadingPaper(false));
    } else if (!user && loadingPaper) { 
        // If user is null and we are still in initial loadingPaper state, wait for user.
    } else if (!user && !loadingPaper) {
        setCurrentPaper(null); 
        setLoadingPaper(false);
    }
  }, [params.id, user, isAdmin]); 

  useEffect(() => {
    if (searchParams.get('action') === 'pay' && currentPaper?.status === 'Payment Pending' && !isPaperOverdue) {
      setIsPaymentModalOpen(true);
    }
  }, [searchParams, currentPaper, isPaperOverdue]);

  const handlePaymentSuccess = async (paperId: string) => {
    if (!currentPaper) return;
    try {
      await updatePaperStatus(paperId, 'Submitted', { paidAt: new Date().toISOString() });
      setCurrentPaper(prev => prev ? { ...prev, status: 'Submitted', paidAt: new Date().toISOString(), submissionDate: new Date().toISOString() } : null);
      setIsPaymentModalOpen(false);
      toast({title: "Payment Successful", description: "Paper status updated to Submitted."});
    } catch (error) {
      toast({variant: "destructive", title: "Payment Update Failed", description: "Could not update paper status after payment."});
    }
  };
  
  const handleAdminFeedbackSubmit = async () => {
    if (!currentPaper || !isAdmin || !adminFeedbackText.trim()) return;
    setIsSubmittingFeedback(true);
    try {
      await updatePaperData(currentPaper.id, { adminFeedback: adminFeedbackText, status: "Action Required" });
      setCurrentPaper(prev => prev ? { ...prev, adminFeedback: adminFeedbackText, status: "Action Required" } : null);
      toast({title: "Feedback Submitted", description: "Author will be notified."});
    } catch (error) {
      toast({variant: "destructive", title: "Feedback Submission Failed"});
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleStatusChange = async (newStatus: Paper['status']) => {
    if (!currentPaper || !isAdmin) return;
    try {
      await updatePaperStatus(currentPaper.id, newStatus);
      setCurrentPaper(prev => prev ? { ...prev, status: newStatus } : null);
      toast({title: "Status Updated", description: `Paper status changed to ${newStatus}.`});
    } catch (error) {
      toast({variant: "destructive", title: "Status Update Failed"});
    }
  };

  const handleRunPlagiarismCheck = async () => {
    if (!currentPaper || !currentPaper.abstract) {
        toast({ variant: "destructive", title: "Error", description: "Paper abstract is missing for plagiarism check." });
        return;
    }
    setIsCheckingPlagiarism(true);
    try {
      const result = await plagiarismCheck({ documentText: `${currentPaper.title}\n\n${currentPaper.abstract}` });
      await updatePaperData(currentPaper.id, {
        plagiarismScore: result.plagiarismScore,
        plagiarismReport: { highlightedSections: result.highlightedSections }
      });
      setCurrentPaper(prev => prev ? {
        ...prev,
        plagiarismScore: result.plagiarismScore,
        plagiarismReport: { highlightedSections: result.highlightedSections }
      } : null);
      toast({ title: "Plagiarism Check Complete" });
    } catch (error) {
      console.error("Plagiarism check error:", error);
      toast({ variant: "destructive", title: "Plagiarism Check Failed", description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setIsCheckingPlagiarism(false);
    }
  };

  const handleRunAcceptanceCheck = async () => {
    if (!currentPaper || !currentPaper.abstract) {
        toast({ variant: "destructive", title: "Error", description: "Paper abstract is missing for acceptance check." });
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
      toast({ title: "Acceptance Probability Check Complete" });
    } catch (error) {
      console.error("Acceptance check error:", error);
      toast({ variant: "destructive", title: "Acceptance Check Failed", description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setIsCheckingAcceptance(false);
    }
  };

  const handleViewDownloadPaper = () => {
    if (currentPaper?.fileUrl) {
        // In a real app, this would open the URL: window.open(currentPaper.fileUrl, '_blank');
        toast({
            title: "Simulating File Action",
            description: `Displaying/downloading: ${currentPaper.fileName || 'paper'}. URL: ${currentPaper.fileUrl}`,
        });
    } else {
        toast({
            variant: "destructive",
            title: "File Not Available",
            description: "The URL for this paper file is missing.",
        });
    }
  };


  if (loadingPaper) {
    return <div className="flex justify-center items-center py-20"><LoadingSpinner size={48} /></div>;
  }

  if (!currentPaper) {
    return (
      <div className="container py-12 text-center px-4">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold">Paper Not Found</h2>
        <p className="text-muted-foreground">The paper you are looking for does not exist or you do not have permission to view it.</p>
        <Button onClick={() => router.push(isAdmin ? '/admin/dashboard' : '/dashboard')} className="mt-6">Go to Dashboard</Button>
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
      <Card className="shadow-xl">
        <CardHeader className="border-b">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <Badge variant={getStatusBadgeVariant(effectiveStatus)} className="mb-2">{effectiveStatus}</Badge>
              <CardTitle className="text-2xl md:text-3xl font-bold">{currentPaper.title}</CardTitle>
              <CardDescription className="mt-1 text-md">
                {currentPaper.fileName ? (
                  <span className="flex items-center"><FileText className="h-4 w-4 mr-2" />{currentPaper.fileName}</span>
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
            <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto items-stretch md:items-center">
                 <Button onClick={handleViewDownloadPaper} size="lg" variant="outline" className="w-full md:w-auto">
                    <Download className="mr-2 h-5 w-5" /> View/Download Paper
                </Button>
                {effectiveStatus === 'Payment Pending' && !isAdmin && !isPaperOverdue && (
                <Button onClick={() => setIsPaymentModalOpen(true)} size="lg" className="w-full md:w-auto">
                    <DollarSign className="mr-2 h-5 w-5" /> Proceed to Payment
                </Button>
                )}
                {isAdmin && (
                    <Button onClick={() => router.push(`/admin/dashboard?edit=${currentPaper.id}`)} variant="outline" className="w-full md:w-auto">
                        <Edit className="mr-2 h-4 w-4" /> Manage Paper
                    </Button>
                )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center"><User className="h-5 w-5 mr-2 text-primary" />Abstract</h3>
              <p className="text-muted-foreground whitespace-pre-wrap">{currentPaper.abstract}</p>
            </div>
            
            <Separator />
            
            {/* AI Analysis Tools - Only for Admins */}
            {isAdmin && (
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center">
                  <Sparkles className="h-5 w-5 mr-2 text-primary" /> AI Analysis Tools (Title & Abstract)
                </h3>
                <div className="grid sm:grid-cols-2 gap-4 mb-6">
                  <Button onClick={handleRunPlagiarismCheck} disabled={isCheckingPlagiarism || isCheckingAcceptance} variant="outline">
                    {isCheckingPlagiarism ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4" />} {/* Changed Icon */}
                    {currentPaper.plagiarismScore !== null ? 'Re-run Plagiarism Check' : 'Run Plagiarism Check'}
                  </Button>
                  <Button onClick={handleRunAcceptanceCheck} disabled={isCheckingPlagiarism || isCheckingAcceptance} variant="outline">
                    {isCheckingAcceptance ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4" />} {/* Changed Icon */}
                    {currentPaper.acceptanceProbability !== null ? 'Re-run Acceptance Check' : 'Run Acceptance Check'}
                  </Button>
                </div>

                {currentPaper.plagiarismScore !== null && currentPaper.plagiarismReport && (
                    <PlagiarismReport result={{ plagiarismScore: currentPaper.plagiarismScore, highlightedSections: currentPaper.plagiarismReport.highlightedSections }} />
                )}
                {currentPaper.acceptanceProbability !== null && currentPaper.acceptanceReport && (
                    <AcceptanceProbabilityReport result={{ probabilityScore: currentPaper.acceptanceProbability, reasoning: currentPaper.acceptanceReport.reasoning }} />
                )}
                {(!currentPaper.plagiarismScore && !currentPaper.acceptanceProbability && !isCheckingPlagiarism && !isCheckingAcceptance) && (
                    <Alert variant="default" className="mt-4">
                      <Sparkles className="h-4 w-4" />
                      <AlertTitle>AI Analysis Available</AlertTitle>
                      <AlertDescription>
                        Run plagiarism and acceptance probability checks based on the paper's title and abstract using the buttons above.
                      </AlertDescription>
                    </Alert>
                )}
                 <Separator className="my-6"/>
              </div>
            )}
            
            {currentPaper.adminFeedback && (
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center"><MessageSquare className="h-5 w-5 mr-2 text-primary" />Admin/Reviewer Feedback</h3>
                <Alert variant={currentPaper.status === "Action Required" ? "destructive" : "default"} className="bg-secondary/50">
                  {currentPaper.status === "Action Required" ? <AlertTriangle className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  <AlertTitle>Feedback Received</AlertTitle>
                  <AlertDescription className="whitespace-pre-wrap">{currentPaper.adminFeedback}</AlertDescription>
                </Alert>
              </div>
            )}

            {isAdmin && effectiveStatus !== "Payment Overdue" && (
              <div className="mt-6 p-4 border rounded-md">
                <h3 className="text-lg font-semibold mb-2">Provide Feedback to Author</h3>
                <Label htmlFor="adminFeedback">Feedback / Comments</Label>
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
                  {isSubmittingFeedback ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                  Submit Feedback & Mark as 'Action Required'
                </Button>
              </div>
            )}
             {isAdmin && (
                <div className="mt-6 p-4 border rounded-md">
                  <h3 className="text-lg font-semibold mb-2">Change Paper Status</h3>
                  <div className="flex flex-wrap gap-2">
                    {(["Submitted", "Under Review", "Accepted", "Rejected", "Action Required", "Published", "Payment Pending"] as Paper['status'][]).map(statusOption => (
                      <Button 
                        key={statusOption}
                        variant={currentPaper.status === statusOption ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleStatusChange(statusOption)}
                        disabled={currentPaper.status === statusOption || (isPaperOverdue && currentPaper.status === "Payment Pending" && statusOption !== "Rejected")}
                      >
                        Mark as {statusOption}
                      </Button>
                    ))}
                     {isPaperOverdue && currentPaper.status === "Payment Pending" && (
                        <Button 
                            variant="destructive"
                            size="sm"
                            onClick={() => handleStatusChange("Rejected")}
                        >
                            Confirm Rejection (Overdue)
                        </Button>
                     )}
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
      <PaymentModal 
        isOpen={isPaymentModalOpen} 
        onOpenChange={setIsPaymentModalOpen} 
        paper={currentPaper} 
        onPaymentSuccess={handlePaymentSuccess} 
      />
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

