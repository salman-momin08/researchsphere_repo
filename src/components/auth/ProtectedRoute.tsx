"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react"; // Added icons
import { Button } from "@/components/ui/button"; // For potential manual login button

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
        localStorage.setItem('redirectAfterLogin', pathname);
        if (!modalOpenAttempted && !showLoginModal) { 
          setShowLoginModal(true);
          setModalOpenAttempted(true); 
        }
      } else {
        // User is logged in
        setModalOpenAttempted(false); // Reset attempt flag
        if (adminOnly && !isAdmin) {
          router.push("/dashboard"); 
        }
      }
    }
  }, [user, loading, isAdmin, adminOnly, router, pathname, setShowLoginModal, modalOpenAttempted, showLoginModal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]"> {/* Adjusted min-height */}
        <LoadingSpinner size={48} />
      </div>
    );
  }

  if (!user) {
    // User is not logged in. Modal should be shown or has been shown.
    // Render a placeholder indicating login is required.
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4"> {/* Adjusted min-height and added padding */}
        <LockKeyhole className="h-16 w-16 text-muted-foreground mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Authentication Required</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          You need to be logged in to access this page. Please log in or sign up to continue.
        </p>
        {/* The modal is handled globally by AuthContext. User can also click global login/signup buttons. */}
        {/* Optionally, provide a button here to re-trigger the modal if it was closed. */}
        {!showLoginModal && (
             <Button onClick={() => {
                 localStorage.setItem('redirectAfterLogin', pathname); // Ensure redirect path is set
                 setShowLoginModal(true)
             }} className="mt-2">
            Log In / Sign Up
          </Button>
        )}
      </div>
    );
  }
  
  if (adminOnly && !isAdmin) {
    // User is logged in but not an admin for an admin-only route.
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4"> {/* Adjusted min-height and added padding */}
        <ShieldAlert className="h-16 w-16 text-destructive mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          You do not have the necessary permissions to view this page. Redirecting to your dashboard...
        </p>
      </div>
    );
  }
  
  return <>{children}</>;
}

