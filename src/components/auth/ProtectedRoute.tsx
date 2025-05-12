"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export default function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        // For direct page access, redirect to login. Modal is for in-page actions.
        // Store the intended path to redirect back after login.
        localStorage.setItem('redirectAfterLogin', pathname);
        router.push("/login");
      } else if (adminOnly && !isAdmin) {
        // If route is admin-only and user is not admin, redirect to dashboard or home.
        router.push("/dashboard"); 
        // Optionally, show a toast message for unauthorized access.
      }
    }
  }, [user, loading, isAdmin, adminOnly, router, pathname, setShowLoginModal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  if (!user || (adminOnly && !isAdmin)) {
    // This case should ideally be handled by the redirect, but as a fallback:
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Redirecting...</p>
        <LoadingSpinner size={48} />
      </div>
    );
  }
  
  return <>{children}</>;
}
