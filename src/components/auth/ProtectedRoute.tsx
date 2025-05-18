
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect } from "react"; // Removed useState as initialCheckComplete is handled by AuthContext
import LoadingSpinner from "@/components/shared/LoadingSpinner";

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard';
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard';
const HOME_PATH = '/';
const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';

const PUBLIC_PATHS_PATTERNS = [
  HOME_PATH, LOGIN_PATH, SIGNUP_PATH,
  /^\/registration$/, /^\/key-committee$/, /^\/sample-templates$/,
  /^\/contact-us$/, /^\/search-papers$/, /^\/terms$/, /^\/privacy$/,
  /^\/forgot-password$/
];

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdminUser, setShowLoginModal, initialAuthCheckComplete, isProfileComplete } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Use initialAuthCheckComplete from AuthContext to determine if initial auth processing is done
  if (!initialAuthCheckComplete || loading) { // Also check general loading state
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

  // Allow access to public pages unless it's an adminOnly public page (which shouldn't exist)
  if (isPublicPage && !adminOnly) {
    return <>{children}</>;
  }

  // If no user, and it's not a public page
  if (!user) {
    if (typeof window !== "undefined") {
      localStorage.setItem("redirectAfterLogin", pathname + window.location.search);
    }
    setTimeout(() => setShowLoginModal(true), 0); // Defer to avoid issues during render
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
    const userDashboard = user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
    router.push(userDashboard);
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Redirecting...</p>
      </div>
    );
  }

  // Allow access to profile settings page for any authenticated user.
  // AuthContext will handle redirecting TO it if incomplete, or AWAY if completed.
  if (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
    return <>{children}</>;
  }
  
  // If profile is incomplete and user is trying to access a page other than profile settings or public pages
  // AuthContext is responsible for redirecting them to AUTHOR_PROFILE_SETTINGS_PATH.
  // ProtectedRoute shows a loading/checking state while AuthContext processes this.
  if (!isProfileComplete && !isPublicPage) {
    // AuthContext should have already initiated a redirect if needed.
    // This state indicates we are waiting for that redirect or for profile to be completed.
    // console.log(`ProtectedRoute: User ${user.email} profile incomplete on ${pathname}. AuthContext should handle redirect.`);
    return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <LoadingSpinner size={48} />
            <p className="ml-2">Checking profile status...</p>
        </div>
    );
  }

  // If all checks pass, render the children
  return <>{children}</>;
};

export default ProtectedRoute;
