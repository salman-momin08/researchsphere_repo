
"use client"; // Added "use client" as toast is used here

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, FileCode2, StickyNote } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast"; // Import useToast

interface Template {
  id: string;
  title: string;
  description: string;
  fileName: string;
  fileType: "Word" | "LaTeX" | "PDF" | "Text";
  icon: React.ReactNode;
  mockContent: string; // Content for the mock download
  dataAiHint: string;
}

const templates: Template[] = [
  {
    id: "manuscript-word",
    title: "Manuscript Template (Word)",
    description: "Standard manuscript format for submissions in Microsoft Word (.docx). Includes typical sections and styling.",
    fileName: "ResearchSphere_Manuscript_Template.txt", // Changed to .txt for mock download
    fileType: "Word",
    icon: <FileText className="h-6 w-6 text-primary" />,
    mockContent: "This is a mock Microsoft Word manuscript template for ResearchSphere. Please format your paper according to standard academic guidelines.",
    dataAiHint: "document template"
  },
  {
    id: "manuscript-latex",
    title: "Manuscript Template (LaTeX)",
    description: "A LaTeX template for authors who prefer this typesetting system. Includes common packages and structure.",
    fileName: "ResearchSphere_LaTeX_Template_Instructions.txt", // Changed to .txt
    fileType: "LaTeX",
    icon: <FileCode2 className="h-6 w-6 text-primary" />,
    mockContent: "This is a mock LaTeX template guide for ResearchSphere. Ensure you have a LaTeX distribution installed. The typical package includes a .tex file, a .bib file for references, and potentially a class or style file.",
    dataAiHint: "code template"
  },
  {
    id: "cover-letter",
    title: "Cover Letter Sample",
    description: "A sample cover letter to guide authors when submitting their manuscripts.",
    fileName: "ResearchSphere_Cover_Letter_Sample.txt", // Changed to .txt
    fileType: "PDF", // Display type can remain PDF, download is mock
    icon: <StickyNote className="h-6 w-6 text-primary" />,
    mockContent: "Dear Editor,\n\nPlease find enclosed our manuscript titled '[Your Paper Title]' for consideration for publication in [Journal/Conference Name].\n\n[Briefly state the main findings and significance of your work.]\n\nThank you for your time and consideration.\n\nSincerely,\n[Your Name]",
    dataAiHint: "letter template"
  },
  {
    id: "reviewer-report",
    title: "Reviewer Report Form",
    description: "Template for reviewers to structure their feedback and recommendations.",
    fileName: "ResearchSphere_Reviewer_Report_Form.txt", // Changed to .txt
    fileType: "PDF", // Display type can remain PDF
    icon: <FileText className="h-6 w-6 text-primary" />,
    mockContent: "Reviewer Report Form\n\nPaper Title: [Paper Title]\nManuscript ID: [Manuscript ID]\n\nComments to Author:\n\nConfidential Comments to Editor:\n\nRecommendation: (Accept / Minor Revision / Major Revision / Reject)",
    dataAiHint: "report form"
  },
];

export default function SampleTemplatesPage() {
  const { toast } = useToast();

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
    toast({ title: "Download Started", description: `${filename} is being downloaded.` });
  };

  return (
    <div className="bg-secondary">
      <div className="container py-12 md:py-20">
        <header className="text-center mb-12 md:mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Sample <span className="text-primary">Templates</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Download our official templates to help you prepare your manuscripts and other related documents according to ResearchSphere guidelines.
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {templates.map((template) => (
            <Card key={template.id} className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
              <CardHeader>
                <div className="flex items-start gap-4">
                  {template.icon}
                  <div>
                    <CardTitle className="text-xl">{template.title}</CardTitle>
                    <CardDescription className="mt-1 text-sm">Type: {template.fileType} | File: {template.fileName}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-grow">
                <p className="text-sm text-muted-foreground">
                  {template.description}
                </p>
              </CardContent>
              <div className="p-6 pt-4">
                <Button 
                  className="w-full" 
                  size="lg" 
                  onClick={() => triggerTextFileDownload(template.mockContent, template.fileName)}
                  aria-label={`Download ${template.title}`}
                  data-ai-hint={template.dataAiHint}
                >
                  <Download className="mr-2 h-5 w-5" />
                  Download Template
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <section className="mt-16 md:mt-24 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">Need Assistance?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            If you have any questions about using these templates or require further assistance, please do not hesitate to contact our support team.
          </p>
          <Link href="/contact-us">
            <Button size="lg" variant="outline">Contact Support</Button>
          </Link>
        </section>
      </div>
    </div>
  );
}
