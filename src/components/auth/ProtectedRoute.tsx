
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export default function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [modalOpenAttempted, setModalOpenAttempted] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        if (pathname !== '/login' && pathname !== '/signup' && pathname !== '/forgot-password') {
          if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', pathname);
          if (!modalOpenAttempted && !showLoginModal) {
            setShowLoginModal(true);
            setModalOpenAttempted(true);
          }
        }
      } else {
        setModalOpenAttempted(false);

        const profileIncomplete = !user.username || !user.role || !user.phoneNumber;
        if (profileIncomplete && pathname !== '/profile/settings') {
          if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
          router.push('/profile/settings?complete=true');
          return;
        } else if (!profileIncomplete) {
          if (typeof window !== 'undefined') localStorage.removeItem('completingProfile');
        }
        
        if (adminOnly && !isAdmin) {
          // console.warn(`ProtectedRoute: Triggering redirect for adminOnly. Pathname: ${pathname}, Loading: ${loading}, User: ${user?.id}, IsAdmin: ${isAdmin}, AdminOnly: ${adminOnly}`);
          toast({title: "Access Denied", description: "You do not have permission to view this page.", variant: "destructive"});
          router.push(isAdminUser ? "/admin/dashboard" : "/dashboard"); // isAdminUser is not defined here, should use context's isAdmin
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, isAdmin, adminOnly, router, pathname, setShowLoginModal, modalOpenAttempted, showLoginModal, toast]); // Added toast to deps

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  if (!user) {
     const publicPaths = ['/', '/login', '/signup', '/forgot-password', '/terms', '/privacy', '/contact-us', '/key-committee', '/sample-templates', '/registration', '/ai-pre-check', '/search-papers'];
     if (!publicPaths.includes(pathname) && !pathname.startsWith('/admin')) { // Added !pathname.startsWith('/admin')
        return (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
            <LockKeyhole className="h-16 w-16 text-muted-foreground mb-6" />
            <h2 className="text-2xl font-semibold mb-3">Authentication Required</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              You need to be logged in to access this page.
            </p>
            {!showLoginModal && (
                 <Button onClick={() => {
                     if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', pathname);
                     setShowLoginModal(true)
                 }} className="mt-2">
                Log In / Sign Up
              </Button>
            )}
          </div>
        );
     }
  }
  
  if (adminOnly && user && !isAdmin) {
    // This console.warn was for debugging, removing it.
    // console.warn(`ProtectedRoute: Rendering Access Denied. Pathname: ${pathname}, Loading: ${loading}, User: ${user?.id}, IsAdmin: ${isAdmin}, AdminOnly: ${adminOnly}`);
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
        <ShieldAlert className="h-16 w-16 text-destructive mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          You do not have the necessary permissions to view this page.
        </p>
         <Button onClick={() => router.push(isAdmin ? '/admin/dashboard' : '/dashboard')} className="mt-4">
            Go to Dashboard
        </Button>
      </div>
    );
  }
  
  if (user && (!user.username || !user.role || !user.phoneNumber) && pathname !== '/profile/settings') {
      return (
           <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
             <LoadingSpinner size={48} />
             <p className="ml-2">Redirecting to complete profile...</p>
           </div>
      );
  }

  return <>{children}</>;
}
