
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react"; 
import { Button } from "@/components/ui/button"; 

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export default function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [modalOpenAttempted, setModalOpenAttempted] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        // User not logged in
        if (pathname !== '/login' && pathname !== '/signup' && pathname !== '/forgot-password') { // Avoid loop if already on public auth pages
          localStorage.setItem('redirectAfterLogin', pathname);
          if (!modalOpenAttempted && !showLoginModal) { 
            setShowLoginModal(true);
            setModalOpenAttempted(true); 
          }
        }
      } else {
        // User is logged in
        setModalOpenAttempted(false); 

        // Check for profile completion
        const profileIncomplete = localStorage.getItem('profileIncomplete') === 'true';
        if (profileIncomplete && pathname !== '/profile/settings') {
          router.push('/profile/settings?complete=true');
          return; // Prevent further checks or rendering children until profile is complete
        }
        
        if (adminOnly && !isAdmin) {
          router.push("/dashboard"); 
        }
      }
    }
  }, [user, loading, isAdmin, adminOnly, router, pathname, setShowLoginModal, modalOpenAttempted, showLoginModal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  if (!user && pathname !== '/' && !pathname.startsWith('/login') && !pathname.startsWith('/signup') && !pathname.startsWith('/forgot-password') && !pathname.startsWith('/terms') && !pathname.startsWith('/privacy') && !pathname.startsWith('/contact-us') && !pathname.startsWith('/key-committee') && !pathname.startsWith('/sample-templates') && !pathname.startsWith('/registration') && !pathname.startsWith('/ai-pre-check')) {
    // This condition handles scenarios where user is not logged in and trying to access a protected page.
    // The modal logic in useEffect should handle prompting for login.
    // This return is a fallback or placeholder if modal logic doesn't immediately cause a re-render/redirect.
    // For pages that are explicitly public (like '/', '/login', '/signup'), they should render without this block.
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4"> 
        <LockKeyhole className="h-16 w-16 text-muted-foreground mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Authentication Required</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          You need to be logged in to access this page.
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
  
  if (adminOnly && user && !isAdmin) { // Ensure user exists before checking isAdmin
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
  
  // If profile is incomplete and current page is not settings, children might not be rendered due to redirect in useEffect.
  // This ensures children are rendered if checks pass.
  const profileIncomplete = localStorage.getItem('profileIncomplete') === 'true';
  if (user && profileIncomplete && pathname !== '/profile/settings') {
      // Placeholder or loading state while redirecting for profile completion
      return (
           <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
             <LoadingSpinner size={48} />
             <p className="ml-2">Redirecting to complete profile...</p>
           </div>
      );
  }


  return <>{children}</>;
}

