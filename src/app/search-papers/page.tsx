
"use client";

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Search as SearchIcon, FileText, ExternalLink, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import type { Paper } from '@/types';
import { allMockPapers } from '@/lib/mock-data';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
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

  console.log("SearchPapersContent component mounted or re-rendered"); // Added console.log

  const handleSearch = () => {
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
    // Simulate API call delay
    setTimeout(() => {
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      const results = allMockPapers.filter(paper =>
        paper.authors.some(author => author.toLowerCase().includes(lowerCaseSearchTerm))
      );
      setSearchResults(results);
      setIsLoading(false);
    }, 700);
  };

  const handleDownload = (paper: Paper) => {
    // Mock download: create a text file with paper details
    const fileContent = `
Paper Title: ${paper.title}
Authors: ${paper.authors.join(', ')}
Abstract: ${paper.abstract}
Keywords: ${paper.keywords.join(', ')}
Status: ${paper.status}
Upload Date: ${new Date(paper.uploadDate).toLocaleDateString()}
File Name: ${paper.fileName || 'N/A'}
Mock File URL: ${paper.fileUrl || 'N/A'}

This is a mock downloaded file from ResearchSphere.
In a real application, this would be the actual paper document.
    `;
    const blob = new Blob([fileContent.trim()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = paper.title.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
    a.download = `${safeTitle}_Details.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "Mock Download Started",
      description: `Details for "${paper.title}" are being downloaded.`,
    });
  };
  
  const getStatusBadgeVariant = (status: Paper['status']) => {
    switch (status) {
      case 'Accepted': case 'Published': return 'default';
      case 'Rejected': return 'destructive';
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
            Find papers by author name. Results include links to view details and mock download options.
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
              <p className="mt-2 text-muted-foreground">Searching for papers...</p>
            </div>
          )}

          {!isLoading && hasSearched && searchResults.length === 0 && (
            <Alert variant="default" className="bg-secondary/50">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No Results Found</AlertTitle>
              <AlertDescription>
                No papers found matching the author name &quot;{searchTerm}&quot;. Please try a different name or check your spelling.
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
                          <FileText className="mr-2 h-4 w-4 flex-shrink-0" /> {paper.title}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{paper.authors.join(', ')}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(paper.status)}>{paper.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => router.push(`/papers/${paper.id}`)} title="View Details">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDownload(paper)} title="Download Paper Details (Mock)">
                          <Download className="h-4 w-4" />
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
                <AlertTitle>Search for Papers</AlertTitle>
                <AlertDescription>
                    Enter an author's name in the search bar above to find relevant research papers.
                </AlertDescription>
            </Alert>
           )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SearchPapersPage() {
  return (
    <ProtectedRoute>
      <SearchPapersContent />
    </ProtectedRoute>
  );
}

