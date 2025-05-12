"use client";

import type { Paper } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Eye, Edit3, Trash2, DollarSign, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface PaperListItemProps {
  paper: Paper;
  onDelete?: (paperId: string) => void; // Optional: if delete functionality is added
}

export default function PaperListItem({ paper, onDelete }: PaperListItemProps) {
  const router = useRouter();

  const getStatusBadgeVariant = (status: Paper['status']) => {
    switch (status) {
      case 'Accepted':
      case 'Published':
        return 'default'; // Default is primary, which is Teal. Consider a success variant if added.
      case 'Rejected':
        return 'destructive';
      case 'Under Review':
      case 'Submitted':
        return 'secondary';
      case 'Payment Pending':
      case 'Action Required':
        return 'outline'; // Or a warning variant if available
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
    <Card className="overflow-hidden transition-shadow hover:shadow-lg">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-xl hover:text-primary transition-colors">
              <Link href={`/papers/${paper.id}`}>{paper.title}</Link>
            </CardTitle>
            <CardDescription className="mt-1">
              Uploaded: {new Date(paper.uploadDate).toLocaleDateString()}
            </CardDescription>
          </div>
          <FileText className="h-8 w-8 text-muted-foreground flex-shrink-0 ml-4" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {paper.abstract}
        </p>
        <div className="flex items-center space-x-2">
          {getStatusIcon(paper.status)}
          <Badge variant={getStatusBadgeVariant(paper.status)}>{paper.status}</Badge>
        </div>
        
        {(paper.plagiarismScore !== null && paper.plagiarismScore !== undefined) && (
          <p className="text-xs text-muted-foreground mt-2">Plagiarism: {(paper.plagiarismScore * 100).toFixed(1)}%</p>
        )}
        {(paper.acceptanceProbability !== null && paper.acceptanceProbability !== undefined) && (
          <p className="text-xs text-muted-foreground mt-1">Acceptance Chance: {(paper.acceptanceProbability * 100).toFixed(1)}%</p>
        )}

      </CardContent>
      <CardFooter className="bg-secondary/30 p-4 flex justify-end space-x-2">
        {paper.status === 'Payment Pending' && (
          <Button size="sm" onClick={() => router.push(`/papers/${paper.id}?action=pay`)}>
            <DollarSign className="mr-2 h-4 w-4" /> Proceed to Payment
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => router.push(`/papers/${paper.id}`)}>
          <Eye className="mr-2 h-4 w-4" /> View Details
        </Button>
        {/* Optional actions like edit/delete can be added here */}
        {/* 
        <Button variant="outline" size="sm" onClick={() => router.push(`/submit?edit=${paper.id}`)}>
          <Edit3 className="mr-2 h-4 w-4" /> Edit
        </Button>
        {onDelete && (
          <Button variant="destructive" size="sm" onClick={() => onDelete(paper.id)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        )}
        */}
      </CardFooter>
    </Card>
  );
}
