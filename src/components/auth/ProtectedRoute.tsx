
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';
const AUTHOR_DASHBOARD_PATH = '/author/dashboard'; // Added for clarity
const REVIEWER_DASHBOARD_PATH = '/reviewer/dashboard'; // Added

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
    // console.warn(`ProtectedRoute EFFECT: Path: ${pathname}, Loading: ${loading}, User: ${user?.id}, isAdmin (from context): ${isAdmin}, AdminOnly: ${adminOnly}, InitialCheck: ${initialCheckComplete}, ShowLoginModal: ${showLoginModal}`);
    
    if (loading) {
      return; 
    }
    
    if (!initialCheckComplete) {
      setInitialCheckComplete(true);
    }

    if (!user) {
      const isAuthPage = pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password";
      // Profile settings is itself a protected route, but AuthContext handles redirecting to it if incomplete.
      // ProtectedRoute here focuses on ensuring login if not on an auth page.
      if (!isAuthPage && pathname !== AUTHOR_PROFILE_SETTINGS_PATH && !pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?')) { 
          // console.warn(`ProtectedRoute: No user for protected path ${pathname}. Setting redirectAfterLogin and requesting login modal.`);
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
      // console.warn(`ProtectedRoute: Admin access DENIED. Path: ${pathname}, User: ${user.id}, isAdmin (from context): ${isAdmin}. Redirecting.`);
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this admin page.",
        variant: "destructive",
      });
      const targetDashboard = user.role === "Reviewer" ? REVIEWER_DASHBOARD_PATH : AUTHOR_DASHBOARD_PATH;
      router.push(targetDashboard);
      return;
    }
    
    // console.log(`ProtectedRoute: Access GRANTED or handled by AuthContext. Path: ${pathname}, User: ${user.id}, isAdmin (from context): ${isAdmin}`);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, isAdmin, adminOnly, pathname, router, showLoginModal, setShowLoginModal, initialCheckComplete, toast]);


  if (loading || (!initialCheckComplete && !user)) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Verifying access...</p>
      </div>
    );
  }
  
  if (initialCheckComplete && !user && 
      !(pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password" || pathname === HOME_PATH || 
        pathname === '/registration' || pathname === '/key-committee' || pathname === '/sample-templates' || 
        pathname === '/contact-us' || pathname === '/search-papers' || pathname === '/terms' || pathname === '/privacy' ||
        pathname === AUTHOR_PROFILE_SETTINGS_PATH || pathname.startsWith(AUTHOR_PROFILE_SETTINGS_PATH + '?'))
     ) {
    // This case implies user should be prompted for login by AuthContext,
    // or if AuthContext decided no user and setShowLoginModal(true),
    // this acts as a temporary loading screen before modal or if modal is handled elsewhere.
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
