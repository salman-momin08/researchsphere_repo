
"use client"; // Add this to use client-side hooks

import Link from 'next/link';
import { BookOpenText } from 'lucide-react';
import { usePathname } from 'next/navigation'; // Import usePathname
import { cn } from '@/lib/utils'; // Import cn for conditional classes

export default function Footer() {
  const pathname = usePathname();
  const isAdminPage = pathname.startsWith('/admin');

  return (
    <footer className={cn(
      "border-t bg-secondary/50",
      isAdminPage && "md:ml-64" // Add left margin on medium screens and up if it's an admin page
    )}>
      <div className="container px-6 py-8 flex flex-col md:flex-row justify-between items-center">
        <div className="flex items-center gap-2 mb-4 md:mb-0">
          <BookOpenText className="h-5 w-5 text-primary" />
          <span className="text-md font-semibold">ResearchSphere</span>
        </div>
        <p className="text-sm text-muted-foreground text-center md:text-left">
          &copy; {new Date().getFullYear()} ResearchSphere. All rights reserved.
        </p>
        <div className="flex space-x-4 mt-4 md:mt-0">
          <Link href="/terms" className="text-sm text-muted-foreground hover:text-primary">
            Terms of Service
          </Link>
          <Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}

// Create dummy pages for terms and privacy to avoid 404s for links in footer
// These can remain Server Components if they don't use client hooks
export function TermsPage() {
  return (
    <div className="container py-12 px-4 md:px-6">
      <h1 className="text-3xl font-bold mb-4">Terms of Service</h1>
      <p>Placeholder for Terms of Service content. Please replace this with your actual terms.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">1. Acceptance of Terms</h2>
      <p>By accessing or using ResearchSphere, you agree to be bound by these Terms of Service.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">2. User Conduct</h2>
      <p>You are responsible for all content you submit and your conduct on the platform. You agree not to submit any material that is unlawful, defamatory, or infringing on intellectual property rights.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">3. Intellectual Property</h2>
      <p>You retain ownership of the intellectual property rights in your submitted papers. By submitting, you grant ResearchSphere a license to host, display, and distribute your work as part of the platform's services.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">4. Disclaimers</h2>
      <p>ResearchSphere provides AI-powered tools for analysis. These tools are for informational purposes and do not guarantee publication or academic success. The platform is provided &quot;as is&quot; without warranties of any kind.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">5. Limitation of Liability</h2>
      <p>ResearchSphere will not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the platform.</p>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div className="container py-12 px-4 md:px-6">
      <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
      <p>Placeholder for Privacy Policy content. Please replace this with your actual privacy policy.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">1. Information We Collect</h2>
      <p>We collect information you provide during registration (name, email, etc.) and when you submit papers (title, abstract, file content for analysis).</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">2. How We Use Your Information</h2>
      <p>Your information is used to provide and improve our services, including user authentication, paper submission processing, AI analysis (plagiarism and acceptance probability), and communication.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">3. Data Sharing</h2>
      <p>We do not sell your personal data. We may share paper content with AI service providers for analysis purposes under strict confidentiality agreements. Aggregated, anonymized data may be used for research and platform improvement.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">4. Data Security</h2>
      <p>We implement reasonable security measures to protect your information, but no system is completely secure.</p>
      <h2 className="text-2xl font-semibold mt-6 mb-2">5. Your Rights</h2>
      <p>You may have rights to access, correct, or delete your personal information. Please contact us for such requests.</p>
    </div>
  );
}
