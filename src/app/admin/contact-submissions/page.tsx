
"use client";

import { useEffect, useState, useCallback } from 'react';
import type { ContactSubmission } from '@/types';
import { getContactSubmissions, markContactSubmissionAsRead } from '@/lib/contact-service';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MailQuestion, AlertTriangle, Check, Eye } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

function ContactSubmissionsPageContent() {
  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<ContactSubmission | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchSubmissions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedSubmissions = await getContactSubmissions();
      setSubmissions(fetchedSubmissions);
    } catch (err: any) {
      const errorMessage = err.message || "Failed to load contact submissions.";
      setError(errorMessage);
      toast({ variant: "destructive", title: "Loading Error", description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const handleViewMessage = async (submission: ContactSubmission) => {
    setSelectedSubmission(submission);
    setIsModalOpen(true);
    if (!submission.isRead) {
      try {
        await markContactSubmissionAsRead(submission.id);
        // Optimistically update UI or refetch
        setSubmissions(prev => 
          prev.map(s => s.id === submission.id ? { ...s, isRead: true } : s)
        );
      } catch (err: any) {
        toast({ variant: "destructive", title: "Update Error", description: "Could not mark message as read." });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-10">
        <LoadingSpinner size={32} /> <p className="ml-2">Loading contact messages...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="max-w-2xl mx-auto">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-lg w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MailQuestion className="h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">Contact Form Submissions</CardTitle>
          </div>
          <CardDescription>View all messages submitted through the contact form. ({submissions.length} messages found)</CardDescription>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No contact messages received yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Sender Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Date Sent</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((submission) => (
                    <TableRow key={submission.id} className={!submission.isRead ? 'font-semibold bg-secondary/30' : ''}>
                       <TableCell>
                        {submission.isRead ? (
                          <Badge variant="outline">Read</Badge>
                        ) : (
                          <Badge variant="default" className="bg-primary">New</Badge>
                        )}
                      </TableCell>
                      <TableCell>{submission.fullName}</TableCell>
                      <TableCell>{submission.email}</TableCell>
                      <TableCell className="max-w-xs truncate">{submission.subject}</TableCell>
                      <TableCell>{new Date(submission.sentAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleViewMessage(submission)}>
                          <Eye className="mr-2 h-4 w-4" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSubmission && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl">Message from: {selectedSubmission.fullName}</DialogTitle>
              <DialogDescription>
                <strong>Email:</strong> {selectedSubmission.email} <br />
                <strong>Subject:</strong> {selectedSubmission.subject} <br />
                <strong>Sent:</strong> {new Date(selectedSubmission.sentAt).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 max-h-[50vh] overflow-y-auto">
              <p className="text-sm whitespace-pre-wrap">{selectedSubmission.message}</p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function AdminContactSubmissionsPage() {
  return (
    <ProtectedRoute adminOnly={true}>
      <ContactSubmissionsPageContent />
    </ProtectedRoute>
  )
}
