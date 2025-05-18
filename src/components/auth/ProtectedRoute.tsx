
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useToast } from "@/hooks/use-toast"; // Keep for potential direct use if needed, though AuthContext handles most auth toasts

export const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings'; // Ensure this is consistent

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast(); // Keep for local toasts if necessary
  const [initialCheckComplete, setInitialCheckComplete] = useState(false);

  useEffect(() => {
    // This log is for deep debugging of ProtectedRoute behavior.
    // console.log(`ProtectedRoute EFFECT: Path: ${pathname}, Loading: ${loading}, User: ${user?.id}, IsAdmin: ${isAdmin}, AdminOnly: ${adminOnly}, InitialCheck: ${initialCheckComplete}, ShowLoginModal: ${showLoginModal}`);
    
    if (loading) {
      // Wait for AuthContext to finish its initial loading/auth state check
      return; 
    }
    
    if (!initialCheckComplete) {
      setInitialCheckComplete(true); // Mark that AuthContext's initial loading is done.
    }

    // AuthContext's loading is false, so we can make decisions.
    if (!user) {
      // User is not logged in.
      // AuthContext's onAuthStateChanged handles redirecting to /profile/settings if profile is incomplete.
      // ProtectedRoute's job here is to trigger the login modal if no user for a protected path.
      const isAuthPage = pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password";
      const isProfileSettingsPage = pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?');

      if (!isAuthPage && !isProfileSettingsPage) { 
          // console.log(`ProtectedRoute: No user for protected path ${pathname}. Setting redirectAfterLogin and showing modal.`);
          if (typeof window !== "undefined") {
            localStorage.setItem("redirectAfterLogin", pathname + (window.location.search || ""));
          }
          if (!showLoginModal) { // Avoid re-triggering if already shown by AuthContext or another instance
            setShowLoginModal(true);
          }
      }
      return; // Stop further checks if no user
    }

    // User is logged in (user object exists)
    if (adminOnly && !isAdmin) {
      // console.warn(`ProtectedRoute: Admin access DENIED. Path: ${pathname}, User: ${user.id}, IsAdmin: ${isAdmin}`);
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this admin page.",
        variant: "destructive",
      });
      // Redirect to a non-admin dashboard
      router.push(user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard");
      return;
    }
    
    // console.log(`ProtectedRoute: Access GRANTED. Path: ${pathname}, User: ${user.id}, IsAdmin: ${isAdmin}`);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, isAdmin, adminOnly, pathname, router, showLoginModal, setShowLoginModal, initialCheckComplete, toast]);


  if (loading || (!initialCheckComplete && !user)) { // Show loader if AuthContext is loading OR if initial check isn't done AND no user yet (to prevent flash of content before modal)
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Verifying access...</p>
      </div>
    );
  }
  
  // If AuthContext's initial loading is complete, and user is null,
  // AND we are on a protected path (not profile settings, not auth pages), AuthContext should trigger the modal.
  // This loader covers the brief moment before the modal appears or if redirection decision is pending.
  if (initialCheckComplete && !user && 
      !(pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) &&
      !(pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password")
     ) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Authenticating...</p>
      </div>
    );
  }
  
  // If adminOnly access was denied and redirect is happening, children might briefly render, or not.
  // The primary guard is the redirect above.
  
  return <>{children}</>;
};

export default ProtectedRoute;
