
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/auth-context';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Toaster } from "@/components/ui/toaster";
import LoginModal from '@/components/auth/LoginModal';
import React, { Suspense } from 'react'; // Import Suspense and React
import LoadingSpinner from '@/components/shared/LoadingSpinner'; // Assuming you have a loading spinner

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'ResearchSphere - Academic Paper Publishing',
  description: 'Upload, manage, and evaluate research papers with AI-powered tools.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased flex flex-col min-h-screen">
        <AuthProvider>
          <Header />
          <Suspense fallback={<div className="flex-grow flex items-center justify-center"><LoadingSpinner size={48} /></div>}>
            <main className="flex-grow">{children}</main>
          </Suspense>
          <LoginModal />
          <Footer />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
