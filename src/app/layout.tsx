
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/auth-context';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Toaster } from "@/components/ui/toaster";
import React, { Suspense } from 'react';
import ClientSideComponents from '@/components/layout/ClientSideComponents';
import GlobalErrorBoundary from '@/components/shared/GlobalErrorBoundary';
import LoadingSpinner from '@/components/shared/LoadingSpinner'; // Added for Suspense fallback

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'ResearchSphere - Research Paper Publishing',
  description: 'Upload, manage, and evaluate research papers with AI-powered tools.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <GlobalErrorBoundary>
          <Suspense fallback={<div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif', fontSize: '1.2rem'}}><LoadingSpinner size={48} /><p className="ml-3">Loading application...</p></div>}>
            <AuthProvider>
              <div className="antialiased flex flex-col min-h-screen">
                <Header />
                <main className="flex-grow">{children}</main>
                <ClientSideComponents />
                <Footer />
                <Toaster />
              </div>
            </AuthProvider>
          </Suspense>
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
