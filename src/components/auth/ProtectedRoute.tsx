
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react"; 
import { Button } from "@/components/ui/button"; 
import { useToast } from "@/hooks/use-toast"; // Correct import path

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export default function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [modalOpenAttempted, setModalOpenAttempted] = useState(false);
  const { toast } = useToast(); // Initialize toast here

  useEffect(() => {
    // Only proceed with checks if Firebase Auth is no longer loading
    if (!loading) {
      if (!user) {
        // User not logged in
        // Avoid redirect loops for public auth pages
        if (pathname !== '/login' && pathname !== '/signup' && pathname !== '/forgot-password') { 
          localStorage.setItem('redirectAfterLogin', pathname);
          if (!modalOpenAttempted && !showLoginModal) { 
            setShowLoginModal(true);
            setModalOpenAttempted(true); 
          }
        }
      } else {
        // User is logged in
        setModalOpenAttempted(false); // Reset flag if user becomes available

        // Check for profile completion
        // This check should only happen if the user object is confirmed
        const profileIncomplete = !user.username || !user.role || !user.phoneNumber; // Added phoneNumber
        if (profileIncomplete && pathname !== '/profile/settings') {
          localStorage.setItem('profileIncomplete', 'true'); // Ensure flag is set if navigating away
          router.push('/profile/settings?complete=true');
          return; 
        } else if (!profileIncomplete) {
          localStorage.removeItem('profileIncomplete');
        }
        
        if (adminOnly && !isAdmin) {
          toast({title: "Access Denied", description: "You do not have permission to view this page.", variant: "destructive"});
          router.push("/dashboard"); 
        }
      }
    }
  }, [user, loading, isAdmin, adminOnly, router, pathname, setShowLoginModal, modalOpenAttempted, showLoginModal, toast]); // Added toast to dependency array

  // Show loading spinner while Firebase Auth is initializing
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  // If still loading (though above check should catch it) or no user and it's a protected route:
  // (Additional check to ensure children don't render if user becomes null after initial load for some reason)
  if (!user) {
    // For truly public pages, they should not be wrapped by ProtectedRoute or should have a different handling.
    // This fallback is for pages that *are* protected.
     const publicPaths = ['/', '/login', '/signup', '/forgot-password', '/terms', '/privacy', '/contact-us', '/key-committee', '/sample-templates', '/registration', '/ai-pre-check', '/search-papers']; // Added /search-papers
     if (!publicPaths.includes(pathname)) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4"> 
            <LockKeyhole className="h-16 w-16 text-muted-foreground mb-6" />
            <h2 className="text-2xl font-semibold mb-3">Authentication Required</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              You need to be logged in to access this page. Please wait while we check your session or log in.
            </p>
            {!showLoginModal && (
                 <Button onClick={() => {
                     localStorage.setItem('redirectAfterLogin', pathname); 
                     setShowLoginModal(true)
                 }} className="mt-2">
                Log In / Sign Up
              </Button>
            )}
          </div>
        );
     }
  }
  
  // Admin-only check after confirming user is logged in
  if (adminOnly && user && !isAdmin) { 
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4"> 
        <ShieldAlert className="h-16 w-16 text-destructive mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          You do not have the necessary permissions to view this page. Redirecting to your dashboard...
        </p>
      </div>
    );
  }
  
  // Profile completion check after confirming user is logged in
  if (user && (!user.username || !user.role || !user.phoneNumber) && pathname !== '/profile/settings') {
      return (
           <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
             <LoadingSpinner size={48} />
             <p className="ml-2">Redirecting to complete profile...</p>
           </div>
      );
  }

  // If all checks pass, render children
  return <>{children}</>;
}
