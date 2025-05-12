"use client";

import type { AcceptanceProbabilityOutput } from '@/ai/flows/acceptance-probability';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';

interface AcceptanceProbabilityReportProps {
  result: AcceptanceProbabilityOutput | null;
}

export default function AcceptanceProbabilityReport({ result }: AcceptanceProbabilityReportProps) {
  if (!result) {
    return null;
  }

  const probabilityPercentage = result.probabilityScore * 100;
  const probabilityColor = probabilityPercentage >= 70 ? "text-green-500" : (probabilityPercentage >= 40 ? "text-yellow-500" : "text-destructive");

  return (
    <Card className="mt-6 border-primary/50">
      <CardHeader>
        <div className="flex items-center gap-2">
          {probabilityPercentage >= 50 ? <TrendingUp className={`h-6 w-6 ${probabilityColor}`} /> : <TrendingDown className={`h-6 w-6 ${probabilityColor}`} />}
          <CardTitle>Acceptance Probability Report</CardTitle>
        </div>
        <CardDescription>AI-driven estimation of paper acceptance likelihood.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium text-foreground">Estimated Acceptance Probability</span>
            <span className={`text-lg font-bold ${probabilityColor}`}>{probabilityPercentage.toFixed(1)}%</span>
          </div>
          <Progress value={probabilityPercentage} className={
             probabilityPercentage >= 70 ? "[&>div]:bg-green-500" : (probabilityPercentage >= 40 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-destructive")
          } />
        </div>

        {result.reasoning && (
          <div>
            <h4 className="font-semibold mb-2 text-foreground">AI Reasoning:</h4>
            <p className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-md">{result.reasoning}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
