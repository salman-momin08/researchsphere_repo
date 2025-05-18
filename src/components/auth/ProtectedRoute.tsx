
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard'; // Ensure this is correct
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
  const { user, loading, isAdminUser, showLoginModal, setShowLoginModal, isProfileComplete } = useAuth();
  const router = useRouter();
  const pathname = usePathname(); // Current path
  const { toast } = useToast();
  const [initialCheckComplete, setInitialCheckComplete] = useState(false);

  useEffect(() => {
    if (!loading) {
      setInitialCheckComplete(true);
    }
  }, [loading]);

  if (loading || !initialCheckComplete) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Verifying access...</p>
      </div>
    );
  }

  const isPublicPage = PUBLIC_PATHS_PATTERNS.some(pattern =>
    typeof pattern === 'string' ? pattern === pathname : pattern.test(pathname)
  );

  // Allow access to public pages, login, signup, forgot password regardless of auth state
  if (isPublicPage) {
    return <>{children}</>;
  }

  // If no user and not on a public page or auth utility page, prompt login
  if (!user) {
    if (typeof window !== "undefined") {
      localStorage.setItem("redirectAfterLogin", pathname + window.location.search);
    }
    if (!showLoginModal) {
        // Defer showing modal to a microtask to avoid issues during render
        setTimeout(() => setShowLoginModal(true), 0);
    }
    return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <LoadingSpinner size={48} />
            <p className="ml-2">Redirecting to login...</p>
        </div>
    );
  }

  // User is logged in at this point

  // If it's an admin-only route and user is not an admin
  if (adminOnly && !isAdminUser) {
    toast({
      title: "Access Denied",
      description: "You do not have permission to view this admin page.",
      variant: "destructive",
    });
    // Redirect non-admins to their appropriate dashboard
    router.push(user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
    return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <LoadingSpinner size={48} />
            <p className="ml-2">Redirecting...</p>
        </div>
    );
  }

  // If user is logged in and trying to access their profile settings page, always allow.
  // AuthContext will handle redirecting them TO this page if incomplete,
  // or AWAY from it if they land here after completion.
  if (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
    return <>{children}</>;
  }
  
  // NOTE: The logic for redirecting to profile completion if !isProfileComplete
  // is now primarily handled by AuthContext.tsx. ProtectedRoute's main job
  // is to ensure a user is logged in for protected routes, and check adminOnly.

  return <>{children}</>;
};

export default ProtectedRoute;
