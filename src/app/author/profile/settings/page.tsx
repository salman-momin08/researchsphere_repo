
"use client";

import ProtectedRoute from '@/components/auth/ProtectedRoute';
import ProfileUpdateForm from '@/components/profile/ProfileUpdateForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCog } from "lucide-react";
import { useSearchParams as useNextSearchParams } from "next/navigation";
import React from 'react'; // Removed Suspense and LoadingSpinner imports

// This internal component uses the hook
function AuthorProfileSettingsPageContent() {
  const searchParams = useNextSearchParams();
  const isCompletingProfile = searchParams.get('complete') === 'true';

  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="w-full max-w-lg mx-auto shadow-xl">
        <CardHeader className="text-center">
          <UserCog className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl md:text-3xl">
            {isCompletingProfile ? "Complete Your Profile" : "Profile Settings"}
          </CardTitle>
          <CardDescription>
            {isCompletingProfile
              ? "Please provide the remaining details to finish setting up your account."
              : "Update your personal information and preferences."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileUpdateForm />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuthorProfileSettingsPage() {
  return (
    // ProtectedRoute ensures only authenticated users can access.
    // AuthContext will handle redirecting TO here if profile is incomplete.
    // AuthContext (via updateUserProfile) will handle redirecting AWAY if profile is completed.
    <ProtectedRoute> 
      <AuthorProfileSettingsPageContent />
    </ProtectedRoute>
  );
}
