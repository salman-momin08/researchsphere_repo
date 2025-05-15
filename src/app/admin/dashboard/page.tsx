
"use client";

// import ProtectedRoute from "@/components/auth/ProtectedRoute"; // Already wraps AdminLayout
import { useAuth } from "@/hooks/use-auth";
import type { Paper, PaperStatus } from "@/types";
import { Shield, BarChartHorizontalBig, AlertTriangle, Users, FileText as FileTextIcon, Clock, Info, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { getAllPapers, updatePaperStatus } from "@/lib/paper-service";
import CountdownTimer from "@/components/shared/CountdownTimer";
import { toast } from "@/hooks/use-toast";

function AdminDashboardContent() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoadingPapers, setIsLoadingPapers] = useState(true);

  const [stats, setStats] = useState({
    totalSubmissions: 0,
    pendingReview: 0,
    issuesFound: 0,
    paymentPending: 0,
  });

  const fetchAndSetPapers = async () => {
    if (!authLoading && user && isAdmin) {
      setIsLoadingPapers(true);
      try {
        console.log("AdminDashboardContent: Fetching all papers from Firestore via paper-service.");
        const fetchedPapers = await getAllPapers();
        const now = new Date();
        const processedPapers = fetchedPapers.map(p => {
          const paymentDueDateValid = p.paymentDueDate && !isNaN(new Date(p.paymentDueDate).getTime());
          if (p.status === 'Payment Pending' && paymentDueDateValid && new Date(p.paymentDueDate!) < now) {
            return { ...p, displayStatus: 'Payment Overdue' as PaperStatus };
          }
          return { ...p, displayStatus: p.status };
        });
        setPapers(processedPapers);

        const totalSubmissions = processedPapers.length;
        const pendingReview = processedPapers.filter(p => p.status === 'Submitted' || p.status === 'Under Review').length;
        const issuesFound = processedPapers.filter(p => p.status === 'Action Required' || (p.plagiarismScore && p.plagiarismScore > 0.15)).length;
        const paymentPending = processedPapers.filter(p => p.status === 'Payment Pending' && !(p.displayStatus === 'Payment Overdue')).length;

        setStats({ totalSubmissions, pendingReview, issuesFound, paymentPending });
      } catch (error: any) {
        console.error("AdminDashboard: Error fetching papers:", error);
        toast({ variant: "destructive", title: "Error Loading Papers", description: error.message || "Could not load papers for admin." });
      } finally {
        setIsLoadingPapers(false);
      }
    } else if (!authLoading && user && !isAdmin) {
      setPapers([]);
      setIsLoadingPapers(false);
      // Non-admin should not see this content due to ProtectedRoute in AdminLayout
    } else if (!authLoading && !user) {
      setPapers([]);
      setIsLoadingPapers(false);
      // Logged-out user should not see this
    }
  };

  useEffect(() => {
    fetchAndSetPapers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, authLoading]);

  const getStatusBadgeVariant = (status: PaperStatus | undefined) => {
    switch (status) {
      case 'Accepted': case 'Published': return 'default';
      case 'Rejected': case 'Payment Overdue': return 'destructive';
      case 'Under Review': case 'Submitted': return 'secondary';
      case 'Payment Pending': case 'Action Required': return 'outline';
      default: return 'secondary';
    }
  };

  const handleManualRejectOverdue = async (paperId: string) => {
    const paperToNotify = papers.find(p => p.id === paperId);
    try {
      await updatePaperStatus(paperId, 'Rejected');
      toast({title: "Paper Rejected", description: `Paper "${paperToNotify?.title || 'ID: '+paperId}" marked as rejected due to overdue payment.`});
      if (paperToNotify) {
        toast({
          title: "Email Notification (Simulated)",
          description: `An email notification about the rejection (due to non-payment) would be sent for paper: ${paperToNotify.title}.`,
          variant: "default",
          duration: 7000,
        });
      }
      fetchAndSetPapers();
    } catch (error: any) {
      console.error("Failed to reject paper:", error);
      toast({variant: "destructive", title: "Error Rejecting Paper", description: error.message || "Could not update paper status."});
    }
  };

  // Auth loading and permission checks are largely handled by AdminLayout's ProtectedRoute
  if (authLoading) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2">Verifying admin status...</p></div>;
  }
  
  if (!isAdmin && user) { 
     return (
      <div className="container py-8 md:py-12 px-4 text-center">
        <Alert variant="destructive" className="max-w-lg mx-auto">
          <Shield className="h-5 w-5" /> {/* Changed Icon to Shield for thematic consistency */}
          <AlertTitle>Admin Access Required</AlertTitle>
          <AlertDescription>
            You do not have permission to view this page.
            Your `isAdmin` flag in AuthContext is `false`. 
            Please ensure your user profile in Firestore has `isAdmin: true` (boolean) if you are an administrator.
          </AlertDescription>
        </Alert>
        <Link href="/dashboard">
          <Button className="mt-6">Go to User Dashboard</Button>
        </Link>
      </div>
    );
  }
  
  if (!user) { 
     return (
        <div className="container py-8 md:py-12 px-4 text-center">
            <Alert variant="default" className="max-w-md mx-auto">
                <Info className="h-4 w-4" />
                <AlertTitle>Authentication Required</AlertTitle>
                <AlertDescription>
                    You need to be logged in as an admin to view this page.
                </AlertDescription>
            </Alert>
             <Link href="/login">
                <Button className="mt-6" onClick={() => typeof window !== 'undefined' && localStorage.setItem('redirectAfterLogin', '/admin/dashboard')}>Log In</Button>
            </Link>
        </div>
     );
  }

  if (isLoadingPapers) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2">Loading admin dashboard data...</p></div>;
  }

  return (
    <div className="w-full space-y-8 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center">
          <LayoutDashboard className="mr-3 h-8 w-8 text-primary" /> Dashboard Overview
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <FileTextIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSubmissions}</div>
            <p className="text-xs text-muted-foreground">papers submitted</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Awaiting Review</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingReview}</div>
            <p className="text-xs text-muted-foreground">papers awaiting action</p>
          </CardContent>
        </Card>
         <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payment Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.paymentPending}</div>
            <p className="text-xs text-muted-foreground">papers awaiting payment</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Potential Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.issuesFound}</div>
            <p className="text-xs text-muted-foreground">papers flagged</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-lg w-full">
        <CardHeader>
          <CardTitle className="text-xl flex items-center"><BarChartHorizontalBig className="mr-2 h-5 w-5 text-primary" />All Submissions</CardTitle>
          <CardDescription>Review and manage all papers submitted to the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {papers.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No papers have been submitted to the platform yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Author(s)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Payment Due</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {papers.map((paper) => (
                    <TableRow key={paper.id}>
                      <TableCell className="font-medium max-w-xs truncate">
                        <Link href={`/papers/${paper.id}`} className="hover:text-primary">{paper.title}</Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{paper.authors.join(', ')}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant((paper as any).displayStatus || paper.status)}>
                          {(paper as any).displayStatus || paper.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{paper.uploadDate ? new Date(paper.uploadDate).toLocaleDateString() : 'N/A'}</TableCell>
                      <TableCell>
                        {paper.status === 'Payment Pending' || (paper as any).displayStatus === 'Payment Overdue' ? (
                           <span className="text-destructive font-semibold">Yes</span>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Link href={`/papers/${paper.id}`}>
                          <Button variant="outline" size="sm">Review</Button>
                        </Link>
                        {(paper as any).displayStatus === 'Payment Overdue' && (
                           <Button variant="destructive" size="sm" onClick={() => paper.id && handleManualRejectOverdue(paper.id)}>Reject</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboardPage() {
  // The AdminLayout will handle the ProtectedRoute for adminOnly
  return <AdminDashboardContent />;
}
