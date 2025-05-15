
"use client";

import { useEffect, useState } from 'react';
import type { User } from '@/types';
import { getAllUsers } from '@/lib/user-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Eye, UserCircle, AlertTriangle } from 'lucide-react'; // Eye for Reviewers
import { toast } from '@/hooks/use-toast';

export default function ReviewerManagementPage() {
  const [reviewerUsers, setReviewerUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReviewerUsers = async () => {
      setIsLoading(true);
      setError(null);
      console.log("ReviewerManagementPage: Fetching all users to filter for reviewers...");
      try {
        const allUsers = await getAllUsers();
        const filteredReviewers = allUsers.filter(user => user.role === "Reviewer");
        console.log(`ReviewerManagementPage: Found ${filteredReviewers.length} reviewer users.`);
        setReviewerUsers(filteredReviewers);
      } catch (err: any) {
        console.error("ReviewerManagementPage: Error fetching users:", err);
        setError(err.message || "Failed to load reviewer users.");
        toast({ variant: "destructive", title: "Error Loading Reviewers", description: err.message });
      } finally {
        setIsLoading(false);
      }
    };

    fetchReviewerUsers();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-10">
        <LoadingSpinner size={32} /> <p className="ml-2">Loading registered reviewers...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="w-full max-w-2xl mx-auto">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-lg w-full"> {/* Ensure card takes full width */}
        <CardHeader>
          <div className="flex items-center gap-2">
            <Eye className="h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">Reviewer Management</CardTitle>
          </div>
          <CardDescription>View all users registered with the &quot;Reviewer&quot; role. ({reviewerUsers.length} reviewers found)</CardDescription>
        </CardHeader>
        <CardContent>
          {reviewerUsers.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No reviewers found with the &quot;Reviewer&quot; role.</p>
          ) : (
            <div className="overflow-x-auto"> {/* Added for responsiveness on smaller screens */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Display Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Institution</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewerUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.displayName || 'N/A'}</TableCell>
                      <TableCell>{user.email || 'N/A'}</TableCell>
                      <TableCell>{user.username || 'N/A'}</TableCell>
                      <TableCell>{user.institution || 'N/A'}</TableCell>
                      <TableCell>{user.createdAt ? new Date(user.createdAt as string).toLocaleDateString() : 'N/A'}</TableCell>
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

