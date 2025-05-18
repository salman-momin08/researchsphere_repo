
"use client";

import ProtectedRoute from '@/components/auth/ProtectedRoute';
import ProfileUpdateForm from '@/components/profile/ProfileUpdateForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCog } from "lucide-react";
import { useSearchParams as useNextSearchParams } from "next/navigation"; // Renamed to avoid conflict
import React, { Suspense } from 'react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// This internal component uses the hook
function AdminProfileSettingsPageContent() {
  // For admins, the 'complete' flow might still use the author path if their core profile is missing,
  // but this page is for general updates once their profile is established.
  // We don't typically expect admins to go through the '?complete=true' flow via this admin-specific page.
  const searchParams = useNextSearchParams();
  const isCompletingProfile = searchParams.get('complete') === 'true'; // Less relevant here, but kept for consistency with form

  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="w-full max-w-lg mx-auto shadow-xl">
        <CardHeader className="text-center">
          <UserCog className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl md:text-3xl">
            Admin Profile Settings
          </CardTitle>
          <CardDescription>
            Update your personal information and preferences.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileUpdateForm />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminProfileSettingsPage() {
  return (
    // This page is already under /admin/, so ProtectedRoute with adminOnly handles access.
    // The inner ProtectedRoute around ProfileUpdateForm might be redundant if
    // AdminLayout already has adminOnly={true}.
    // However, keeping it ensures the ProfileUpdateForm itself can also be protected if used elsewhere.
    <ProtectedRoute adminOnly={true}> {/* Ensures only admins can access this admin-specific settings page */}
      <Suspense fallback={<div className="flex justify-center items-center h-screen"><LoadingSpinner /></div>}>
        <AdminProfileSettingsPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
