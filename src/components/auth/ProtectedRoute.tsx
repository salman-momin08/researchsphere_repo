"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast"; // Ensure toast is imported
import { AUTHOR_PROFILE_SETTINGS_PATH } from "@/context/auth-context"; // Import constant


interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [modalOpenAttempted, setModalOpenAttempted] = useState(false);
  const { toast } = useToast(); // Initialize toast

  useEffect(() => {
    if (loading) return; // Wait until auth state is determined

    const isAuthPage = ['/login', '/signup', '/forgot-password'].includes(pathname);
    const isPublicPage = [
      '/', '/terms', '/privacy', '/contact-us',
      '/key-committee', '/sample-templates', '/registration', '/search-papers'
    ].includes(pathname) || pathname.startsWith('/papers/'); // Published papers are public

    if (!user) {
      // User is not logged in
      if (!isAuthPage && !isPublicPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH) {
         // If trying to access a protected page (and not profile settings specifically)
        if (typeof window !== "undefined") {
          localStorage.setItem("redirectAfterLogin", pathname);
        }
        if (!showLoginModal && !modalOpenAttempted) {
          setShowLoginModal(true);
          setModalOpenAttempted(true);
        }
      } else {
        setModalOpenAttempted(false); // Reset if on public/auth page
      }
      return; // Exit early if no user
    }

    // User is logged in
    setModalOpenAttempted(false); // Reset modal attempt flag

    // Profile completion check is now primarily handled by AuthContext redirection logic
    // ProtectedRoute mainly ensures role-based access (adminOnly)

    if (adminOnly && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this page.",
        variant: "destructive",
      });
      // Redirect to their appropriate dashboard
      router.push(user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard");
    }

  }, [user, loading, pathname, isAdmin, adminOnly, showLoginModal, setShowLoginModal, toast, router, modalOpenAttempted]);


  // Initial loading screen while auth state is being determined
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  const isUserArea = pathname.startsWith('/author/') || pathname.startsWith('/reviewer/');
  const isAdminArea = adminOnly && pathname.startsWith('/admin/');

  // If no user, and trying to access a protected area (excluding profile settings which handles its own initial state)
  if (!user && (isUserArea || isAdminArea) && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
    // AuthContext's useEffect will handle showing the login modal
    // This part of ProtectedRoute primarily ensures children aren't rendered prematurely
    // or shows a loading state if modal logic is slightly delayed by context updates.
    if (!showLoginModal && !modalOpenAttempted) {
       return (
         <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
           <LoadingSpinner size={48} />
           <p className="ml-2">Checking authentication...</p>
         </div>
       );
    }
    return null; // AuthContext will show LoginModal
  }


  // If trying to access adminOnly page without admin rights
  if (adminOnly && user && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
        <ShieldAlert className="h-16 w-16 text-destructive mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          You do not have the necessary permissions to view this page.
        </p>
        <Button
          onClick={() => router.push(user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard")}
          className="mt-4"
        >
          Go to Your Dashboard
        </Button>
      </div>
    );
  }
  
  // If user exists and all checks pass (or AuthContext is handling profile completion redirect)
  return <>{children}</>;
};

export default ProtectedRoute;
