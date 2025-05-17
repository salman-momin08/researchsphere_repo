"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const AUTHOR_PROFILE_SETTINGS_PATH = '/author/profile/settings';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { user, loading, isAdmin, showLoginModal, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [modalOpenAttempted, setModalOpenAttempted] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (loading) return;

    const isAuthPage = ['/login', '/signup', '/forgot-password'].includes(pathname);
    const isPublicPage = [
      '/', '/terms', '/privacy', '/contact-us',
      '/key-committee', '/sample-templates', '/registration', '/search-papers'
    ].includes(pathname) || pathname.startsWith('/papers/');

    if (!user) {
      if (!isAuthPage && !isPublicPage) {
        if (typeof window !== "undefined") {
          localStorage.setItem("redirectAfterLogin", pathname);
        }

        if (!showLoginModal && !modalOpenAttempted) {
          setShowLoginModal(true);
          setModalOpenAttempted(true);
        }
      } else {
        setModalOpenAttempted(false);
      }
      return;
    }

    setModalOpenAttempted(false);

    const isProfileComplete = !!(user.username && user.role && user.phoneNumber);

    if (
      !isProfileComplete &&
      pathname !== AUTHOR_PROFILE_SETTINGS_PATH &&
      !pathname.startsWith(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`)
    ) {
      // Do nothing: AuthContext will redirect to profile completion page.
      return;
    }

    if (adminOnly && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this page.",
        variant: "destructive",
      });
      router.push(user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard");
    }
  }, [user, loading, pathname, isAdmin, adminOnly, showLoginModal, modalOpenAttempted, setShowLoginModal, toast, router]);

  // Initial loading screen
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  const isProtectedPath = pathname.startsWith('/author/') || pathname.startsWith('/reviewer/') || (adminOnly && pathname.startsWith('/admin/'));

  if (!user && isProtectedPath) {
    if (!showLoginModal && !modalOpenAttempted) {
      return (
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
          <LoadingSpinner size={48} />
          <p className="ml-2">Loading authentication...</p>
        </div>
      );
    }

    if (pathname === AUTHOR_PROFILE_SETTINGS_PATH && !showLoginModal) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
          <LockKeyhole className="h-16 w-16 text-muted-foreground mb-6" />
          <h2 className="text-2xl font-semibold mb-3">Authentication Required</h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            You need to be logged in to access this page.
          </p>
        </div>
      );
    }

    return null;
  }

  if (adminOnly && user && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-4">
        <ShieldAlert className="h-16 w-16 text-destructive mb-6" />
        <h2 className="text-2xl font-semibold mb-3">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          You do not have the necessary permissions to view this page.
        </p>
        <Button
          onClick={() => router.push(user.role === "Reviewer" ? "/reviewer/dashboard" : "/author/dashboard")}
          className="mt-4"
        >
          Go to Your Dashboard
        </Button>
      </div>
    );
  }

  if (
    user &&
    (!user.username || !user.role || !user.phoneNumber) &&
    pathname !== AUTHOR_PROFILE_SETTINGS_PATH &&
    !pathname.startsWith(`${AUTHOR_PROFILE_SETTINGS_PATH}?complete=true`)
  ) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <LoadingSpinner size={48} />
        <p className="ml-2">Checking profile status...</p>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
