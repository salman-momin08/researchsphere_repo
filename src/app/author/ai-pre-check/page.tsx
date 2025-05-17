
"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { UploadCloud, Sparkles, Loader2, Download, AlertTriangle, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import PlagiarismReport from '@/components/papers/PlagiarismReport';
import AcceptanceProbabilityReport from '@/components/papers/AcceptanceProbabilityReport';
import { plagiarismCheck, PlagiarismCheckOutput } from '@/ai/flows/plagiarism-check';
import { acceptanceProbability, AcceptanceProbabilityOutput } from '@/ai/flows/acceptance-probability';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

function AiPreCheckContent() {
  const [title, setTitle] = useState('');
  const [abstract, setAbstract] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismCheckOutput | null>(null);
  const [acceptanceResult, setAcceptanceResult] = useState<AcceptanceProbabilityOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) { // 10MB limit
        toast({ variant: "destructive", title: "File Too Large", description: "Please upload a file smaller than 10MB." });
        setFile(null);
        setFileName(null);
        event.target.value = ""; 
        return;
      }
      if (!["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"].includes(selectedFile.type)) {
        toast({ variant: "destructive", title: "Invalid File Type", description: "Only PDF, DOCX, or TXT files are allowed for pre-check." });
        setFile(null);
        setFileName(null);
        event.target.value = "";
        return;
      }
      setFile(selectedFile);
      setFileName(selectedFile.name);
    } else {
      setFile(null);
      setFileName(null);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !abstract.trim()) {
      toast({ variant: "destructive", title: "Missing Information", description: "Please provide both title and abstract for analysis." });
      return;
    }
    if (file) {
        // For now, we will still primarily use title and abstract for AI analysis
        // The file is "uploaded" but the current AI flows are text-based
        toast({ title: "File Noted", description: `File "${fileName}" has been noted. Analysis will be based on title and abstract. Full file analysis would require backend processing.`, duration: 5000 });
    }

    setIsLoading(true);
    setError(null);
    setPlagiarismResult(null);
    setAcceptanceResult(null);

    const aiInputText = `${title}\n\n${abstract}`;

    try {
      const [plagiarism, acceptance] = await Promise.all([
        plagiarismCheck({ documentUrl: "mock://document-from-text", documentText: aiInputText, fileName: fileName || "text_input" }),
        acceptanceProbability({ paperText: aiInputText })
      ]);
      setPlagiarismResult(plagiarism);
      setAcceptanceResult(acceptance);
      toast({ title: "AI Pre-Check Complete", description: "Results are displayed below." });
    } catch (err: any) {
      const errorMessage = err.message || "An error occurred during AI analysis.";
      console.error("AI Pre-Check Error:", err);
      setError(errorMessage);
      toast({ variant: "destructive", title: "AI Analysis Failed", description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadFeedback = () => {
    if (!plagiarismResult && !acceptanceResult) {
      toast({ variant: "destructive", title: "No Feedback", description: "No AI feedback available to download." });
      return;
    }
    let feedbackContent = `AI Pre-Check Feedback for Paper: ${title || 'Untitled'}\n\n`;
    if (plagiarismResult) {
      feedbackContent += `--- Plagiarism Report ---\n`;
      feedbackContent += `Score: ${(plagiarismResult.plagiarismScore * 100).toFixed(1)}%\n`;
      if (plagiarismResult.highlightedSections && plagiarismResult.highlightedSections.length > 0) {
        feedbackContent += `Highlighted Sections:\n${plagiarismResult.highlightedSections.map(s => `- "${s}"`).join('\n')}\n`;
      } else {
        feedbackContent += `No specific sections highlighted for plagiarism concerns.\n`;
      }
      feedbackContent += `\n`;
    }
    if (acceptanceResult) {
      feedbackContent += `--- Acceptance Probability Report ---\n`;
      feedbackContent += `Score: ${(acceptanceResult.probabilityScore * 100).toFixed(1)}%\n`;
      feedbackContent += `Reasoning: ${acceptanceResult.reasoning}\n`;
    }

    const blob = new Blob([feedbackContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'untitled_paper').replace(/\s+/g, '_')}_AI_Feedback.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Feedback Downloaded", description: "AI feedback report has been downloaded." });
  };

  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="w-full max-w-2xl mx-auto shadow-xl">
        <CardHeader className="text-center">
          <Sparkles className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl md:text-3xl">AI Pre-Submission Check</CardTitle>
          <CardDescription>
            Get AI-powered insights on plagiarism and acceptance probability for your paper&apos;s title and abstract before formal submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Analysis Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div>
            <Label htmlFor="title">Paper Title *</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter your paper title" className="mt-1" disabled={isLoading} />
          </div>
          <div>
            <Label htmlFor="abstract">Abstract *</Label>
            <Textarea id="abstract" value={abstract} onChange={(e) => setAbstract(e.target.value)} placeholder="Paste your paper abstract here (min 50 characters)" rows={8} className="mt-1" disabled={isLoading} />
          </div>
           <div>
            <Label htmlFor="file-upload-ai">Upload Paper (Optional - PDF, DOCX, TXT, max 10MB)</Label>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md border-input hover:border-primary transition-colors">
              <div className="space-y-1 text-center">
                <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
                <div className="flex text-sm text-muted-foreground">
                  <label
                    htmlFor="file-upload-ai"
                    className="relative cursor-pointer rounded-md font-medium text-primary hover:text-primary/80 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-ring"
                  >
                    <span>Upload a file</span>
                    <input id="file-upload-ai" type="file" className="sr-only"
                          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                          onChange={handleFileChange}
                          disabled={isLoading}
                    />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                {fileName ? (
                  <p className="text-xs text-foreground">{fileName}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">PDF, DOCX, TXT up to 10MB</p>
                )}
              </div>
            </div>
          </div>
           <Alert variant="default">
                <Info className="h-4 w-4" />
                <AlertTitle>Note on File Upload</AlertTitle>
                <AlertDescription>
                    Currently, the AI analysis primarily focuses on the provided title and abstract. Uploading the full paper file is optional and serves for context; full file analysis features may be expanded in the future. The plagiarism check will use the title & abstract.
                </AlertDescription>
            </Alert>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-2">
          <Button onClick={handleSubmit} className="w-full sm:w-auto" disabled={isLoading || !title.trim() || !abstract.trim()}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {isLoading ? "Analyzing..." : "Run AI Pre-Check"}
          </Button>
          {(plagiarismResult || acceptanceResult) && (
            <Button variant="outline" onClick={handleDownloadFeedback} className="w-full sm:w-auto" disabled={isLoading}>
              <Download className="mr-2 h-4 w-4" /> Download Feedback
            </Button>
          )}
        </CardFooter>
      </Card>

      {(plagiarismResult || acceptanceResult) && !isLoading && (
        <div className="mt-8 space-y-6">
          {plagiarismResult && <PlagiarismReport result={plagiarismResult} />}
          {acceptanceResult && <AcceptanceProbabilityReport result={acceptanceResult} />}
        </div>
      )}
    </div>
  );
}


export default function AiPreCheckPage() {
    return (
        <ProtectedRoute>
            <AiPreCheckContent />
        </ProtectedRoute>
    )
}
