import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/auth-context';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Toaster } from "@/components/ui/toaster"
import LoginModal from '@/components/auth/LoginModal';

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
      {/* Next.js automatically creates the <head> tag.
          Ensure no characters, including comments or newlines that might be misinterpreted,
          exist between the <html> tag and the <body> tag. */}
      <body className="antialiased flex flex-col min-h-screen">
        <AuthProvider>
          <Header />
          <main className="flex-grow">{children}</main>
          <LoginModal />
          <Footer />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
