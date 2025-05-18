
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { AUTHOR_PROFILE_SETTINGS_PATH } from "@/context/auth-context"; 

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [initialCheckComplete, setInitialCheckComplete] = useState(false);

  useEffect(() => {
    // console.log(`ProtectedRoute EFFECT: Path: ${pathname}, Loading: ${loading}, User: ${user?.id}, IsAdmin: ${isAdmin}, AdminOnly: ${adminOnly}, InitialCheck: ${initialCheckComplete}`);
    
    if (loading) {
      // Wait for AuthContext to finish its initial loading/auth state check
      return; 
    }
    
    if (!initialCheckComplete) {
      setInitialCheckComplete(true);
    }

    if (!user) {
      // User is not logged in.
      // AuthContext's onAuthStateChanged will handle redirecting to /profile/settings if profile is incomplete.
      // ProtectedRoute's job here is to trigger the login modal if no user for a protected path.
      const isAuthPage = pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password";
      const isProfileSettingsPage = pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');

      if (!isAuthPage && !isProfileSettingsPage) { // Don't show modal if already on auth pages or profile settings (AuthContext handles redirect to settings)
          // console.log(`ProtectedRoute: No user for protected path ${pathname}. Setting redirectAfterLogin and showing modal.`);
          if (typeof window !== "undefined") {
            localStorage.setItem("redirectAfterLogin", pathname + (window.location.search || ""));
          }
          if (!showLoginModal) {
            setShowLoginModal(true);
          }
      }
      return;
    }

    // User is logged in
    if (adminOnly && !isAdmin) {
      console.warn(`ProtectedRoute: Admin access DENIED. Path: ${pathname}, User: ${user.id}, IsAdmin: ${isAdmin}`);
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this page.",
        variant: "destructive",
      });
      router.push(user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard");
      return;
    }
    
    // console.log(`ProtectedRoute: Access GRANTED. Path: ${pathname}, User: ${user.id}, IsAdmin: ${isAdmin}`);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, isAdmin, adminOnly, pathname, router, showLoginModal, setShowLoginModal, toast, initialCheckComplete]);


  if (loading || !initialCheckComplete) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Verifying access...</p>
      </div>
    );
  }

  // If loading is false, and initialCheckComplete is true, decisions have been made.
  // If no user for a protected area, modal is shown by AuthContext, or redirect happened.
  // If adminOnly access denied, redirect happened.
  // Otherwise, render children.
  if (!user && (pathname.startsWith('/author/') || pathname.startsWith('/reviewer/') || pathname.startsWith('/admin/')) && !(pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))) {
    // This case is if AuthContext is done loading, user is null, and we are on a protected path segment
    // (excluding profile settings, which has its own flow)
    // AuthContext should have already triggered login modal.
    // Showing a loader here prevents content flash while modal appears.
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Authenticating...</p>
      </div>
    );
  }
  
  return <>{children}</>;
};

export default ProtectedRoute;

    