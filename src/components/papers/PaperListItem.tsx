
"use client";

import type { Paper, PaperStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Eye, DollarSign, CheckCircle, AlertCircle, Clock, Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import CountdownTimer from '../shared/CountdownTimer';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Progress } from "@/components/ui/progress";

interface PaperListItemProps {
  paper: Paper;
}

const PaperListItem = React.memo(({ paper }: PaperListItemProps) => {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [displayStatus, setDisplayStatus] = useState<PaperStatus>(paper.status);
  const [isOverdue, setIsOverdue] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    if (paper.status === "Payment Pending" && paper.paymentDueDate) {
        const paymentDueDateValid = !isNaN(new Date(paper.paymentDueDate).getTime());
        if (paymentDueDateValid && new Date() > new Date(paper.paymentDueDate)) {
            setDisplayStatus("Payment Overdue");
            setIsOverdue(true);
        } else {
            setDisplayStatus(paper.status);
            setIsOverdue(false);
      }
    } else {
      setDisplayStatus(paper.status);
      setIsOverdue(false);
    }
  }, [paper.status, paper.paymentDueDate]);


  const getStatusBadgeVariant = (status: PaperStatus) => {
    switch (status) {
      case 'Accepted':
      case 'Published':
        return 'default';
      case 'Rejected':
      case 'Payment Overdue':
        return 'destructive';
      case 'Under Review':
      case 'Submitted':
        return 'secondary';
      case 'Payment Pending':
      case 'Action Required':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getStatusIcon = (status: PaperStatus) => {
    switch (status) {
      case 'Accepted':
      case 'Published':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'Rejected':
      case 'Payment Overdue':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'Payment Pending':
        return <DollarSign className="h-4 w-4 text-orange-500" />;
      case 'Action Required':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  }

  const handleDownloadOriginalFile = async () => {
    if (!paper.fileUrl || isDownloading) return;

    setIsDownloading(true);
    setDownloadProgress(0);
    toast({ title: "Download Starting", description: `Preparing to download ${paper.fileName || 'the paper'}...` });

    try {
      const response = await fetch(paper.fileUrl);
      if (!response.ok) {
        let userMessage = `Download failed: ${response.statusText || 'Error'} (${response.status})`;
        if (response.status === 401) {
            userMessage = "Download unauthorized (401). The file may be private or access is restricted on the server. Please check file permissions on Cloudinary.";
        }
        throw new Error(userMessage);
      }
      if (!response.body) {
        throw new Error('Response body is null, cannot download.');
      }

      const contentLength = response.headers.get('Content-Length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              loaded += value.length;
              if (total > 0) {
                setDownloadProgress(Math.round((loaded / total) * 100));
              } else {
                // Indeterminate progress if no total, update slowly
                setDownloadProgress(prev => Math.min(prev + 5, 95));
              }
            }
            controller.enqueue(value);
          }
          controller.close();
          reader.releaseLock();
        },
        cancel() {
          reader.cancel();
        }
      });

      const blob = await new Response(stream).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = paper.fileName || 'downloaded_paper_file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "Download Complete", description: `${paper.fileName || 'File'} downloaded.` });
      setDownloadProgress(100);
    } catch (error: any) {
      console.error("Download error in PaperListItem:", error);
      let userMessage = error.message || "Could not download the file.";
      // Specific message for 401 is now set before throwing the error above.
      toast({ variant: "destructive", title: "Download Failed", description: userMessage });
      setDownloadProgress(0);
    } finally {
      setIsDownloading(false);
      setTimeout(() => {
        if (!isDownloading) setDownloadProgress(0);
      }, 2000);
    }
  };


  const handleDownloadMetadata = () => {
    const safeTitle = paper.title.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
    const filename = `${safeTitle}_Details.txt`;
    let content = `Title: ${paper.title}\n`;
    content += `Authors: ${paper.authors.join(', ')}\n`;
    content += `Keywords: ${paper.keywords.join(', ')}\n`;
    content += `Status: ${paper.status}\n`;
    content += `Upload Date: ${paper.uploadDate ? new Date(paper.uploadDate).toLocaleDateString() : 'N/A'}\n\n`;
    content += `Abstract:\n${paper.abstract}\n\n`;
    content += `Original File Name: ${paper.fileName || 'Not available'}\n`;
    content += `File URL: ${paper.fileUrl || 'Not available'}\n`;


    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Details Downloaded", description: `${filename} has been downloaded.` });
  };


  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-lg flex flex-col h-full">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-grow min-w-0"> {/* Added min-w-0 to allow title to truncate if very long */}
            <CardTitle className="text-lg sm:text-xl hover:text-primary transition-colors truncate">
              <Link href={`/papers/${paper.id}`} title={paper.title}>{paper.title}</Link>
            </CardTitle>
            <CardDescription className="mt-1 text-xs sm:text-sm">
              Uploaded: {paper.uploadDate ? new Date(paper.uploadDate).toLocaleDateString() : 'N/A'}
            </CardDescription>
          </div>
          <FileText className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground flex-shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-2">
        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
          {paper.abstract}
        </p>
        <div className="flex items-center space-x-2">
          {getStatusIcon(displayStatus)}
          <Badge variant={getStatusBadgeVariant(displayStatus)}>{displayStatus}</Badge>
        </div>

        {displayStatus === 'Payment Pending' && paper.paymentDueDate && !isOverdue && (
          <div className="text-xs text-orange-600 flex items-center">
            <Clock className="h-3 w-3 mr-1" />
            <CountdownTimer targetDateISO={paper.paymentDueDate} prefixText="" />
          </div>
        )}
        {isDownloading && (
          <div className="mt-2">
            <Progress value={downloadProgress} className="w-full h-2" />
            <p className="text-xs text-muted-foreground text-center mt-1">{downloadProgress}%</p>
          </div>
        )}

      </CardContent>
      <CardFooter className="bg-secondary/30 p-3 sm:p-4 flex flex-col items-stretch sm:flex-row sm:flex-wrap sm:justify-end sm:items-center gap-2">
        {paper.status === 'Payment Pending' && displayStatus !== 'Payment Overdue' && user && user.id === paper.userId && (
          <Button size="sm" onClick={() => router.push(`/papers/${paper.id}?action=pay`)} className="w-full sm:w-auto" disabled={isDownloading}>
            <DollarSign className="mr-2 h-4 w-4" /> Pay Now
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => router.push(`/papers/${paper.id}`)} className="w-full sm:w-auto" disabled={isDownloading}>
          <Eye className="mr-2 h-4 w-4" /> View Details
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownloadOriginalFile} className="w-full sm:w-auto" disabled={isDownloading || !paper.fileUrl}>
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {isDownloading ? 'Downloading...' : 'Download Original File'}
        </Button>
         <Button variant="outline" size="sm" onClick={handleDownloadMetadata} className="w-full sm:w-auto text-xs" disabled={isDownloading}>
            <FileText className="mr-1 h-3 w-3" /> Download Details
        </Button>
      </CardFooter>
    </Card>
  );
});

PaperListItem.displayName = 'PaperListItem';

export default PaperListItem;

