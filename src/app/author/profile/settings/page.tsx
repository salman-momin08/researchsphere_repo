
"use client";

import ProtectedRoute from '@/components/auth/ProtectedRoute';
import ProfileUpdateForm from '@/components/profile/ProfileUpdateForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCog } from "lucide-react";
import { useSearchParams as useNextSearchParams } from "next/navigation"; // Renamed to avoid conflict
import React, { Suspense } from 'react'; // Added React import
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// This internal component uses the hook
function ProfileSettingsPageContent() {
  const searchParams = useNextSearchParams(); // Using the renamed hook
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
              : "Update your personal information."}
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
    <ProtectedRoute>
      <Suspense fallback={<div className="flex justify-center items-center h-screen"><LoadingSpinner /></div>}>
        <ProfileSettingsPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
