
"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth';
import type { Paper } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileText, User, Users, Tag, CalendarDays, ShieldCheck, BarChart3, MessageSquare, DollarSign, Edit, Loader2, AlertTriangle, Sparkles } from 'lucide-react';
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
import { findMockPaperById, allMockPapers } from '@/lib/mock-data'; // Import new functions

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

  const [isCheckingPlagiarism, setIsCheckingPlagiarism] = useState(false);
  const [isCheckingAcceptance, setIsCheckingAcceptance] = useState(false);


  useEffect(() => {
    if (params.id && user) { 
      setLoadingPaper(true);
      // Simulate API call or data fetching
      setTimeout(() => {
        let foundPaper = findMockPaperById(params.id as string);

        if (!foundPaper) {
            const paperTitleFromStorage = localStorage.getItem(`newPaperTitle-${params.id}`);
            const paperAbstractFromStorage = localStorage.getItem(`newPaperAbstract-${params.id}`);
            const paperFileNameFromStorage = localStorage.getItem(`newPaperFileName-${params.id}`);
            
            if (paperTitleFromStorage && paperAbstractFromStorage && paperFileNameFromStorage) {
                 foundPaper = {
                    id: params.id as string,
                    userId: user.id, 
                    title: paperTitleFromStorage,
                    abstract: paperAbstractFromStorage,
                    authors: user.displayName ? [user.displayName] : ["Registered Author"], 
                    keywords: ["new", "submission"],
                    fileName: paperFileNameFromStorage,
                    uploadDate: new Date().toISOString(),
                    status: "Submitted", 
                    plagiarismScore: null,
                    plagiarismReport: null,
                    acceptanceProbability: null,
                    acceptanceReport: null,
                };
                // Add to the main mock data store if not already present
                if (!allMockPapers.find(p => p.id === foundPaper!.id)) {
                    allMockPapers.push(foundPaper!); // This mutates the imported array, careful in real apps
                }
                localStorage.removeItem(`newPaperTitle-${params.id}`);
                localStorage.removeItem(`newPaperAbstract-${params.id}`);
                localStorage.removeItem(`newPaperFileName-${params.id}`);
            }
        }

        if (foundPaper && (foundPaper.userId === user?.id || isAdmin)) {
          setCurrentPaper(foundPaper);
          if(foundPaper.adminFeedback) setAdminFeedbackText(foundPaper.adminFeedback);
        } else {
          setCurrentPaper(null); 
        }
        setLoadingPaper(false);
      }, 500); 
    } else if (!user && loadingPaper) { 
        // If user is null and we are still in initial loadingPaper state, wait for user.
    } else if (!user && !loadingPaper) {
        setCurrentPaper(null); 
        setLoadingPaper(false);
    }
  }, [params.id, user, isAdmin]); 

  useEffect(() => {
    if (searchParams.get('action') === 'pay' && currentPaper?.status === 'Payment Pending') {
      setIsPaymentModalOpen(true);
    }
  }, [searchParams, currentPaper]);

  const handlePaymentSuccess = (paperId: string) => {
    setCurrentPaper(prev => prev ? { ...prev, status: 'Submitted', submissionDate: new Date().toISOString() } : null);
    const paperIndex = allMockPapers.findIndex(p => p.id === paperId); // Use allMockPapers
    if (paperIndex !== -1) {
      allMockPapers[paperIndex].status = 'Submitted';
      allMockPapers[paperIndex].submissionDate = new Date().toISOString();
    }
    setIsPaymentModalOpen(false);
  };
  
  const handleAdminFeedbackSubmit = async () => {
    if (!currentPaper || !isAdmin) return;
    setIsSubmittingFeedback(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setCurrentPaper(prev => prev ? { ...prev, adminFeedback: adminFeedbackText, status: "Action Required" } : null);
    const paperIndex = allMockPapers.findIndex(p => p.id === currentPaper.id); // Use allMockPapers
    if (paperIndex !== -1) {
      allMockPapers[paperIndex].adminFeedback = adminFeedbackText;
      allMockPapers[paperIndex].status = "Action Required";
    }
    toast({title: "Feedback Submitted", description: "Author will be notified."});
    setIsSubmittingFeedback(false);
  };

  const handleStatusChange = async (newStatus: Paper['status']) => {
    if (!currentPaper || !isAdmin) return;
    await new Promise(resolve => setTimeout(resolve, 500));
    setCurrentPaper(prev => prev ? { ...prev, status: newStatus } : null);
    const paperIndex = allMockPapers.findIndex(p => p.id === currentPaper.id); // Use allMockPapers
    if (paperIndex !== -1) {
      allMockPapers[paperIndex].status = newStatus;
    }
    toast({title: "Status Updated", description: `Paper status changed to ${newStatus}.`});
  };

  const handleRunPlagiarismCheck = async () => {
    if (!currentPaper || !currentPaper.abstract) {
        toast({ variant: "destructive", title: "Error", description: "Paper abstract is missing for plagiarism check." });
        return;
    }
    setIsCheckingPlagiarism(true);
    try {
      const result = await plagiarismCheck({ documentText: `${currentPaper.title}\n\n${currentPaper.abstract}` });
      setCurrentPaper(prev => prev ? {
        ...prev,
        plagiarismScore: result.plagiarismScore,
        plagiarismReport: { highlightedSections: result.highlightedSections }
      } : null);
      
      const paperIndex = allMockPapers.findIndex(p => p.id === currentPaper.id); // Use allMockPapers
      if (paperIndex !== -1) {
        allMockPapers[paperIndex].plagiarismScore = result.plagiarismScore;
        allMockPapers[paperIndex].plagiarismReport = { highlightedSections: result.highlightedSections };
      }
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
      setCurrentPaper(prev => prev ? {
        ...prev,
        acceptanceProbability: result.probabilityScore,
        acceptanceReport: { reasoning: result.reasoning }
      } : null);

      const paperIndex = allMockPapers.findIndex(p => p.id === currentPaper.id); // Use allMockPapers
      if (paperIndex !== -1) {
        allMockPapers[paperIndex].acceptanceProbability = result.probabilityScore;
        allMockPapers[paperIndex].acceptanceReport = { reasoning: result.reasoning };
      }
      toast({ title: "Acceptance Probability Check Complete" });
    } catch (error) {
      console.error("Acceptance check error:", error);
      toast({ variant: "destructive", title: "Acceptance Check Failed", description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setIsCheckingAcceptance(false);
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
      case 'Rejected': return 'destructive';
      case 'Under Review': case 'Submitted': return 'secondary';
      case 'Payment Pending': case 'Action Required': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="shadow-xl">
        <CardHeader className="border-b">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <Badge variant={getStatusBadgeVariant(currentPaper.status)} className="mb-2">{currentPaper.status}</Badge>
              <CardTitle className="text-2xl md:text-3xl font-bold">{currentPaper.title}</CardTitle>
              <CardDescription className="mt-1 text-md">
                {currentPaper.fileName ? (
                  <span className="flex items-center"><FileText className="h-4 w-4 mr-2" />{currentPaper.fileName}</span>
                ) : "File information not available"}
              </CardDescription>
            </div>
            {currentPaper.status === 'Payment Pending' && !isAdmin && (
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
        </CardHeader>
        <CardContent className="pt-6 grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center"><User className="h-5 w-5 mr-2 text-primary" />Abstract</h3>
              <p className="text-muted-foreground whitespace-pre-wrap">{currentPaper.abstract}</p>
            </div>
            
            <Separator />

            {/* AI Analysis Section */}
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Sparkles className="h-5 w-5 mr-2 text-primary" /> AI Analysis Tools (Title & Abstract)
              </h3>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                <Button onClick={handleRunPlagiarismCheck} disabled={isCheckingPlagiarism || isCheckingAcceptance} variant="outline">
                  {isCheckingPlagiarism ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {currentPaper.plagiarismScore !== null ? 'Re-run Plagiarism Check' : 'Run Plagiarism Check'}
                </Button>
                <Button onClick={handleRunAcceptanceCheck} disabled={isCheckingPlagiarism || isCheckingAcceptance} variant="outline">
                  {isCheckingAcceptance ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <BarChart3 className="mr-2 h-4 w-4" />}
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
            </div>
            
            <Separator />

            {currentPaper.adminFeedback && (
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center"><MessageSquare className="h-5 w-5 mr-2 text-primary" />Admin/Reviewer Feedback</h3>
                <Alert variant={currentPaper.status === "Action Required" ? "destructive" : "default"} className="bg-secondary/50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Feedback Received</AlertTitle>
                  <AlertDescription className="whitespace-pre-wrap">{currentPaper.adminFeedback}</AlertDescription>
                </Alert>
              </div>
            )}

            {isAdmin && !currentPaper.adminFeedback && (
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
                  Submit Feedback
                </Button>
              </div>
            )}
             {isAdmin && (
                <div className="mt-6 p-4 border rounded-md">
                  <h3 className="text-lg font-semibold mb-2">Change Paper Status</h3>
                  <div className="flex flex-wrap gap-2">
                    {(["Under Review", "Accepted", "Rejected", "Action Required", "Published", "Payment Pending"] as Paper['status'][]).map(statusOption => (
                      <Button 
                        key={statusOption}
                        variant={currentPaper.status === statusOption ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleStatusChange(statusOption)}
                        disabled={currentPaper.status === statusOption}
                      >
                        Mark as {statusOption}
                      </Button>
                    ))}
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
                  <span className="text-muted-foreground">{new Date(currentPaper.uploadDate).toLocaleDateString()}</span>
                </div>
                {currentPaper.submissionDate && (
                  <div className="flex items-center">
                    <CalendarDays className="h-4 w-4 mr-2 text-primary" />
                    <strong>Submitted:</strong>&nbsp;
                    <span className="text-muted-foreground">{new Date(currentPaper.submissionDate).toLocaleDateString()}</span>
                  </div>
                )}
                 <div className="flex items-center">
                  <FileText className="h-4 w-4 mr-2 text-primary" />
                  <strong>File:</strong>&nbsp;
                  {/* In real app, this would be a download link to currentPaper.fileUrl */}
                  <span className="text-muted-foreground hover:underline cursor-pointer" onClick={() => toast({title: "Download Mock", description: `Simulating download for ${currentPaper.fileName}`})}>{currentPaper.fileName || 'View File'}</span>
                </div>
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
