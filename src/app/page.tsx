
"use client";

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { CheckCircle, BarChart3, ShieldCheck, UploadCloud, Users, FileText, UserCheck, Edit } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

const features = [
  {
    icon: <UploadCloud className="h-8 w-8 text-primary" />,
    title: 'Easy Paper Submission',
    description: 'Upload your research papers in PDF or DOCX format with a simple and intuitive interface.',
  },
  {
    icon: <ShieldCheck className="h-8 w-8 text-primary" />,
    title: 'AI Plagiarism Detection',
    description: 'Get an instant plagiarism score and highlighted sections to ensure originality.',
  },
  {
    icon: <BarChart3 className="h-8 w-8 text-primary" />,
    title: 'AI Acceptance Probability',
    description: 'Receive an AI-driven probability score for your paper\'s acceptance, based on multiple quality factors.',
  },
  {
    icon: <Users className="h-8 w-8 text-primary" />,
    title: 'Comprehensive Dashboard',
    description: 'Manage all your submissions, track their status, and view feedback in one place.',
  },
];

const guidelines = [
  {
    id: "authors",
    title: "Author Guidelines",
    icon: <FileText className="h-6 w-6 text-primary mr-3" />,
    content: [
      "Ensure your paper is original and has not been published elsewhere.",
      "Follow the prescribed formatting guidelines for manuscript preparation (e.g., font, margins, citation style).",
      "Clearly state the research problem, methodology, results, and conclusions.",
      "Include all necessary figures, tables, and supplementary materials with appropriate captions and references.",
      "Disclose any conflicts of interest and funding sources.",
      "Adhere to ethical guidelines regarding research involving human or animal subjects.",
      "Submit your paper through the online portal before the specified deadline."
    ]
  },
  {
    id: "reviewers",
    title: "Reviewer Guidelines",
    icon: <UserCheck className="h-6 w-6 text-primary mr-3" />,
    content: [
      "Provide constructive, unbiased, and timely feedback to authors.",
      "Evaluate the paper based on its originality, significance, methodology, clarity, and relevance.",
      "Maintain confidentiality of the manuscript and review process.",
      "Identify any potential ethical concerns or instances of plagiarism.",
      "Clearly articulate your recommendations (accept, minor revision, major revision, reject) with supporting arguments.",
      "Declare any conflicts of interest that might affect your ability to provide an impartial review."
    ]
  },
  {
    id: "editors",
    title: "Editor Guidelines",
    icon: <Edit className="h-6 w-6 text-primary mr-3" />,
    content: [
      "Ensure a fair, timely, and confidential peer-review process.",
      "Select appropriate reviewers with relevant expertise and no conflicts of interest.",
      "Make editorial decisions based on the scientific merit of the paper, reviewer feedback, and alignment with the journal/conference scope.",
      "Communicate clearly and professionally with authors, reviewers, and other editorial board members.",
      "Uphold academic integrity and address any ethical issues that arise.",
      "Contribute to the strategic development and quality improvement of the publication venue."
    ]
  }
]

export default function HomePage() {
  const { user, setShowLoginModal } = useAuth();
  const router = useRouter();

  const handleSubmitPaperClick = () => {
    if (user) {
      router.push('/submit');
    } else {
      localStorage.setItem('redirectAfterLogin', '/submit'); // Set redirect path
      setShowLoginModal(true);
    }
  };

  return (
    <>
      {/* Hero Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight">
            Welcome to <span className="text-primary">ResearchSphere</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            The premier platform for students and researchers to upload, manage, and enhance their academic papers with cutting-edge AI evaluation tools.
          </p>
          <div className="space-x-4">
            <Button size="lg" onClick={handleSubmitPaperClick}>
              <UploadCloud className="mr-2 h-5 w-5" /> Submit Your Paper
            </Button>
            <Button size="lg" variant="outline" onClick={() => router.push('#features')}>
              Learn More
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 md:py-24">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            Platform <span className="text-primary">Features</span>
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <Card key={index} className="shadow-lg hover:shadow-xl transition-shadow duration-300">
                <CardHeader className="items-center text-center">
                  {feature.icon}
                  <CardTitle className="mt-4 text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-center">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-16 md:py-24 bg-secondary">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            How It <span className="text-primary">Works</span>
          </h2>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="p-6">
              <div className="bg-primary text-primary-foreground rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">1</div>
              <h3 className="text-xl font-semibold mb-2">Upload Your Paper</h3>
              <p className="text-muted-foreground">Easily submit your research document through our secure portal.</p>
            </div>
            <div className="p-6">
              <div className="bg-primary text-primary-foreground rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">2</div>
              <h3 className="text-xl font-semibold mb-2">AI Evaluation</h3>
              <p className="text-muted-foreground">Our AI tools analyze for plagiarism and predict acceptance chances.</p>
            </div>
            <div className="p-6">
              <div className="bg-primary text-primary-foreground rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">3</div>
              <h3 className="text-xl font-semibold mb-2">Review & Submit</h3>
              <p className="text-muted-foreground">Review AI feedback, make improvements, and finalize your submission.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Guidelines Section */}
      <section id="guidelines" className="py-16 md:py-24">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            Platform <span className="text-primary">Guidelines</span>
          </h2>
          <div className="max-w-3xl mx-auto">
            <Accordion type="single" collapsible className="w-full">
              {guidelines.map((guideline) => (
                <AccordionItem value={guideline.id} key={guideline.id}>
                  <AccordionTrigger className="text-xl font-semibold hover:no-underline">
                    <div className="flex items-center">
                      {guideline.icon}
                      {guideline.title}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
                      {guideline.content.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Call to Action Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container mx-auto text-center">
          <Image 
            src="https://picsum.photos/1200/400?random=1" 
            alt="Academic research collaboration" 
            width={1200} height={400} 
            className="rounded-lg shadow-md mb-12 mx-auto" 
            data-ai-hint="research collaboration" 
          />
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to Elevate Your Research?
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            Join ResearchSphere today and take the first step towards publishing your impactful work.
          </p>
          <Button size="lg" onClick={handleSubmitPaperClick}>
            Get Started Now
          </Button>
        </div>
      </section>
    </>
  );
}
