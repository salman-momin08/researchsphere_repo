"use client";

import type { Paper } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Eye, Edit3, Trash2, DollarSign, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react'; // Import React for React.memo

interface PaperListItemProps {
  paper: Paper;
  onDelete?: (paperId: string) => void; // Optional: if delete functionality is added
}

const PaperListItem = React.memo(({ paper, onDelete }: PaperListItemProps) => {
  const router = useRouter();

  const getStatusBadgeVariant = (status: Paper['status']) => {
    switch (status) {
      case 'Accepted':
      case 'Published':
        return 'default'; 
      case 'Rejected':
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

  const getStatusIcon = (status: Paper['status']) => {
    switch (status) {
      case 'Accepted':
      case 'Published':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'Rejected':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case 'Payment Pending':
        return <DollarSign className="h-4 w-4 text-yellow-600" />;
      case 'Action Required':
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  }

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-lg flex flex-col h-full">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-grow">
            <CardTitle className="text-lg sm:text-xl hover:text-primary transition-colors">
              <Link href={`/papers/${paper.id}`}>{paper.title}</Link>
            </CardTitle>
            <CardDescription className="mt-1 text-xs sm:text-sm">
              Uploaded: {new Date(paper.uploadDate).toLocaleDateString()}
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
          {getStatusIcon(paper.status)}
          <Badge variant={getStatusBadgeVariant(paper.status)}>{paper.status}</Badge>
        </div>
        
        {(paper.plagiarismScore !== null && paper.plagiarismScore !== undefined) && (
          <p className="text-xs text-muted-foreground">Plagiarism: {(paper.plagiarismScore * 100).toFixed(1)}%</p>
        )}
        {(paper.acceptanceProbability !== null && paper.acceptanceProbability !== undefined) && (
          <p className="text-xs text-muted-foreground">Acceptance Chance: {(paper.acceptanceProbability * 100).toFixed(1)}%</p>
        )}

      </CardContent>
      <CardFooter className="bg-secondary/30 p-3 sm:p-4 flex flex-col sm:flex-row justify-end gap-2">
        {paper.status === 'Payment Pending' && (
          <Button size="sm" onClick={() => router.push(`/papers/${paper.id}?action=pay`)} className="w-full sm:w-auto">
            <DollarSign className="mr-2 h-4 w-4" /> Pay
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => router.push(`/papers/${paper.id}`)} className="w-full sm:w-auto">
          <Eye className="mr-2 h-4 w-4" /> View
        </Button>
      </CardFooter>
    </Card>
  );
});

PaperListItem.displayName = 'PaperListItem'; // Adding display name for the memoized component

export default PaperListItem;
