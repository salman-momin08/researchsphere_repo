
"use client";

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Search as SearchIcon, FileText as FileTextIcon, Eye, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import type { Paper, PaperStatus } from '@/types';
import { getPublishedPapers } from '@/lib/paper-service'; 
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useRouter } from 'next/navigation';


function SearchPapersContent() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    // Optional: Load all published papers initially or on empty search term
  }, []);

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast({
        variant: "destructive",
        title: "Search Term Required",
        description: "Please enter an author's name to search.",
      });
      setSearchResults([]);
      setHasSearched(true);
      return;
    }
    setIsLoading(true);
    setHasSearched(true);
    setSearchResults([]);

    try {
      const publishedPapers = await getPublishedPapers();
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      // Client-side filtering by author name (case-insensitive, partial match on any author in the list)
      const results = publishedPapers.filter(paper =>
        paper.authors.some(author => author.toLowerCase().includes(lowerCaseSearchTerm))
      );
      setSearchResults(results);
    } catch (error: any)
     {
      toast({
        variant: "destructive",
        title: "Search Error",
        description: error.message || "Could not retrieve or filter papers. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadOriginalPaper = (paper: Paper) => {
    if (paper.fileUrl) {
        console.log("SearchPapersContent: Attempting to open original file URL:", paper.fileUrl);
        window.open(paper.fileUrl, '_blank');
        toast({ title: "Opening Original File", description: `Attempting to open ${paper.fileName || 'the paper'}.` });
    } else {
        toast({
            variant: "destructive",
            title: "File Not Available",
            description: "File URL is missing for this paper.",
        });
    }
  };

  const handleDownloadMetadata = (paper: Paper) => {
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
    toast({ title: "Details Downloaded", description: `${filename} prepared.` });
  };

  const getStatusBadgeVariant = (status: PaperStatus | undefined) => {
    switch (status) {
      case 'Accepted': case 'Published': return 'default';
      case 'Rejected': case 'Payment Overdue': return 'destructive';
      case 'Under Review': case 'Submitted': return 'secondary';
      case 'Payment Pending': case 'Action Required': return 'outline';
      default: return 'secondary';
    }
  };


  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="w-full max-w-4xl mx-auto shadow-xl">
        <CardHeader className="text-center">
          <SearchIcon className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl md:text-3xl">Advanced Paper Search</CardTitle>
          <CardDescription>
            Find published papers by author name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-6">
            <Input
              type="text"
              placeholder="Enter author's name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-grow"
              disabled={isLoading}
            />
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? <LoadingSpinner size={16} /> : <SearchIcon className="mr-2 h-4 w-4" />}
              Search
            </Button>
          </div>

          {isLoading && (
            <div className="text-center py-10">
              <LoadingSpinner size={32} />
              <p className="mt-2 text-muted-foreground">Searching published papers...</p>
            </div>
          )}

          {!isLoading && hasSearched && searchResults.length === 0 && (
            <Alert variant="default" className="bg-secondary/50">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No Results Found</AlertTitle>
              <AlertDescription>
                No published papers found matching the author name &quot;{searchTerm}&quot;. Please try a different name or check your spelling.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && searchResults.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Authors</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchResults.map((paper) => (
                    <TableRow key={paper.id}>
                      <TableCell className="font-medium max-w-xs truncate">
                        <Link href={`/papers/${paper.id}`} className="hover:text-primary flex items-center">
                          <FileTextIcon className="mr-2 h-4 w-4 flex-shrink-0" /> {paper.title}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{paper.authors.join(', ')}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(paper.status)}>{paper.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="outline" size="sm" onClick={() => router.push(`/papers/${paper.id}`)} title="View Details">
                          <Eye className="h-4 w-4" />
                        </Button>
                         <Button variant="outline" size="sm" onClick={() => handleDownloadOriginalPaper(paper)} title="Download Original File">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDownloadMetadata(paper)} title="Download Details">
                          <FileTextIcon className="h-3 w-3 mr-1" /> Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
           {!isLoading && !hasSearched && (
            <Alert>
                <SearchIcon className="h-4 w-4" />
                <AlertTitle>Search Published Papers</AlertTitle>
                <AlertDescription>
                    Enter an author's name in the search bar above to find relevant published research papers.
                </AlertDescription>
            </Alert>
           )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SearchPapersPage() {
  return <SearchPapersContent />;
}
