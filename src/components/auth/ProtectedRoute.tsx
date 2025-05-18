
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname, useSearchParams as useNextSearchParams } from "next/navigation";
import React, { useEffect, useState, ReactNode } from "react";
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

const PUBLIC_PATHS_PATTERNS = [
  HOME_PATH, LOGIN_PATH, SIGNUP_PATH, FORGOT_PASSWORD_PATH,
  /^\/registration$/, /^\/key-committee$/, /^\/sample-templates$/,
  /^\/contact-us$/, /^\/search-papers$/, /^\/terms$/, /^\/privacy$/
];

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdminUser, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams(); // For consistency
  const { toast } = useToast();
  const [initialCheckComplete, setInitialCheckComplete] = useState(false);

  useEffect(() => {
    // console.log(`ProtectedRoute (${pathname}): Effect triggered. Loading: ${loading}, User: ${user ? user.id : 'null'}, IsAdmin: ${isAdminUser}`);
    if (!loading) {
      setInitialCheckComplete(true); // Mark initial auth check as complete
      const currentFullUrl = pathname + (searchParamsFromHook.toString() ? `?${searchParamsFromHook.toString()}` : "");

      const isPublicPage = PUBLIC_PATHS_PATTERNS.some(pattern =>
        typeof pattern === 'string' ? pattern === pathname : pattern.test(pathname)
      );

      if (!user) { // User is not logged in
        if (!isPublicPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?complete=true') ) {
          // console.log(`ProtectedRoute (${pathname}): No user, not public, not profile settings. Storing redirect: ${currentFullUrl}`);
          if (typeof window !== "undefined") {
            localStorage.setItem("redirectAfterLogin", currentFullUrl);
          }
          if (!showLoginModal) {
            // console.log(`ProtectedRoute (${pathname}): Showing login modal.`);
            setShowLoginModal(true);
          }
        }
      } else { // User IS logged in
        if (adminOnly && !isAdminUser) {
          // console.warn(`ProtectedRoute (${pathname}): Admin access denied for non-admin user ${user.id}. Redirecting to their dashboard.`);
          toast({
            title: "Access Denied",
            description: "You do not have permission to view this admin page.",
            variant: "destructive",
          });
          router.push(user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
        }
        // Profile completion redirection is handled by AuthContext
      }
    }
  }, [user, loading, isAdminUser, adminOnly, pathname, router, showLoginModal, setShowLoginModal, toast, searchParamsFromHook]);


  if (loading || !initialCheckComplete) {
    // console.log(`ProtectedRoute (${pathname}): Showing loading spinner (loading: ${loading}, initialCheckComplete: ${initialCheckComplete})`);
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Authenticating...</p>
      </div>
    );
  }

  const isPublicPage = PUBLIC_PATHS_PATTERNS.some(pattern =>
    typeof pattern === 'string' ? pattern === pathname : pattern.test(pathname)
  );

  // If still no user after loading, and it's a protected page not handled above (e.g., profile settings for a new user)
  // AuthContext should manage the modal trigger. This component just ensures content isn't shown.
  if (!user && !isPublicPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?complete=true')) {
     // console.log(`ProtectedRoute (${pathname}): No user after load, rendering placeholder for modal.`);
     return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <LoadingSpinner size={48} />
            <p className="ml-2">Redirecting to login...</p>
        </div>
    );
  }

  if (adminOnly && user && !isAdminUser) {
    // console.log(`ProtectedRoute (${pathname}): Admin access denied post-load. Rendering placeholder for redirect.`);
    return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <LoadingSpinner size={48} />
            <p className="ml-2">Access Denied. Redirecting...</p>
        </div>
    );
  }

  // console.log(`ProtectedRoute (${pathname}): Rendering children.`);
  return <>{children}</>;
};

export default ProtectedRoute;
