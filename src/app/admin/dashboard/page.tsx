
"use client";

import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/hooks/use-auth";
import type { Paper } from "@/types";
import { Shield, BarChartHorizontalBig, AlertTriangle, Users, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { allMockPapers } from "@/lib/mock-data"; // Import consolidated mock data

function AdminDashboardContent() {
  const { user } = useAuth(); 
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoadingPapers, setIsLoadingPapers] = useState(true);

  // Stats - simple counts for now
  const totalSubmissions = papers.length;
  const pendingReview = papers.filter(p => p.status === 'Submitted' || p.status === 'Under Review').length;
  const issuesFound = papers.filter(p => p.status === 'Action Required' || (p.plagiarismScore && p.plagiarismScore > 0.15)).length;


  useEffect(() => {
    setIsLoadingPapers(true);
    // Simulate fetching all papers
    setTimeout(() => {
      setPapers(allMockPapers); // Use consolidated mock data
      setIsLoadingPapers(false);
    }, 1000);
  }, []);
  
  const getStatusBadgeVariant = (status: Paper['status']) => {
    switch (status) {
      case 'Accepted': case 'Published': return 'default';
      case 'Rejected': return 'destructive';
      case 'Under Review': case 'Submitted': return 'secondary';
      case 'Payment Pending': case 'Action Required': return 'outline';
      default: return 'secondary';
    }
  };

  if (isLoadingPapers) {
    return <div className="flex justify-center items-center py-10"><LoadingSpinner size={32}/></div>;
  }

  return (
    <div className="container py-8 md:py-12 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center">
          <Shield className="mr-3 h-8 w-8 text-primary" /> Admin Panel
        </h1>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSubmissions}</div>
            <p className="text-xs text-muted-foreground">papers submitted to the platform</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingReview}</div>
            <p className="text-xs text-muted-foreground">papers awaiting admin/reviewer action</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Potential Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{issuesFound}</div>
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
            <p className="text-muted-foreground">No papers have been submitted yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Author(s)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uploaded</TableHead>
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
                        <Badge variant={getStatusBadgeVariant(paper.status)}>{paper.status}</Badge>
                      </TableCell>
                      <TableCell>{new Date(paper.uploadDate).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/papers/${paper.id}`}>
                          <Button variant="outline" size="sm">Review</Button>
                        </Link>
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
