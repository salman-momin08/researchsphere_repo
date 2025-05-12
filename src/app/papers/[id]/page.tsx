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

// Extended mock data with AI fields initially null
const mockPapersDB: Paper[] = [
   {
    id: "1", userId: "1", title: "The Future of AI in Academic Research", abstract: "This paper explores the potential impact of artificial intelligence on academic research methodologies and publication processes. It covers areas like automated literature reviews, AI-assisted writing and peer review, and the ethical implications of AI in academia.",
    authors: ["Dr. Alice Wonderland", "Dr. Bob The Builder"], keywords: ["AI", "Academia", "Future", "Research"],
    uploadDate: new Date("2023-10-15T10:00:00Z").toISOString(), status: "Accepted",
    plagiarismScore: 0.05, plagiarismReport: { highlightedSections: ["This specific phrase seems common.", "Another sentence here might be too similar."] },
    acceptanceProbability: 0.85, acceptanceReport: { reasoning: "The paper is well-structured, presents novel ideas, and has strong evidence. Clarity is excellent." },
    fileName: "future_of_ai.pdf"
  },
  {
    id: "2", userId: "1", title: "Quantum Computing: A New Paradigm", abstract: "An in-depth analysis of quantum computing principles and its applications in solving complex problems such as drug discovery, materials science, and cryptography. The paper also discusses current challenges and future prospects of quantum technology.",
    authors: ["Dr. Jane Doe"], keywords: ["Quantum Computing", "Physics", "Technology"],
    uploadDate: new Date("2023-11-01T14:30:00Z").toISOString(), status: "Under Review",
    plagiarismScore: null, plagiarismReport: null,
    acceptanceProbability: null, acceptanceReport: null,
    fileName: "quantum_paradigm.docx"
  },
  {
    id: "3", userId: "1", title: "Sustainable Energy Solutions for Urban Environments",
    abstract: "Investigating innovative sustainable energy solutions to address the growing demands of urban environments and mitigate climate change. This includes a review of solar, wind, and geothermal technologies, as well as smart grid implementations.",
    authors: ["Prof. John Smith", "Dr. Emily White"], keywords: ["Sustainability", "Urban Planning", "Renewable Energy", "Climate Change"],
    uploadDate: new Date("2024-01-20T09:15:00Z").toISOString(), status: "Payment Pending",
    plagiarismScore: null, plagiarismReport: null,
    acceptanceProbability: null, acceptanceReport: null,
    fileName: "sustainable_urban_energy.pdf"
  },
    {
    id: "4", userId: "1", title: "The Role of Gut Microbiota in Human Health",
    abstract: "A comprehensive review of current research on the gut microbiota and its profound impact on various aspects of human health and disease, including metabolism, immunity, and neurological function. Potential therapeutic interventions are also discussed.",
    authors: ["Dr. Sarah Miller", "Dr. Kevin Lee"], keywords: ["Microbiome", "Gut Health", "Immunology", "Medicine"],
    uploadDate: new Date("2024-02-10T16:45:00Z").toISOString(), status: "Action Required",
    adminFeedback: "Please address reviewer comments regarding the methodology section. Specifically, provide more details on the statistical analysis used and clarify the participant selection criteria.",
    plagiarismScore: 0.03, plagiarismReport: { highlightedSections: [] },
    acceptanceProbability: 0.65, acceptanceReport: { reasoning: "The review is comprehensive but lacks a critical perspective on conflicting studies. Methodology needs clarification as per reviewer feedback." },
    fileName: "gut_microbiota_review.docx"
  }
];


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
        let foundPaper = mockPapersDB.find(p => p.id === params.id);

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
                if (!mockPapersDB.find(p => p.id === foundPaper!.id)) {
                    mockPapersDB.push(foundPaper!);
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
        // If user is null and loadingPaper became false (meaning an attempt was made), then set currentPaper to null.
        // This case is mostly to prevent setting currentPaper to null if auth is just slow.
    } else if (!user && !loadingPaper) {
        setCurrentPaper(null); // User not available, and not initial load
        setLoadingPaper(false);
    }
  }, [params.id, user, isAdmin]); // Removed loadingPaper from dependencies

  useEffect(() => {
    if (searchParams.get('action') === 'pay' && currentPaper?.status === 'Payment Pending') {
      setIsPaymentModalOpen(true);
    }
  }, [searchParams, currentPaper]);

  const handlePaymentSuccess = (paperId: string) => {
    setCurrentPaper(prev => prev ? { ...prev, status: 'Submitted', submissionDate: new Date().toISOString() } : null);
    const paperIndex = mockPapersDB.findIndex(p => p.id === paperId);
    if (paperIndex !== -1) {
      mockPapersDB[paperIndex].status = 'Submitted';
      mockPapersDB[paperIndex].submissionDate = new Date().toISOString();
    }
    setIsPaymentModalOpen(false);
  };
  
  const handleAdminFeedbackSubmit = async () => {
    if (!currentPaper || !isAdmin) return;
    setIsSubmittingFeedback(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setCurrentPaper(prev => prev ? { ...prev, adminFeedback: adminFeedbackText, status: "Action Required" } : null);
    const paperIndex = mockPapersDB.findIndex(p => p.id === currentPaper.id);
    if (paperIndex !== -1) {
      mockPapersDB[paperIndex].adminFeedback = adminFeedbackText;
      mockPapersDB[paperIndex].status = "Action Required";
    }
    toast({title: "Feedback Submitted", description: "Author will be notified."});
    setIsSubmittingFeedback(false);
  };

  const handleStatusChange = async (newStatus: Paper['status']) => {
    if (!currentPaper || !isAdmin) return;
    await new Promise(resolve => setTimeout(resolve, 500));
    setCurrentPaper(prev => prev ? { ...prev, status: newStatus } : null);
    const paperIndex = mockPapersDB.findIndex(p => p.id === currentPaper.id);
    if (paperIndex !== -1) {
      mockPapersDB[paperIndex].status = newStatus;
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
      
      const paperIndex = mockPapersDB.findIndex(p => p.id === currentPaper.id);
      if (paperIndex !== -1) {
        mockPapersDB[paperIndex].plagiarismScore = result.plagiarismScore;
        mockPapersDB[paperIndex].plagiarismReport = { highlightedSections: result.highlightedSections };
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

      const paperIndex = mockPapersDB.findIndex(p => p.id === currentPaper.id);
      if (paperIndex !== -1) {
        mockPapersDB[paperIndex].acceptanceProbability = result.probabilityScore;
        mockPapersDB[paperIndex].acceptanceReport = { reasoning: result.reasoning };
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
                  {/* In real app, this would be a download link */}
                  <span className="text-muted-foreground hover:underline cursor-pointer">{currentPaper.fileName || 'View File'}</span>
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

