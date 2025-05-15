
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, FileText, Award, ShieldCheck, Building, Users } from "lucide-react";
import Link from "next/link";

const submissionOptions = [
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
    name: "Institutional Membership",
    price: "Contact Us",
    priceFrequency: "for annual plans & benefits",
    description: "Best for universities and research institutions seeking bulk submissions and enhanced features.",
    features: [
      "All Standard Submission Features",
      "Discounted or Bundled Submission Fees",
      "Dedicated Support Channel",
      "Usage Analytics & Reporting (coming soon)",
      "Option for Co-branded Portal (coming soon)",
    ],
    cta: "Inquire for Details",
    href: "/contact-us", // Direct to contact page for institutional inquiries
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
  return (
    <div className="bg-secondary">
      <div className="container py-12 md:py-20">
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
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
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
                   {option.name === "Institutional Membership" && (
                    <p className="text-sm text-muted-foreground mt-4">
                      For institutional plans and payment details, please contact our support team.
                    </p>
                  )}
                </CardContent>
                <div className="p-6 pt-4 mt-auto">
                  <Link href={option.href} passHref>
                    <Button className="w-full" size="lg">
                      {option.cta}
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-16 md:mt-24 text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">Ready to Begin?</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                Create your free ResearchSphere account today to explore the platform. Submission fees apply when you are ready to submit your paper.
            </p>
            <Link href="/signup">
                <Button size="lg" variant="default">Create Your Account</Button>
            </Link>
        </section>
      </div>
    </div>
  );
}
