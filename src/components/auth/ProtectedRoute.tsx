
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
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !initialAuthCheckComplete || loading) {
      return;
    }

    const isPublicPage = PUBLIC_PATHS_PATTERNS.some(pattern =>
      typeof pattern === 'string' ? pattern === pathname : pattern.test(pathname)
    );

    // Allow access to public pages unless it's an adminOnly public page (which shouldn't exist)
    if (isPublicPage && !adminOnly) {
      return;
    }

    if (!user) {
      if (pathname !== AUTHOR_PROFILE_SETTINGS_PATH && // Allow unauthenticated users to *potentially* land here if redirected
          !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?') &&
          !isPublicPage) {
        if (typeof window !== "undefined") {
          localStorage.setItem("redirectAfterLogin", pathname + window.location.search);
        }
        setShowLoginModal(true);
      }
      return; // Early return for unauthenticated users on potentially public or login-redirecting paths
    }

    // User is authenticated at this point
    if (adminOnly && !isAdminUser) {
      toast({ title: "Access Denied", description: "You do not have permission to view this admin page.", variant: "destructive" });
      const userDashboard = user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
      router.push(userDashboard);
      return;
    }

    // If an admin tries to access a non-admin profile settings page (authors')
    if (isAdminUser && pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH)) {
        router.push(ADMIN_DASHBOARD_PATH); // Or to admin profile settings if one exists
        return;
    }


  }, [isMounted, initialAuthCheckComplete, loading, user, isAdminUser, adminOnly, pathname, router, setShowLoginModal, toast]);


  if (!isMounted || !initialAuthCheckComplete || loading) {
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

  if (!user && !isPublicPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) {
     // This case should be handled by setShowLoginModal above and AuthContext will render its initial loading.
     // Or, show a specific "Redirecting to login..." message if preferred.
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Redirecting to login...</p>
      </div>
    );
  }
  
  // If adminOnly is true, but user is not an admin (and user is loaded)
  if (user && adminOnly && !isAdminUser) {
    // This will be caught by the useEffect, but this return prevents rendering children prematurely
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
