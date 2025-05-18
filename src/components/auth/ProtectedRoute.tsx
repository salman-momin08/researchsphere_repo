
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const FORGOT_PASSWORD_PATH = '/forgot-password';

const PUBLIC_PATHS = [
  HOME_PATH, LOGIN_PATH, SIGNUP_PATH, FORGOT_PASSWORD_PATH,
  '/registration', '/key-committee', '/sample-templates',
  '/contact-us', '/search-papers', '/terms', '/privacy'
];

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
    // console.log(`ProtectedRoute EFFECT: Path: ${pathname}, Loading: ${loading}, User: ${user?.id}, isAdmin (from context): ${isAdmin}, AdminOnly: ${adminOnly}, InitialCheck: ${initialCheckComplete}`);
    
    if (loading) {
      // If AuthContext is loading, ProtectedRoute should also wait.
      if (!initialCheckComplete) setInitialCheckComplete(false); // Ensure it re-checks if loading starts again
      return; 
    }
    
    // AuthContext loading is false, now we can make decisions
    if (!initialCheckComplete) {
      setInitialCheckComplete(true);
    }

    // If loading is false and still no user
    if (!user) {
      const isPublicPage = PUBLIC_PATHS.includes(pathname) || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH); // Profile settings is special for completion
      
      if (!isPublicPage && !adminOnly) { // Standard protected route, not admin-only
          // console.warn(`ProtectedRoute: No user for protected path ${pathname}. Setting redirectAfterLogin and requesting login modal.`);
          if (typeof window !== "undefined") {
            localStorage.setItem("redirectAfterLogin", pathname + (window.location.search || ""));
          }
          if (!showLoginModal) { // Only show modal if not already visible
            setShowLoginModal(true);
          }
      } else if (adminOnly) { // Admin-only route, no user means needs login
          // console.warn(`ProtectedRoute: No user for ADMIN-ONLY path ${pathname}. Setting redirectAfterLogin and requesting login modal.`);
           if (typeof window !== "undefined") {
            localStorage.setItem("redirectAfterLogin", pathname + (window.location.search || ""));
          }
          if (!showLoginModal) {
            setShowLoginModal(true);
          }
      }
      return; // Return after handling no user
    }

    // User is logged in, check for admin-only access
    if (adminOnly && !isAdmin) {
      // console.warn(`ProtectedRoute: Admin access DENIED for user ${user.id} on path ${pathname}. isAdmin (from context): ${isAdmin}. Redirecting.`);
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this admin page.",
        variant: "destructive",
      });
      const targetDashboard = user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
      router.push(targetDashboard);
      return;
    }
    
    // console.log(`ProtectedRoute: Access GRANTED or handled by AuthContext for path ${pathname}. User: ${user.id}, isAdmin: ${isAdmin}`);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, isAdmin, adminOnly, pathname, router, initialCheckComplete, showLoginModal, setShowLoginModal, toast]);


  if (loading || (!initialCheckComplete && !user)) {
    // This covers initial load from AuthContext, or if user state isn't resolved yet
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Authenticating...</p>
      </div>
    );
  }
  
  // If loading is false, initial check is complete, but there's no user,
  // AND it's a protected path (not profile settings which has its own form),
  // then AuthContext should have set showLoginModal to true.
  // We show a temporary message while modal might be appearing.
  if (initialCheckComplete && !user && 
      !PUBLIC_PATHS.includes(pathname) && 
      pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')
     ) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Redirecting to login...</p>
      </div>
    );
  }
  
  return <>{children}</>;
};

export default ProtectedRoute;
