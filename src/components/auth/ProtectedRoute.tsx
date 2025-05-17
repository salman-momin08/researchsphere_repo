
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';

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
    if (loading) {
      return; // Wait until AuthContext loading is false
    }

    if (!user) { // User is not logged in
      const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password';
      const isPublicPage = ['/', '/terms', '/privacy', '/contact-us', '/key-committee', '/sample-templates', '/registration', '/search-papers'].includes(pathname);
      
      if (!isAuthPage && !isPublicPage && !pathname.startsWith('/papers/')) { 
        if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', pathname);
        if (!showLoginModal && !modalOpenAttempted) {
            setShowLoginModal(true);
            setModalOpenAttempted(true);
        }
      } else {
        setModalOpenAttempted(false); 
      }
    } else { // User IS logged in
      setModalOpenAttempted(false); 
      const isProfileComplete = !!(user.username && user.role && user.phoneNumber);

      // This specific redirect from ProtectedRoute for incomplete profile
      // should only happen if AuthContext hasn't already initiated it.
      // AuthContext is the primary driver for this redirect.
      if (!isProfileComplete && 
          pathname !== AUTHOR_PROFILE_SETTINGS_PATH && 
          !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?complete=true')) {
        // AuthContext will handle this redirect. ProtectedRoute just ensures content isn't shown.
        // We show a loading spinner here while AuthContext likely redirects.
        return; 
      }
      
      if (adminOnly && !isAdmin) {
        toast({title: "Access Denied", description: "You do not have permission to view this page.", variant: "destructive"});
        router.push(user.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard');
      }
    }
  }, [user, loading, isAdmin, adminOnly, router, pathname, setShowLoginModal, modalOpenAttempted, showLoginModal, toast]);


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  // If user is not logged in and trying to access a protected route that needs auth,
  // AuthContext should have triggered the modal or a redirect.
  // This part of ProtectedRoute handles rendering a fallback if modal isn't shown yet or acts as a guard.
  const isExplicitlyProtected = pathname.startsWith('/author/') || pathname.startsWith('/reviewer/') || (adminOnly && pathname.startsWith('/admin/'));
  if (!user && isExplicitlyProtected) {
     if (!showLoginModal && !modalOpenAttempted && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) { 
        // If trying to access profile settings without auth, modal should appear.
        // For other protected routes, show loading as AuthContext might be about to show modal.
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
                <LoadingSpinner size={48} />
                <p className="ml-2">Loading authentication...</p>
            </div>
        );
     }
     // If it's specifically the profile settings page and user isn't logged in,
     // AuthContext will show modal. This provides a placeholder.
     if (pathname === AUTHOR_PROFILE_SETTINGS_PATH && !showLoginModal) {
        return (
             <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
                <LockKeyhole className="h-16 w-16 text-muted-foreground mb-6" />
                <h2 className="text-2xl font-semibold mb-3">Authentication Required</h2>
                <p className="text-muted-foreground mb-6 max-w-md">
                    You need to be logged in to access this page.
                </p>
             </div>
        )
     }
     return null; // Let LoginModal (triggered by AuthContext) handle the UI.
  }
  
  if (adminOnly && user && !isAdmin) {
    // This case should be handled by redirection in useEffect, but as a fallback UI:
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
        <ShieldAlert className="h-16 w-16 text-destructive mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          You do not have the necessary permissions to view this page.
        </p>
         <Button onClick={() => router.push(user.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard')} className="mt-4">
            Go to Your Dashboard
        </Button>
      </div>
    );
  }
  
  // If profile is incomplete and user is not already on the profile settings page,
  // AuthContext's useEffect should handle the redirect. This just prevents rendering children.
  if (user && (!user.username || !user.role || !user.phoneNumber) && 
      pathname !== AUTHOR_PROFILE_SETTINGS_PATH && 
      !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?complete=true')) {
      return (
           <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
             <LoadingSpinner size={48} />
             <p className="ml-2">Checking profile status...</p>
           </div>
      );
  }

  return <>{children}</>;
}
