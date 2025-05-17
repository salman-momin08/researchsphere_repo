
"use client"; // All layouts using hooks or context need to be client components

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/use-auth'; // For role-specific checks if needed
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';


interface ReviewerLayoutProps {
  children: React.ReactNode;
}

export default function ReviewerLayout({ children }: ReviewerLayoutProps) {
  const { user } = useAuth();

  // Optional: Add a check here if only users with "Reviewer" role should access this layout
  // This is an additional layer on top of ProtectedRoute which just checks for authentication.
  // if (user && user.role !== 'Reviewer' && user.role !== 'Admin') { // Admins might also access reviewer views
  //   return (
  //     <div className="container py-8 md:py-12 px-4 text-center">
  //       <Alert variant="destructive" className="max-w-lg mx-auto">
  //         <ShieldAlert className="h-5 w-5" />
  //         <AlertTitle>Access Denied</AlertTitle>
  //         <AlertDescription>
  //           You do not have reviewer privileges to access this section.
  //         </AlertDescription>
  //       </Alert>
  //       <Link href={user.isAdmin ? "/admin/dashboard" : "/author/dashboard"}>
  //         <Button className="mt-6">Go to Your Dashboard</Button>
  //       </Link>
  //     </div>
  //   );
  // }


  return (
    <ProtectedRoute>
      {/* If you had a reviewer-specific sidebar or sub-header, it would go here */}
      <div className="w-full">
        {children}
      </div>
    </ProtectedRoute>
  );
}
