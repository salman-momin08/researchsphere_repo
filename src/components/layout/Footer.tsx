"use client";

import Link from 'next/link';
import { BookOpenText } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t bg-secondary/50">
      <div className="container py-8 flex flex-col md:flex-row justify-between items-center">
        <div className="flex items-center gap-2 mb-4 md:mb-0">
          <BookOpenText className="h-5 w-5 text-primary" />
          <span className="text-md font-semibold">ScholarSubmit</span>
        </div>
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} ScholarSubmit. All rights reserved.
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
export function TermsPage() {
  return (
    <div className="container py-12">
      <h1 className="text-3xl font-bold mb-4">Terms of Service</h1>
      <p>Placeholder for Terms of Service content.</p>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div className="container py-12">
      <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
      <p>Placeholder for Privacy Policy content.</p>
    </div>
  );
}
