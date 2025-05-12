"use client";

import type { PlagiarismCheckOutput } from '@/ai/flows/plagiarism-check';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

interface PlagiarismReportProps {
  result: PlagiarismCheckOutput | null;
}

export default function PlagiarismReport({ result }: PlagiarismReportProps) {
  if (!result) {
    return null;
  }

  const scorePercentage = result.plagiarismScore * 100;
  const scoreColor = scorePercentage > 20 ? "text-destructive" : (scorePercentage > 10 ? "text-yellow-500" : "text-green-500");

  return (
    <Card className="mt-6 border-primary/50">
      <CardHeader>
        <div className="flex items-center gap-2">
          {scorePercentage > 15 ? <AlertTriangle className={`h-6 w-6 ${scoreColor}`} /> : <ShieldCheck className={`h-6 w-6 ${scoreColor}`} />}
          <CardTitle>Plagiarism Check Report</CardTitle>
        </div>
        <CardDescription>AI-powered analysis of potential plagiarism.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium text-foreground">Plagiarism Score</span>
            <span className={`text-lg font-bold ${scoreColor}`}>{scorePercentage.toFixed(1)}%</span>
          </div>
          <Progress value={scorePercentage} className={
              scorePercentage > 20 ? "[&>div]:bg-destructive" : (scorePercentage > 10 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500")
            } />
        </div>

        {result.highlightedSections && result.highlightedSections.length > 0 && (
          <div>
            <h4 className="font-semibold mb-2 text-foreground">Potentially Plagiarized Sections:</h4>
            <ul className="space-y-2 list-disc list-inside bg-secondary/50 p-3 rounded-md">
              {result.highlightedSections.map((section, index) => (
                <li key={index} className="text-sm text-muted-foreground italic">
                  &quot;...{section}...&quot;
                </li>
              ))}
            </ul>
          </div>
        )}
        {(!result.highlightedSections || result.highlightedSections.length === 0) && scorePercentage <=15 && (
          <p className="text-sm text-green-600">No significant plagiarism concerns detected.</p>
        )}
         {(!result.highlightedSections || result.highlightedSections.length === 0) && scorePercentage > 15 && (
          <p className="text-sm text-yellow-600">General similarity detected but no specific sections were highlighted by the AI. Manual review recommended.</p>
        )}
      </CardContent>
    </Card>
  );
}
