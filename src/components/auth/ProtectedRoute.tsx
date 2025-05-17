
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();

  useEffect(() => {
    if (loading) return; 

    const isAuthPage = ['/login', '/signup', '/forgot-password'].includes(pathname);
    const isPublicPage = [
      '/', '/terms', '/privacy', '/contact-us',
      '/key-committee', '/sample-templates', '/registration', '/search-papers'
    ].includes(pathname) || pathname.startsWith('/papers/'); 

    if (!user) {
      if (!isAuthPage && !isPublicPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
        if (typeof window !== "undefined") {
          localStorage.setItem("redirectAfterLogin", pathname);
        }
        if (!showLoginModal && !modalOpenAttempted) {
          setShowLoginModal(true);
          setModalOpenAttempted(true);
        }
      } else {
        setModalOpenAttempted(false);
      }
      return; 
    }

    // User is logged in
    setModalOpenAttempted(false); 

    // AuthContext now handles profile completion redirect primarily.
    // This component focuses on auth status and adminOnly role.

    if (adminOnly && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this page.",
        variant: "destructive",
      });
      router.push(user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard");
    }

  }, [user, loading, isAdmin, adminOnly, pathname, router, showLoginModal, setShowLoginModal, toast, modalOpenAttempted]);


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  const isUserArea = pathname.startsWith('/author/') || pathname.startsWith('/reviewer/');
  const isAdminArea = adminOnly && pathname.startsWith('/admin/');

  // If AuthContext hasn't initialized user yet, but it's a protected route, show loading or let AuthContext handle modal.
  if (!user && (isUserArea || isAdminArea) && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
    if (!showLoginModal && !modalOpenAttempted) { // Avoid flashing if modal is about to show
       return (
         <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
           <LoadingSpinner size={48} />
         </div>
       );
    }
    return null; // AuthContext will show LoginModal if needed
  }

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
  
  return <>{children}</>;
};

export default ProtectedRoute;
