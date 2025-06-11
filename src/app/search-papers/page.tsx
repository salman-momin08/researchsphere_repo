
"use client";

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Search as SearchIcon, FileText as FileTextIcon, Eye, AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import type { Paper, PaperStatus } from '@/types';
import { getPublishedPapers } from '@/lib/paper-service'; 
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useRouter } from 'next/navigation';
import { Progress } from "@/components/ui/progress";


function SearchPapersContent() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const [downloadingPaperId, setDownloadingPaperId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);


  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast({
        variant: "destructive",
        title: "Search Term Required",
        description: "Please enter an author's name to search.",
      });
      setSearchResults([]);
      setHasSearched(true);
      setSearchError(null);
      return;
    }
    setIsLoading(true);
    setHasSearched(true);
    setSearchResults([]);
    setSearchError(null);


    try {
      const publishedPapers = await getPublishedPapers();
      
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      // Client-side filtering for author name (case-insensitive, partial match on any author)
      const results = publishedPapers.filter(paper =>
        paper.authors.some(author => author.toLowerCase().includes(lowerCaseSearchTerm))
      );
      setSearchResults(results);
    } catch (error: any) {
      const errorMessage = error.message || "Could not retrieve or filter papers. Please try again.";
      setSearchError(errorMessage);
      toast({
        variant: "destructive",
        title: "Search Error",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadOriginalFile = async (paper: Paper) => {
    if (!paper.fileUrl || downloadingPaperId === paper.id) return;

    setDownloadingPaperId(paper.id);
    setDownloadProgress(0);
    toast({ title: "Download Starting", description: `Preparing to download ${paper.fileName || 'the paper'}...` });

    try {
      const response = await fetch(paper.fileUrl);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText} (${response.status})`);
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
      console.error("Download error in SearchPapersContent:", error);
      let userMessage = error.message || "Could not download the file.";
      if (error.message && error.message.includes("(401)")) {
        userMessage = "Download unauthorized (401). The file may be private or access is restricted on the server. Please check file permissions on Cloudinary.";
      }
      toast({ variant: "destructive", title: "Download Failed", description: userMessage });
      setDownloadProgress(0);
    } finally {
      setDownloadingPaperId(null);
      setTimeout(() => {
         if (downloadingPaperId === paper.id && !downloadingPaperId) setDownloadProgress(0);
      }, 2000);
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
            <Button onClick={handleSearch} disabled={isLoading || !!downloadingPaperId}>
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

          {!isLoading && searchError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Search Failed</AlertTitle>
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          )}

          {!isLoading && !searchError && hasSearched && searchResults.length === 0 && (
            <Alert variant="default" className="bg-secondary/50">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No Results Found</AlertTitle>
              <AlertDescription>
                No published papers found matching the author name &quot;{searchTerm}&quot;. Please try a different name or check your spelling.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !searchError && searchResults.length > 0 && (
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
                        <div className="flex flex-col items-end space-y-1">
                          <div className="flex space-x-1">
                            <Button variant="outline" size="sm" onClick={() => router.push(`/papers/${paper.id}`)} title="View Details" disabled={!!downloadingPaperId}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => handleDownloadOriginalFile(paper)} 
                                title="Download Original File"
                                disabled={downloadingPaperId === paper.id || !!downloadingPaperId && downloadingPaperId !== paper.id || !paper.fileUrl}
                            >
                              {downloadingPaperId === paper.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleDownloadMetadata(paper)} title="Download Details" disabled={!!downloadingPaperId}>
                              <FileTextIcon className="h-3 w-3 mr-1" /> Details
                            </Button>
                          </div>
                          {downloadingPaperId === paper.id && (
                            <div className="w-24 mt-0.5">
                                <Progress value={downloadProgress} className="h-1.5" />
                                <p className="text-xs text-muted-foreground text-center">{downloadProgress}%</p>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
           {!isLoading && !hasSearched && !searchError && (
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
  // This page is now public, so no ProtectedRoute needed here
  return <SearchPapersContent />;
}

