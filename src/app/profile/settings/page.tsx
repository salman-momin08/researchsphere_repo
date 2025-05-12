
"use client";

import ProtectedRoute from "@/components/auth/ProtectedRoute";
import ProfileUpdateForm from "@/components/profile/ProfileUpdateForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCog } from "lucide-react";

function ProfileSettingsContent() {
  return (
    <div className="container py-8 md:py-12 px-4">
      <Card className="w-full max-w-lg mx-auto shadow-xl">
        <CardHeader className="text-center">
          <UserCog className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl md:text-3xl">Profile Settings</CardTitle>
          <CardDescription>
            Update your personal information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileUpdateForm />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfileSettingsPage() {
  return (
    <ProtectedRoute>
      <ProfileSettingsContent />
    </ProtectedRoute>
  );
}
