
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
        const publicPaths = ['/', '/login', '/signup', '/forgot-password', '/terms', '/privacy', '/contact-us', '/key-committee', '/sample-templates', '/registration', '/search-papers'];
        const isAdminPath = pathname.startsWith('/admin');
        const isUserPath = pathname.startsWith('/user');

        if (!publicPaths.includes(pathname) && !isAdminPath && !isUserPath && pathname !== '/papers/[id]') { // Allow /papers/[id] initially, as its content can be public
             // Let specific /papers/[id] logic handle auth if needed
        } else if ((isAdminPath || isUserPath) && !publicPaths.includes(pathname) && !showLoginModal && !modalOpenAttempted) {
           if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', pathname);
           setShowLoginModal(true);
           setModalOpenAttempted(true);
        }
      } else { // User is logged in
        setModalOpenAttempted(false); // Reset attempt flag

        const isProfileComplete = !!(user.username && user.role && user.phoneNumber);
        const isProfileSettingsPage = pathname === '/user/profile/settings';
        
        if (!isProfileComplete && !isProfileSettingsPage) {
          if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
          router.push('/user/profile/settings?complete=true');
          return;
        } else if (isProfileComplete && isProfileSettingsPage && (typeof window !== 'undefined' && localStorage.getItem('completingProfile') === 'true')) {
          // This case is now primarily handled by AuthContext's redirection after profile update
        }
        
        if (adminOnly && !isAdmin) {
          toast({title: "Access Denied", description: "You do not have permission to view this page.", variant: "destructive"});
          router.push(user ? "/user/dashboard" : "/"); // Redirect non-admin to user dashboard or home
        }
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

  // If user is not logged in and trying to access a protected route (handled by useEffect setting modal)
  if (!user && (pathname.startsWith('/user/') || (adminOnly && pathname.startsWith('/admin/')))) {
     if (!showLoginModal && !modalOpenAttempted) { // Double check to prevent flash if modal is already opening
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
                <LoadingSpinner size={48} />
                <p className="ml-2">Redirecting to login...</p>
            </div>
        );
     }
     // If modal is expected to be open, render children (which might be null or the modal itself if part of children)
     // Or, render a generic loading/placeholder until modal logic fully takes over.
     // This return is to prevent rendering protected content while modal is supposed to be up or user is null.
     return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
            <LockKeyhole className="h-16 w-16 text-muted-foreground mb-6" />
            <h2 className="text-2xl font-semibold mb-3">Authentication Required</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
                You need to be logged in to access this page. The login modal should appear shortly.
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
  
  if (adminOnly && user && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
        <ShieldAlert className="h-16 w-16 text-destructive mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          You do not have the necessary permissions to view this page.
        </p>
         <Button onClick={() => router.push(isAdmin ? '/admin/dashboard' : '/user/dashboard')} className="mt-4">
            Go to Your Dashboard
        </Button>
      </div>
    );
  }
  
  if (user && (!user.username || !user.role || !user.phoneNumber) && pathname !== '/user/profile/settings') {
      return (
           <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
             <LoadingSpinner size={48} />
             <p className="ml-2">Redirecting to complete profile...</p>
           </div>
      );
  }

  return <>{children}</>;
}
