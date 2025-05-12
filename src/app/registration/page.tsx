
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, FileText, Award, ShieldCheck } from "lucide-react";
import Link from "next/link";

const pricingTiers = [
  {
    name: "Standard Submission",
    price: "$50",
    priceFrequency: "per paper",
    description: "Ideal for individual researchers and students.",
    features: [
      "AI Plagiarism Check",
      "AI Acceptance Probability Score",
      "Standard Review Process",
      "Author Dashboard Access",
    ],
    cta: "Submit Your Paper",
    href: "/submit",
  },
  {
    name: "Institutional Package",
    price: "Contact Us",
    priceFrequency: "for custom pricing",
    description: "Best for universities and research institutions.",
    features: [
      "All Standard Features",
      "Bulk Submission Discounts",
      "Dedicated Support Channel",
      "Custom Reporting Options",
    ],
    cta: "Get in Touch",
    href: "mailto:support@researchsphere.com", // Example, replace with actual contact
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
        description: "Leverage our advanced AI tools for plagiarism detection and acceptance probability analysis to enhance your paper's quality.",
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
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Registration & Pricing
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Join ResearchSphere to submit your papers, get AI-powered feedback, and manage your publications efficiently.
          </p>
        </header>

        <section className="mb-16 md:mb-24">
             <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                Why <span className="text-primary">Register</span> with Us?
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
                {benefits.map((benefit, index) => (
                     <Card key={index} className="shadow-lg text-center">
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
            Our <span className="text-primary">Pricing</span> Plans
          </h2>
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {pricingTiers.map((tier) => (
              <Card key={tier.name} className="flex flex-col shadow-xl hover:shadow-2xl transition-shadow duration-300">
                <CardHeader className="pb-4">
                  <CardTitle className="text-2xl text-primary">{tier.name}</CardTitle>
                  <div className="flex items-baseline">
                    <span className="text-4xl font-extrabold tracking-tight">{tier.price}</span>
                    {tier.price !== "Contact Us" && <span className="ml-1 text-xl font-semibold text-muted-foreground">{tier.priceFrequency}</span>}
                  </div>
                   <CardDescription className="pt-2">{tier.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                  <ul role="list" className="space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-center">
                        <CheckCircle className="h-5 w-5 text-green-500 mr-2 flex-shrink-0" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <div className="p-6 pt-4">
                  <Link href={tier.href} passHref>
                    <Button className="w-full" size="lg">
                      {tier.cta}
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-16 md:mt-24 text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">Ready to Get Started?</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                Create your free account today to explore the platform. Submission fees apply only when you&apos;re ready to submit your paper.
            </p>
            <Link href="/signup">
                <Button size="lg" variant="default">Create Your Account</Button>
            </Link>
        </section>
      </div>
    </div>
  );
}
