
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast"; // Keep this import

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings'; // Ensure this matches context

export default function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [modalOpenAttempted, setModalOpenAttempted] = useState(false);
  const { toast } = useToast(); // Initialize toast

  useEffect(() => {
    if (loading) {
      return; // Wait until loading is false
    }

    // console.warn(`ProtectedRoute: Path: ${pathname}, Loading: ${loading}, UserID: ${user?.id}, IsAdmin: ${isAdmin}, AdminOnly: ${adminOnly}`);

    if (!user) { // User is not logged in
      const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password';
      const isPublicPage = ['/', '/terms', '/privacy', '/contact-us', '/key-committee', '/sample-templates', '/registration', '/search-papers'].includes(pathname);
      
      if (!isAuthPage && !isPublicPage && !pathname.startsWith('/papers/')) { // /papers/[id] might have public logic
        // console.warn(`ProtectedRoute: User not logged in, attempting to access protected route ${pathname}. Setting redirect and showing modal.`);
        if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', pathname);
        if (!showLoginModal && !modalOpenAttempted) {
            setShowLoginModal(true);
            setModalOpenAttempted(true);
        }
      } else {
        setModalOpenAttempted(false); // Reset if on public/auth page
      }
    } else { // User IS logged in
      setModalOpenAttempted(false); // Reset attempt flag
      const isProfileComplete = !!(user.username && user.role && user.phoneNumber);

      if (!isProfileComplete && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?complete=true')) {
        // console.warn(`ProtectedRoute: User ${user.id} profile incomplete. Redirecting to ${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true from ${pathname}`);
        if (typeof window !== 'undefined') localStorage.setItem('completingProfile', 'true');
        router.push(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`);
        return;
      }
      
      if (adminOnly && !isAdmin) {
        // console.warn(`ProtectedRoute: Non-admin user ${user.id} attempting to access admin-only route ${pathname}. Redirecting.`);
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

  // If user is not logged in and trying to access a protected route (that isn't an auth page itself)
  const isExplicitlyProtected = pathname.startsWith('/author/') || pathname.startsWith('/reviewer/') || (adminOnly && pathname.startsWith('/admin/'));
  if (!user && isExplicitlyProtected) {
     if (!showLoginModal && !modalOpenAttempted) {
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
                <LoadingSpinner size={48} />
                <p className="ml-2">Redirecting to login...</p>
            </div>
        );
     }
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
                     setShowLoginModal(true);
                     setModalOpenAttempted(true); // Set flag when button is clicked
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
         <Button onClick={() => router.push(user.role === 'Reviewer' ? '/reviewer/dashboard' : '/author/dashboard')} className="mt-4">
            Go to Your Dashboard
        </Button>
      </div>
    );
  }
  
  // If profile is incomplete and user is not already on the profile settings page.
  // This check is also in AuthContext, but ProtectedRoute acts as a safeguard for its children.
  if (user && (!user.username || !user.role || !user.phoneNumber) && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?complete=true')) {
      // console.warn(`ProtectedRoute (Render Fallback): User ${user.id} profile incomplete on path ${pathname}. Showing loading/redirecting message.`);
      return (
           <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
             <LoadingSpinner size={48} />
             <p className="ml-2">Redirecting to complete profile...</p>
           </div>
      );
  }

  return <>{children}</>;
}
