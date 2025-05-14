
"use client";

import type { Paper, PaperStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Eye, DollarSign, CheckCircle, AlertCircle, Clock, Download } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react'; 
import CountdownTimer from '../shared/CountdownTimer';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth'; 

interface PaperListItemProps {
  paper: Paper;
  onDelete?: (paperId: string) => void;
}

const PaperListItem = React.memo(({ paper, onDelete }: PaperListItemProps) => {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth(); 
  const [displayStatus, setDisplayStatus] = useState<PaperStatus>(paper.status);
  const [isOverdue, setIsOverdue] = useState(false);

  useEffect(() => {
    if (paper.status === "Payment Pending" && paper.paymentDueDate) {
      if (new Date() > new Date(paper.paymentDueDate)) {
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

  const triggerTextFileDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadOriginalMock = () => {
    if (paper.fileUrl) {
        const fileContent = `
Paper Title: ${paper.title}
Authors: ${paper.authors.join(', ')}
Abstract: ${paper.abstract}
Keywords: ${paper.keywords.join(', ')}
Status: ${paper.status}
Upload Date: ${new Date(paper.uploadDate).toLocaleDateString()}
File Name: ${paper.fileName || 'N/A'}
Original File URL (for reference): ${paper.fileUrl}

This is a mock text file representing the paper "${paper.title}".
In a real application, this button would initiate a download of the actual paper document (${paper.fileName}).
        `;
        const safeTitle = paper.title.replace(/[^\w\s-]/gi, '').replace(/\s+/g, '_');
        triggerTextFileDownload(fileContent.trim(), `${safeTitle}_Paper_Details.txt`);
        toast({ title: "Mock Download Started", description: `A text summary for "${paper.title}" is being downloaded.` });
    } else {
        toast({
            variant: "destructive",
            title: "File Not Available",
            description: "The URL for this paper file is missing or the file was not processed.",
        });
    }
  };

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-lg flex flex-col h-full">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-grow">
            <CardTitle className="text-lg sm:text-xl hover:text-primary transition-colors">
              <Link href={`/papers/${paper.id}`}>{paper.title}</Link>
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
        
      </CardContent>
      <CardFooter className="bg-secondary/30 p-3 sm:p-4 flex flex-col sm:flex-row items-stretch md:items-center justify-end gap-2">
        {paper.status === 'Payment Pending' && displayStatus !== 'Payment Overdue' && user && user.id === paper.userId && (
          <Button size="sm" onClick={() => router.push(`/papers/${paper.id}?action=pay`)} className="w-full sm:w-auto">
            <DollarSign className="mr-2 h-4 w-4" /> Pay Now
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => router.push(`/papers/${paper.id}`)} className="w-full sm:w-auto">
          <Eye className="mr-2 h-4 w-4" /> View Details
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownloadOriginalMock} className="w-full sm:w-auto">
            <Download className="mr-2 h-4 w-4" /> Download Original (Mock)
        </Button>
      </CardFooter>
    </Card>
  );
});

PaperListItem.displayName = 'PaperListItem';

export default PaperListItem;
