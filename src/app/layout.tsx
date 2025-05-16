
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/auth-context';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Toaster } from "@/components/ui/toaster";
// import LoginModal from '@/components/auth/LoginModal'; // Will be dynamically imported
import React, { Suspense } from 'react'; 
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import dynamic from 'next/dynamic';

const LoginModal = dynamic(() => import('@/components/auth/LoginModal'), {
  ssr: false, // Modals are often client-side only
  loading: () => <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center"><LoadingSpinner size={32} /></div>,
});


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
