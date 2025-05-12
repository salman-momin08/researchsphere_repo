
"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle, AlertTriangle } from "lucide-react";

const profileUpdateSchema = z.object({
  displayName: z.string().min(3, { message: "Full name must be at least 3 characters." }),
});

type ProfileUpdateFormValues = z.infer<typeof profileUpdateSchema>;

export default function ProfileUpdateForm() {
  const { user, updateUserProfile, loading: authLoading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const form = useForm<ProfileUpdateFormValues>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      displayName: user?.displayName || "",
    },
  });

  useEffect(() => {
    if (user?.displayName) {
      form.reset({ displayName: user.displayName });
    }
  }, [user, form]);

  const onSubmit = async (data: ProfileUpdateFormValues) => {
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await updateUserProfile({ displayName: data.displayName });
      setSuccessMessage("Profile updated successfully!");
      toast({ title: "Success", description: "Your profile has been updated." });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage);
      toast({ variant: "destructive", title: "Update Failed", description: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return <div className="flex justify-center py-4"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!user) {
     return (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>User not found. Please log in again.</AlertDescription>
        </Alert>
     );
  }


  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Update Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
        <Alert variant="default" className="border-green-500 bg-green-50 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
            <CheckCircle className="h-4 w-4 !text-green-700 dark:!text-green-400" />
            <AlertTitle>Success!</AlertTitle>
            <AlertDescription className="!text-green-700 dark:!text-green-400">{successMessage}</AlertDescription>
        </Alert>
      )}
      
      <div>
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          type="email"
          value={user.email || ""}
          disabled // Email is typically not changed by the user directly in this manner
          className="bg-muted/50"
        />
         <p className="text-xs text-muted-foreground mt-1">Email address cannot be changed here.</p>
      </div>

      <div>
        <Label htmlFor="displayName">Full Name</Label>
        <Input
          id="displayName"
          {...form.register("displayName")}
          disabled={isSubmitting}
          placeholder="Enter your full name"
        />
        {form.formState.errors.displayName && (
          <p className="text-sm text-destructive mt-1">{form.formState.errors.displayName.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting || authLoading}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        {isSubmitting ? "Updating..." : "Update Profile"}
      </Button>
    </form>
  );
}
