
"use client";

import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/hooks/use-auth";
import type { Paper, PaperStatus } from "@/types";
import { Shield, BarChartHorizontalBig, AlertTriangle, Users, FileText, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { getAllPapers, updatePaperStatus } from "@/lib/paper-service"; // Firestore service
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
        const fetchedPapers = await getAllPapers();
        console.log("AdminDashboard: Fetched all papers from Firestore:", fetchedPapers.length);
        
        // Client-side check for overdue payments
        const now = new Date();
        const processedPapers = fetchedPapers.map(p => {
          if (p.status === 'Payment Pending' && p.paymentDueDate && new Date(p.paymentDueDate) < now) {
            // This is a display change, actual status update needs admin action or backend job
            return { ...p, displayStatus: 'Payment Overdue' as PaperStatus }; 
          }
          return { ...p, displayStatus: p.status };
        });
        setPapers(processedPapers);

        // Calculate stats
        const totalSubmissions = processedPapers.length;
        const pendingReview = processedPapers.filter(p => p.status === 'Submitted' || p.status === 'Under Review').length;
        const issuesFound = processedPapers.filter(p => p.status === 'Action Required' || (p.plagiarismScore && p.plagiarismScore > 0.15)).length;
        const paymentPending = processedPapers.filter(p => p.status === 'Payment Pending' && !(p.displayStatus === 'Payment Overdue')).length;

        setStats({ totalSubmissions, pendingReview, issuesFound, paymentPending });

      } catch (error) {
        console.error("AdminDashboard: Error fetching papers from Firestore:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not load papers from the database." });
      } finally {
        setIsLoadingPapers(false);
      }
    } else if (!authLoading && user && !isAdmin) {
      setPapers([]);
      setIsLoadingPapers(false);
    } else if (!authLoading && !user) {
      setPapers([]);
      setIsLoadingPapers(false);
    }
  };

  useEffect(() => {
    fetchAndSetPapers();
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
    try {
      await updatePaperStatus(paperId, 'Rejected');
      toast({title: "Paper Rejected", description: "Paper marked as rejected due to overdue payment."});
      fetchAndSetPapers(); // Refresh list
    } catch (error) {
      toast({variant: "destructive", title: "Error", description: "Failed to reject paper."});
    }
  };

  if (authLoading) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2">Verifying admin status...</p></div>;
  }

  if (user && !isAdmin) {
    return (
      <div className="container py-8 md:py-12 px-4 text-center">
        <Alert variant="destructive" className="max-w-md mx-auto">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Admin Access Required</AlertTitle>
          <AlertDescription>
            Your account is not recognized as an administrator by the application.
            This could be due to:
            <ul className="list-disc list-inside text-left mt-2 text-xs">
              <li>The 'isAdmin' field is missing or set to 'false' (boolean) in your user profile in the Firestore database.</li>
              <li>A delay in user data propagation after login.</li>
            </ul>
            Please verify your Firestore user document or contact support if you believe this is an error.
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
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Authentication Required</AlertTitle>
                <AlertDescription>
                    You need to be logged in as an admin to view this page.
                </AlertDescription>
            </Alert>
             <Link href="/login">
                <Button className="mt-6" onClick={() => localStorage.setItem('redirectAfterLogin', '/admin/dashboard')}>Log In</Button>
            </Link>
        </div>
     );
  }

  if (isLoadingPapers) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2">Loading admin dashboard data...</p></div>;
  }

  return (
    <div className="container py-8 md:py-12 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center">
          <Shield className="mr-3 h-8 w-8 text-primary" /> Admin Panel
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSubmissions}</div>
            <p className="text-xs text-muted-foreground">papers submitted to the platform</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Awaiting Review</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingReview}</div>
            <p className="text-xs text-muted-foreground">papers awaiting admin/reviewer action</p>
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
            <p className="text-xs text-muted-foreground">papers flagged or needing attention</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl flex items-center"><BarChartHorizontalBig className="mr-2 h-5 w-5 text-primary" />All Submissions</CardTitle>
          <CardDescription>Review and manage all papers submitted to the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {papers.length === 0 ? (
            <p className="text-muted-foreground">No papers have been submitted to the platform yet.</p>
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
                      <TableCell>{new Date(paper.uploadDate).toLocaleDateString()}</TableCell>
                      <TableCell>
                        {paper.status === 'Payment Pending' && paper.paymentDueDate ? (
                           (paper as any).displayStatus === 'Payment Overdue' ? (
                             <span className="text-destructive font-semibold">Overdue</span>
                           ) : (
                            <CountdownTimer targetDateISO={paper.paymentDueDate} prefixText="" className="text-xs text-orange-600"/>
                           )
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Link href={`/papers/${paper.id}`}>
                          <Button variant="outline" size="sm">Review</Button>
                        </Link>
                        {(paper as any).displayStatus === 'Payment Overdue' && (
                           <Button variant="destructive" size="sm" onClick={() => handleManualRejectOverdue(paper.id)}>Reject</Button>
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
  return (
    <ProtectedRoute adminOnly={true}>
      <AdminDashboardContent />
    </ProtectedRoute>
  );
}
