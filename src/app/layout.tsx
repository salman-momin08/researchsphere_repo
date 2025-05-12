import type { Metadata } from 'next';
import { Inter } from 'next/font/google'; // Changed from GeistSans
import './globals.css';
import { AuthProvider } from '@/context/auth-context';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Toaster } from "@/components/ui/toaster"
import LoginModal from '@/components/auth/LoginModal';

const inter = Inter({ // Changed from geistSans
  variable: '--font-inter', // Changed variable name
  subsets: ['latin'],
});

// Geist Mono is not explicitly used but kept from original if needed.
// const geistMono = Geist_Mono({
//   variable: '--font-geist-mono',
//   subsets: ['latin'],
// });

export const metadata: Metadata = {
  title: 'ScholarSubmit - Academic Paper Publishing',
  description: 'Upload, manage, and evaluate research papers with AI-powered tools.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}> {/* Changed from geistSans.variable */}
      <body className="antialiased flex flex-col min-h-screen">
        <AuthProvider>
          <Header />
          <main className="flex-grow">
            {children}
          </main>
          <LoginModal />
          <Footer />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
