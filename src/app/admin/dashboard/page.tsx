
"use client";

import { useAuth } from "@/hooks/use-auth";
import type { Paper, PaperStatus, User } from "@/types";
import { Shield, BarChartHorizontalBig, AlertTriangle, Users as UsersIcon, FileText as FileTextIcon, Clock, Info, LayoutDashboard, UserCheck, Eye } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { getAllPapers, updatePaperStatus } from "@/lib/paper-service";
import { getAllUsers } from "@/lib/user-service";
import CountdownTimer from "@/components/shared/CountdownTimer";
import { toast } from "@/hooks/use-toast";

function AdminDashboardContent() {
  const { user, isAdminUser, loading: authLoading } = useAuth(); 
  const [papers, setPapers] = useState<Paper[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [stats, setStats] = useState({
    totalSubmissions: 0,
    pendingReview: 0,
    issuesFound: 0,
    paymentPending: 0,
    totalUsers: 0,
    totalAuthors: 0,
    totalReviewers: 0,
  });

  const fetchAdminData = useCallback(async () => {
    if (!authLoading && user && isAdminUser) {
      setIsLoadingData(true);
      try {
        const [fetchedPapers, fetchedUsers] = await Promise.all([
          getAllPapers(),
          getAllUsers()
        ]);

        const now = new Date();
        const processedPapers = fetchedPapers.map(p => {
          const paymentDueDateValid = p.paymentDueDate && !isNaN(new Date(p.paymentDueDate).getTime());
          if (p.status === 'Payment Pending' && paymentDueDateValid && new Date(p.paymentDueDate!) < now) {
            return { ...p, displayStatus: 'Payment Overdue' as PaperStatus };
          }
          return { ...p, displayStatus: p.status };
        });
        setPapers(processedPapers);
        setAllUsers(fetchedUsers);

        const totalSubmissions = processedPapers.length;
        const pendingReview = processedPapers.filter(p => p.status === 'Submitted' || p.status === 'Under Review').length;
        const issuesFound = processedPapers.filter(p => p.status === 'Action Required' || (p.plagiarismScore && p.plagiarismScore > 0.15)).length;
        const paymentPending = processedPapers.filter(p => p.status === 'Payment Pending' && !(p.displayStatus === 'Payment Overdue')).length;

        const totalUsers = fetchedUsers.length;
        const totalAuthors = fetchedUsers.filter(u => u.role === 'Author').length;
        const totalReviewers = fetchedUsers.filter(u => u.role === 'Reviewer').length;

        setStats({
          totalSubmissions,
          pendingReview,
          issuesFound,
          paymentPending,
          totalUsers,
          totalAuthors,
          totalReviewers,
        });
      } catch (error: any) {
        toast({ variant: "destructive", title: "Error Loading Admin Data", description: error.message || "Could not load data for admin." });
      } finally {
        setIsLoadingData(false);
      }
    } else if (!authLoading && user && !isAdminUser) {
      setPapers([]);
      setAllUsers([]);
      setIsLoadingData(false);
    } else if (!authLoading && !user) {
      setPapers([]);
      setAllUsers([]);
      setIsLoadingData(false);
    }
  }, [user, isAdminUser, authLoading]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

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
          description: `An email about the rejection (due to non-payment) for paper "${paperToNotify.title}" would typically be sent to the author. This is a simulation.`,
          variant: "default",
          duration: 7000,
        });
      }
      fetchAdminData(); 
    } catch (error: any) {
      toast({variant: "destructive", title: "Error Rejecting Paper", description: error.message || "Could not update paper status."});
    }
  };

  if (authLoading) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2 text-sm md:text-base">Verifying admin status...</p></div>;
  }
  
  if (!isAdminUser && user) { 
     return (
      <div className="container py-8 md:py-12 px-4 text-center">
        <Alert variant="destructive" className="max-w-lg mx-auto">
          <Shield className="h-5 w-5" />
          <AlertTitle className="text-lg md:text-xl">Admin Access Required</AlertTitle>
          <AlertDescription className="text-sm md:text-base">
            You do not have permission to view this page.
          </AlertDescription>
        </Alert>
        <Link href={user.role === 'Reviewer' ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH}>
          <Button className="mt-6 text-sm md:text-base">Go to Your Dashboard</Button>
        </Link>
      </div>
    );
  }
  
  if (!user) { 
     return (
        <div className="container py-8 md:py-12 px-4 text-center">
            <Alert variant="default" className="max-w-md mx-auto">
                <Info className="h-4 w-4" />
                <AlertTitle className="text-base md:text-lg">Authentication Required</AlertTitle>
                <AlertDescription className="text-xs md:text-sm">
                    You need to be logged in as an admin to view this page.
                </AlertDescription>
            </Alert>
             <Link href="/login">
                <Button className="mt-6 text-sm md:text-base" onClick={() => typeof window !== 'undefined' && localStorage.setItem('redirectAfterLogin', '/admin/dashboard')}>Log In</Button>
            </Link>
        </div>
     );
  }

  if (isLoadingData) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/> <p className="ml-2 text-sm md:text-base">Loading admin dashboard data...</p></div>;
  }
   if (!user.isAdmin) { 
    return (
      <div className="container py-8 md:py-12 px-4 text-center">
          <Alert variant="destructive" className="max-w-lg mx-auto">
              <Shield className="h-5 w-5" />
              <AlertTitle className="text-lg md:text-xl">Admin Access Required</AlertTitle>
              <AlertDescription className="text-sm md:text-base">
                  You do not have permission to view this page. Please check if your admin status is correctly set up in the system.
              </AlertDescription>
          </Alert>
          <Link href={user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard"}>
              <Button className="mt-6 text-sm md:text-base">Go to Your Dashboard</Button>
          </Link>
      </div>
    );
  }


  return (
    <div className="w-full space-y-6 md:space-y-8 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight flex items-center">
          <LayoutDashboard className="mr-2 sm:mr-3 h-6 w-6 sm:h-8 sm:w-8 text-primary" /> Dashboard Overview
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Submissions</CardTitle>
            <FileTextIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats.totalSubmissions}</div>
            <p className="text-xs text-muted-foreground">papers submitted</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Users</CardTitle>
            <UsersIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats.totalUsers}</div>
            <p className="text-xs text-muted-foreground">registered on platform</p>
          </CardContent>
        </Card>
         <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Authors</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats.totalAuthors}</div>
            <p className="text-xs text-muted-foreground">registered as authors</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Reviewers</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats.totalReviewers}</div>
            <p className="text-xs text-muted-foreground">registered as reviewers</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Awaiting Review</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" /> 
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats.pendingReview}</div>
            <p className="text-xs text-muted-foreground">papers awaiting action</p>
          </CardContent>
        </Card>
         <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Payment Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats.paymentPending}</div>
            <p className="text-xs text-muted-foreground">papers awaiting payment</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Potential Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats.issuesFound}</div>
            <p className="text-xs text-muted-foreground">papers flagged</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-lg w-full">
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl flex items-center"><BarChartHorizontalBig className="mr-2 h-5 w-5 text-primary" />All Submissions</CardTitle>
          <CardDescription className="text-sm md:text-base">Review and manage all papers submitted to the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {papers.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 text-sm md:text-base">No papers have been submitted to the platform yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-xs sm:text-sm">
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
                  {papers.map((paper) => {
                    const effectiveStatus = (paper as any).displayStatus || paper.status;
                    const isPaymentOverdue = effectiveStatus === 'Payment Overdue';
                    
                    return (
                      <TableRow key={paper.id}>
                        <TableCell className="font-medium max-w-[150px] sm:max-w-xs truncate">
                          <Link href={`/papers/${paper.id}`} className="hover:text-primary">{paper.title}</Link>
                        </TableCell>
                        <TableCell className="max-w-[150px] sm:max-w-xs truncate">{paper.authors.join(', ')}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(effectiveStatus)} className="text-xs">
                            {effectiveStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>{paper.uploadDate ? new Date(paper.uploadDate).toLocaleDateString() : 'N/A'}</TableCell>
                        <TableCell>
                          {effectiveStatus === 'Payment Pending' || isPaymentOverdue ? (
                             <span className={isPaymentOverdue ? "text-destructive font-semibold" : "text-yellow-600 font-semibold"}>Yes</span>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Link href={`/papers/${paper.id}`}>
                            <Button variant="outline" size="sm" className="text-xs">Review</Button>
                          </Link>
                          {isPaymentOverdue && (
                             <Button variant="destructive" size="sm" onClick={() => paper.id && handleManualRejectOverdue(paper.id)} className="text-xs">Reject</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
  return <AdminDashboardContent />;
}
