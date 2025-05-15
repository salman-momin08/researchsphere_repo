
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/auth-context';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Toaster } from "@/components/ui/toaster";
import LoginModal from '@/components/auth/LoginModal';
import React, { Suspense } from 'react'; 
import LoadingSpinner from '@/components/shared/LoadingSpinner';

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
      <body>
        <Suspense fallback={<div className="flex-grow flex items-center justify-center min-h-screen"><LoadingSpinner size={48} /></div>}>
          <AuthProvider>
            <div className="antialiased flex flex-col min-h-screen">
              <Header />
              <main className="flex-grow">{children}</main>
              <LoginModal />
              <Footer />
              <Toaster />
            </div>
          </AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
