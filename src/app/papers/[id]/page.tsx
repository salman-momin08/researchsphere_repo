
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
import { FileText, User, Users, Tag, CalendarDays, ShieldCheck, BarChart3, MessageSquare, DollarSign, Edit, Loader2, AlertTriangle } from 'lucide-react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import PlagiarismReport from '@/components/papers/PlagiarismReport';
import AcceptanceProbabilityReport from '@/components/papers/AcceptanceProbabilityReport';
import PaymentModal from '@/components/payment/PaymentModal';
import { plagiarismCheck, PlagiarismCheckInput } from '@/ai/flows/plagiarism-check'; // For re-check, if needed
import { acceptanceProbability, AcceptanceProbabilityInput } from '@/ai/flows/acceptance-probability'; // For re-check
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

// Extended mock data from dashboard, assuming these could be fetched by ID
const mockPapersDB: Paper[] = [
   {
    id: "1", userId: "1", title: "The Future of AI in Academic Research", abstract: "This paper explores the potential impact of artificial intelligence on academic research methodologies and publication processes...",
    authors: ["Dr. Alice Wonderland", "Dr. Bob The Builder"], keywords: ["AI", "Academia", "Future", "Research"],
    uploadDate: new Date("2023-10-15T10:00:00Z").toISOString(), status: "Accepted",
    plagiarismScore: 0.05, plagiarismReport: { highlightedSections: ["This specific phrase seems common.", "Another sentence here might be too similar."] },
    acceptanceProbability: 0.85, acceptanceReport: { reasoning: "The paper is well-structured, presents novel ideas, and has strong evidence. Clarity is excellent." },
    fileName: "future_of_ai.pdf"
  },
  {
    id: "2", userId: "1", title: "Quantum Computing: A New Paradigm", abstract: "An in-depth analysis of quantum computing principles and its applications in solving complex problems...",
    authors: ["Dr. Jane Doe"], keywords: ["Quantum Computing", "Physics", "Technology"],
    uploadDate: new Date("2023-11-01T14:30:00Z").toISOString(), status: "Under Review",
    plagiarismScore: 0.12, plagiarismReport: { highlightedSections: ["This definition of quantum bit is standard.", "The historical overview matches other sources."] },
    acceptanceProbability: 0.60, acceptanceReport: { reasoning: "Solid research, but the novelty could be emphasized more. Some sections lack depth." },
    fileName: "quantum_paradigm.docx"
  },
  {
    id: "3", userId: "1", title: "Sustainable Energy Solutions for Urban Environments",
    abstract: "Investigating innovative sustainable energy solutions to address the growing demands of urban environments and mitigate climate change.",
    authors: ["Prof. John Smith", "Dr. Emily White"], keywords: ["Sustainability", "Urban Planning", "Renewable Energy", "Climate Change"],
    uploadDate: new Date("2024-01-20T09:15:00Z").toISOString(), status: "Payment Pending",
    plagiarismScore: 0.08, plagiarismReport: { highlightedSections: ["Data on solar panel efficiency is widely cited."] },
    acceptanceProbability: 0.72, acceptanceReport: { reasoning: "Relevant topic with good data analysis. The conclusion could be stronger." },
    fileName: "sustainable_urban_energy.pdf"
  },
    {
    id: "4", userId: "1", title: "The Role of Gut Microbiota in Human Health",
    abstract: "A comprehensive review of current research on the gut microbiota and its profound impact on various aspects of human health and disease.",
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
  const [paper, setPaper] = useState<Paper | null>(null);
  const [loadingPaper, setLoadingPaper] = useState(true);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [adminFeedbackText, setAdminFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);


  useEffect(() => {
    if (params.id) {
      setLoadingPaper(true);
      // Simulate fetching paper by ID
      setTimeout(() => {
        const foundPaper = mockPapersDB.find(p => p.id === params.id);
        if (foundPaper && (foundPaper.userId === user?.id || isAdmin)) { // Security check
          setPaper(foundPaper);
          if(foundPaper.adminFeedback) setAdminFeedbackText(foundPaper.adminFeedback);
        } else {
          setPaper(null); // Or redirect to 404/error
        }
        setLoadingPaper(false);
      }, 1000);
    }
  }, [params.id, user, isAdmin]);

  useEffect(() => {
    if (searchParams.get('action') === 'pay' && paper?.status === 'Payment Pending') {
      setIsPaymentModalOpen(true);
    }
  }, [searchParams, paper]);

  const handlePaymentSuccess = (paperId: string) => {
    // Simulate updating paper status in the backend/mock data
    setPaper(prev => prev ? { ...prev, status: 'Submitted', submissionDate: new Date().toISOString() } : null);
    // Update mockDB (this is hacky for client-side mock)
    const paperIndex = mockPapersDB.findIndex(p => p.id === paperId);
    if (paperIndex !== -1) {
      mockPapersDB[paperIndex].status = 'Submitted';
      mockPapersDB[paperIndex].submissionDate = new Date().toISOString();
    }
    setIsPaymentModalOpen(false);
  };
  
  const handleAdminFeedbackSubmit = async () => {
    if (!paper || !isAdmin) return;
    setIsSubmittingFeedback(true);
    // Simulate saving feedback
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setPaper(prev => prev ? { ...prev, adminFeedback: adminFeedbackText, status: "Action Required" } : null);
    // Update mockDB (hacky)
    const paperIndex = mockPapersDB.findIndex(p => p.id === paper.id);
    if (paperIndex !== -1) {
      mockPapersDB[paperIndex].adminFeedback = adminFeedbackText;
      mockPapersDB[paperIndex].status = "Action Required";
    }
    toast({title: "Feedback Submitted", description: "Author will be notified."});
    setIsSubmittingFeedback(false);
  };

  const handleStatusChange = async (newStatus: Paper['status']) => {
    if (!paper || !isAdmin) return;
    // Simulate updating status
    await new Promise(resolve => setTimeout(resolve, 500));
    setPaper(prev => prev ? { ...prev, status: newStatus } : null);
    const paperIndex = mockPapersDB.findIndex(p => p.id === paper.id);
    if (paperIndex !== -1) {
      mockPapersDB[paperIndex].status = newStatus;
    }
    toast({title: "Status Updated", description: `Paper status changed to ${newStatus}.`});
  };


  if (loadingPaper) {
    return <div className="flex justify-center items-center py-20"><LoadingSpinner size={48} /></div>;
  }

  if (!paper) {
    return (
      <div className="container py-12 text-center px-4">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold">Paper Not Found</h2>
        <p className="text-muted-foreground">The paper you are looking for does not exist or you do not have permission to view it.</p>
        <Button onClick={() => router.push('/dashboard')} className="mt-6">Go to Dashboard</Button>
      </div>
    );
  }
  
  const getStatusBadgeVariant = (status: Paper['status']) => {
    // (Same as PaperListItem, can be utility)
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
              <Badge variant={getStatusBadgeVariant(paper.status)} className="mb-2">{paper.status}</Badge>
              <CardTitle className="text-2xl md:text-3xl font-bold">{paper.title}</CardTitle>
              <CardDescription className="mt-1 text-md">
                {paper.fileName ? (
                  <span className="flex items-center"><FileText className="h-4 w-4 mr-2" />{paper.fileName}</span>
                ) : "File information not available"}
              </CardDescription>
            </div>
            {paper.status === 'Payment Pending' && !isAdmin && (
              <Button onClick={() => setIsPaymentModalOpen(true)} size="lg" className="w-full md:w-auto">
                <DollarSign className="mr-2 h-5 w-5" /> Proceed to Payment
              </Button>
            )}
            {isAdmin && (
                 <Button onClick={() => router.push(`/admin/dashboard?edit=${paper.id}`)} variant="outline" className="w-full md:w-auto">
                    <Edit className="mr-2 h-4 w-4" /> Manage Paper
                  </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6 grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center"><User className="h-5 w-5 mr-2 text-primary" />Abstract</h3>
              <p className="text-muted-foreground whitespace-pre-wrap">{paper.abstract}</p>
            </div>
            
            {paper.plagiarismReport && paper.plagiarismScore !== undefined && (
                <PlagiarismReport result={{ plagiarismScore: paper.plagiarismScore, highlightedSections: paper.plagiarismReport.highlightedSections }} />
            )}
            {paper.acceptanceReport && paper.acceptanceProbability !== undefined && (
                 <AcceptanceProbabilityReport result={{ probabilityScore: paper.acceptanceProbability, reasoning: paper.acceptanceReport.reasoning }} />
            )}

            {paper.adminFeedback && (
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center"><MessageSquare className="h-5 w-5 mr-2 text-primary" />Admin/Reviewer Feedback</h3>
                <Alert variant={paper.status === "Action Required" ? "destructive" : "default"} className="bg-secondary/50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Feedback Received</AlertTitle>
                  <AlertDescription className="whitespace-pre-wrap">{paper.adminFeedback}</AlertDescription>
                </Alert>
              </div>
            )}

            {isAdmin && !paper.adminFeedback && (
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
                    {(["Under Review", "Accepted", "Rejected", "Action Required", "Published"] as Paper['status'][]).map(statusOption => (
                      <Button 
                        key={statusOption}
                        variant={paper.status === statusOption ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleStatusChange(statusOption)}
                        disabled={paper.status === statusOption}
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
                    <span className="text-muted-foreground">{paper.authors.join(', ')}</span>
                  </div>
                </div>
                <div className="flex items-start">
                  <Tag className="h-4 w-4 mr-2 mt-1 text-primary flex-shrink-0" />
                   <div>
                    <strong>Keywords:</strong>&nbsp;
                    <span className="text-muted-foreground">{paper.keywords.join(', ')}</span>
                  </div>
                </div>
                <div className="flex items-center">
                  <CalendarDays className="h-4 w-4 mr-2 text-primary" />
                  <strong>Uploaded:</strong>&nbsp;
                  <span className="text-muted-foreground">{new Date(paper.uploadDate).toLocaleDateString()}</span>
                </div>
                {paper.submissionDate && (
                  <div className="flex items-center">
                    <CalendarDays className="h-4 w-4 mr-2 text-primary" />
                    <strong>Submitted:</strong>&nbsp;
                    <span className="text-muted-foreground">{new Date(paper.submissionDate).toLocaleDateString()}</span>
                  </div>
                )}
                 <div className="flex items-center">
                  <FileText className="h-4 w-4 mr-2 text-primary" />
                  <strong>File:</strong>&nbsp;
                  {/* In real app, this would be a download link */}
                  <span className="text-muted-foreground hover:underline cursor-pointer">{paper.fileName || 'View File'}</span>
                </div>
              </CardContent>
            </Card>
            {/* Placeholder for version history or similar */}
          </aside>
        </CardContent>
      </Card>
      <PaymentModal 
        isOpen={isPaymentModalOpen} 
        onOpenChange={setIsPaymentModalOpen} 
        paper={paper} 
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
