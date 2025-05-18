
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

// Adjusted public paths to be more general for root-level public pages
const PUBLIC_PATHS_PATTERNS = [
  HOME_PATH, LOGIN_PATH, SIGNUP_PATH, FORGOT_PASSWORD_PATH,
  /^\/registration$/, /^\/key-committee$/, /^\/sample-templates$/,
  /^\/contact-us$/, /^\/search-papers$/, /^\/terms$/, /^\/privacy$/
  // Note: Individual paper view (/papers/[id]) is public for 'Published' papers,
  // but direct access here without specific data can be tricky.
  // Access control for /papers/[id] is better handled within the page itself based on paper status and user role.
];


interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdmin, isProfileComplete, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsFromHook = useNextSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    if (loading) {
      return; // Wait for AuthContext to finish loading
    }

    const isPublicPage = PUBLIC_PATHS_PATTERNS.some(pattern =>
      typeof pattern === 'string' ? pattern === pathname : pattern.test(pathname)
    );

    // Allow access to profile settings page for authenticated users needing to complete profile
    if (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
        if (!user) { // If not logged in, AuthContext will trigger login modal via its own logic or next condition
             const redirectPath = pathname + (searchParamsFromHook ? `?${searchParamsFromHook.toString()}` : "");
            if (typeof window !== "undefined") localStorage.setItem("redirectAfterLogin", redirectPath);
            if(!showLoginModal) setShowLoginModal(true);
        }
        return; // Allow rendering of profile settings page for logged-in users
    }


    if (!user) { // User is not logged in
      if (!isPublicPage) { // And it's not a public page
        const redirectPath = pathname + (searchParamsFromHook ? `?${searchParamsFromHook.toString()}` : "");
        if (typeof window !== "undefined") {
            localStorage.setItem("redirectAfterLogin", redirectPath);
        }
        if (!showLoginModal) {
          setShowLoginModal(true);
        }
      }
      return; // Stop further checks if no user and handled
    }

    // User is logged in (user object exists)
    if (adminOnly && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this admin page.",
        variant: "destructive",
      });
      router.push(user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH);
      return;
    }

    // AuthContext now handles the primary redirection for incomplete profiles.
    // ProtectedRoute just ensures that if user is logged in, they can access their stuff.
    // If AuthContext determined profile is incomplete and redirected to settings, this component will allow that page to render.

  }, [user, loading, isAdmin, adminOnly, pathname, router, showLoginModal, setShowLoginModal, toast, searchParamsFromHook, isProfileComplete]);


  if (loading) {
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

  // If user is not logged in AND it's not a public page AND not the profile settings page,
  // AuthContext should have triggered the login modal. Show a placeholder.
  if (!user && !isPublicPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH+'?')) {
     return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <LoadingSpinner size={48} />
            <p className="ml-2">Authentication Required</p>
        </div>
    );
  }

  // If adminOnly is true and user is not admin (and user is loaded), this should have been caught by useEffect.
  // But as a final guard before rendering children:
  if (adminOnly && user && !isAdmin) {
    // This state indicates user is logged in, not admin, but trying to access adminOnly.
    // The useEffect should have redirected. If we reach here, show loading while redirect happens.
    return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <LoadingSpinner size={48} />
            <p className="ml-2">Access Denied. Redirecting...</p>
        </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
