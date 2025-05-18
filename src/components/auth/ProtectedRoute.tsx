
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
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
  const { user, loading, isAdminUser, setShowLoginModal, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  if (!initialAuthCheckComplete || loading) {
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

  if (isPublicPage) {
    return <>{children}</>;
  }

  // If no user and not on a public page or auth utility page, prompt login
  if (!user) {
    if (typeof window !== "undefined") {
      localStorage.setItem("redirectAfterLogin", pathname + window.location.search);
    }
    // Defer showing modal to a microtask to avoid issues during render
    setTimeout(() => setShowLoginModal(true), 0);
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
    const userDashboard = user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
    router.push(userDashboard);
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Redirecting...</p>
      </div>
    );
  }

  // Allow access to profile settings page if user is authenticated, AuthContext will handle incomplete profile logic
  if (pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
    return <>{children}</>;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

    