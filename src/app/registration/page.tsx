
"use client"; // Required for useAuth hook

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, FileText, Award, ShieldCheck, Building, Users, Landmark, Copy } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth"; // Import useAuth
import { toast } from "@/hooks/use-toast";

interface SubmissionOption {
  name: string;
  price: string;
  priceFrequency: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  icon: React.ReactNode;
  isSubscription?: boolean;
  bankDetails?: {
    accountName: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    upiId?: string;
  };
}

const submissionOptions: SubmissionOption[] = [
  {
    name: "Standard Paper Submission",
    price: "₹499",
    priceFrequency: "per paper",
    description: "Ideal for individual researchers and students for single paper submissions.",
    features: [
      "AI Plagiarism Check (based on abstract)",
      "AI Acceptance Probability Score (based on abstract)",
      "Standard Review Process",
      "Author Dashboard Access",
      "Secure Online Payment",
    ],
    cta: "Submit Your Paper",
    href: "/submit",
    icon: <FileText className="h-8 w-8 mb-2 text-primary" />
  },
  {
    name: "Annual Subscription",
    price: "₹4999",
    priceFrequency: "per year",
    description: "Best for active researchers with multiple submissions and full platform access.",
    features: [
      "Up to 15 Paper Submissions Annually",
      "All Standard Submission Features",
      "Priority Support Channel",
      "Early Access to New Features",
      "Enhanced AI Analysis Credits",
    ],
    cta: "Subscribe Now (Details Below)",
    href: "#subscription-details", // Link to details section
    icon: <Award className="h-8 w-8 mb-2 text-primary" />,
    isSubscription: true,
    bankDetails: {
      accountName: "ResearchSphere Subscriptions",
      accountNumber: "123456789012",
      ifscCode: "RSBK0001234",
      bankName: "Global Scholarly Bank",
      upiId: "researchsphere@gsbupi"
    }
  },
  {
    name: "Institutional Membership",
    price: "Contact Us",
    priceFrequency: "for annual plans & benefits",
    description: "Best for universities and research institutions seeking bulk submissions and enhanced features.",
    features: [
      "All Standard Submission Features",
      "Customizable Submission Limits",
      "Dedicated Support Channel & Training",
      "Usage Analytics & Reporting",
      "Option for Co-branded Portal",
    ],
    cta: "Inquire for Details",
    href: "/contact-us",
    icon: <Building className="h-8 w-8 mb-2 text-primary" />
  },
];

const benefits = [
    {
        icon: <FileText className="h-10 w-10 text-primary mb-4" />,
        title: "Streamlined Submission",
        description: "Our intuitive platform makes submitting your research papers quick and easy. Focus on your research, we'll handle the rest.",
    },
    {
        icon: <ShieldCheck className="h-10 w-10 text-primary mb-4" />,
        title: "AI-Powered Insights",
        description: "Leverage our advanced AI tools for plagiarism detection and acceptance probability analysis to enhance your paper's quality (based on abstract).",
    },
    {
        icon: <Award className="h-10 w-10 text-primary mb-4" />,
        title: "Quality Assurance",
        description: "Benefit from a structured review process designed to ensure high academic standards and provide constructive feedback.",
    },
]

export default function RegistrationPricingPage() {
  const { user } = useAuth(); // Get user state

  const handleCopyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied to Clipboard", description: `${fieldName} copied successfully.` });
    }).catch(err => {
      toast({ variant: "destructive", title: "Copy Failed", description: `Could not copy ${fieldName}.` });
      console.error('Failed to copy text: ', err);
    });
  };


  return (
    <div className="bg-secondary">
      <div className="container mx-auto py-12 md:py-20 px-4 sm:px-6 lg:px-8">
        <header className="text-center mb-12 md:mb-16">
          <Users className="mx-auto h-16 w-16 text-primary mb-4" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Join ResearchSphere
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Submit your research, get AI-powered feedback, and manage your publications efficiently. Explore our submission options below.
          </p>
        </header>

        <section className="mb-16 md:mb-24">
             <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                Why <span className="text-primary">ResearchSphere</span>?
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
                {benefits.map((benefit, index) => (
                     <Card key={index} className="shadow-lg text-center p-4 hover:shadow-xl transition-shadow duration-300">
                        <CardHeader>
                            {benefit.icon}
                            <CardTitle>{benefit.title}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground">{benefit.description}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </section>

        <section>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
            Submission <span className="text-primary">Options</span>
          </h2>
          <div className="grid sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {submissionOptions.map((option) => (
              <Card key={option.name} className="flex flex-col shadow-xl hover:shadow-2xl transition-shadow duration-300">
                <CardHeader className="pb-4 items-center text-center">
                  {option.icon}
                  <CardTitle className="text-2xl text-primary">{option.name}</CardTitle>
                  <div className="flex items-baseline justify-center">
                    <span className="text-4xl font-extrabold tracking-tight">{option.price}</span>
                    {option.price !== "Contact Us" && <span className="ml-1 text-xl font-semibold text-muted-foreground">{option.priceFrequency}</span>}
                  </div>
                   <CardDescription className="pt-2 h-12">{option.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                  <ul role="list" className="space-y-3">
                    {option.features.map((feature) => (
                      <li key={feature} className="flex items-center">
                        <CheckCircle className="h-5 w-5 text-green-500 mr-2 flex-shrink-0" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                   {(option.name === "Institutional Membership" || option.isSubscription) && (
                    <p className="text-sm text-muted-foreground mt-4">
                      {option.isSubscription 
                        ? "To activate your annual subscription, please make a payment to the bank account details provided below. Email your payment confirmation to subscriptions@researchsphere.com."
                        : "For institutional plans and payment details, please contact our support team."}
                    </p>
                  )}
                </CardContent>
                <div className="p-6 pt-4 mt-auto">
                  <Link href={option.href} passHref>
                    <Button className="w-full" size="lg" onClick={option.isSubscription ? (e) => {e.preventDefault(); document.getElementById('subscription-details')?.scrollIntoView({behavior: 'smooth'});} : undefined}>
                      {option.cta}
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {submissionOptions.find(opt => opt.isSubscription && opt.bankDetails) && (
          <section id="subscription-details" className="mt-16 md:mt-24">
            <Card className="max-w-2xl mx-auto shadow-lg">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center">
                  <Landmark className="mr-3 h-6 w-6 text-primary" />
                  Annual Subscription Payment Details
                </CardTitle>
                <CardDescription>
                  To activate your annual subscription, please transfer the subscription fee to the following bank account and notify us.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(submissionOptions.find(opt => opt.isSubscription)!.bankDetails!).map(([key, value]) => {
                  if (!value) return null;
                  const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                  return (
                    <div key={key} className="flex justify-between items-center p-2 border-b last:border-b-0">
                      <span className="font-medium text-muted-foreground">{displayKey}:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">{value}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopyToClipboard(value, displayKey)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <p className="text-sm text-muted-foreground pt-3">
                  After payment, please email your transaction receipt/confirmation to <strong className="text-primary">subscriptions@researchsphere.com</strong> along with your registered username or email to activate your subscription.
                </p>
              </CardContent>
            </Card>
          </section>
        )}

        {!user && (
          <section className="mt-16 md:mt-24 text-center">
              <h2 className="text-2xl md:text-3xl font-bold mb-4">Ready to Begin?</h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                  Create your free ResearchSphere account today to explore the platform. Submission fees apply when you are ready to submit your paper.
              </p>
              <Link href="/signup">
                  <Button size="lg" variant="default">Create Your Account</Button>
              </Link>
          </section>
        )}
      </div>
    </div>
  );
}

