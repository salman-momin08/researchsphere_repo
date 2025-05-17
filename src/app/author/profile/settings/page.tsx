// app/author/profile/settings/page.tsx
"use client";

import ProtectedRoute from '@/components/auth/ProtectedRoute';
import ProfileUpdateForm from '@/components/profile/ProfileUpdateForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCog } from "lucide-react";
import { useSearchParams } from "next/navigation"; // Ensure this is imported

// This is the main content of the page
function AuthorProfileSettingsPageContent() {
  const searchParams = useSearchParams(); // Needs to be called within a Client Component
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

// Wrapping the page with route protection
export default function AuthorProfileSettingsPage() {
  return (
    <ProtectedRoute>
      <AuthorProfileSettingsPageContent />
    </ProtectedRoute>
  );
}
