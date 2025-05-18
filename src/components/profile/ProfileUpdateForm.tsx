
"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // Keep for disabled email
import { Label } from "@/components/ui/label";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle, AlertTriangle, Info } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { User } from "@/types"; // Import User type

const profileUpdateSchema = z.object({
  displayName: z.string().min(3, { message: "Full name must be at least 3 characters." }),
  username: z.string()
    .min(4, { message: "Username must be 4-20 characters." })
    .max(20, { message: "Username must be 4-20 characters." })
    .regex(/^[a-zA-Z0-9_]+$/, { message: "Username can only contain letters, numbers, and underscores." }),
  role: z.enum(["Author", "Reviewer", "Admin"], { required_error: "Please select a role." }), // Added "Admin" here for form state, actual setting is controlled.
  phoneNumber: z.string().min(1, "Phone number is required.").regex(/^\+?\d[\d\s-]{7,14}$/, {
    message: "Invalid phone number format (e.g., +1-123-456-7890 or +91 9876543210).",
  }),
  institution: z.string().optional().or(z.literal("")).refine(val => !val || val.length >= 2, {
    message: "Institution must be at least 2 characters if provided.",
  }),
  researcherId: z.string().optional().or(z.literal("")).refine(val => !val || /(^(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$)|(^[a-zA-Z0-9]+$)/.test(val), {
    message: "Invalid Researcher ID or ORCID format (e.g., 0000-0001-2345-6789 or alphanumeric).",
  }),
});

// Use Omit to exclude 'email' as it's not part of the updatable form fields
export type ProfileUpdateFormValues = Omit<z.infer<typeof profileUpdateSchema>, 'email'>;


export default function ProfileUpdateForm() {
  const { user, updateUserProfile, loading: authLoading, isAdminUser } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const isCompletingProfile = searchParams.get('complete') === 'true';

  const form = useForm<ProfileUpdateFormValues>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: { // Will be overridden by useEffect
      displayName: "",
      username: "",
      role: undefined,
      phoneNumber: "",
      institution: "",
      researcherId: "",
    },
  });

  useEffect(() => {
    if (user) {
      // console.log("ProfileUpdateForm: User data from context:", user);
      // console.log("ProfileUpdateForm: Setting form default values with role:", user.role);
      form.reset({
        displayName: user.displayName || "",
        username: user.username || "",
        // Ensure role is one of the enum values or undefined if not set.
        // Handle potential null from Firestore by mapping to undefined for the Select.
        role: user.role && ["Author", "Reviewer", "Admin"].includes(user.role) ? user.role as "Author" | "Reviewer" | "Admin" : undefined,
        phoneNumber: user.phoneNumber || "",
        institution: user.institution || "",
        researcherId: user.researcherId || "",
      });
    }
  }, [user, form]);

  const onSubmit = async (data: ProfileUpdateFormValues) => {
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const profileDataToUpdate: Partial<User> = { ...data };
      await updateUserProfile(profileDataToUpdate); 
      // Redirection logic is now primarily handled by AuthContext after state update
      setSuccessMessage("Profile updated successfully!");
      // toast({ title: "Success", description: "Your profile has been updated." }); // AuthContext handles toast for success
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage); 
      if (errorMessage !== "Username already taken. Please choose another one." &&
          errorMessage !== "Phone number already in use by another account." &&
          errorMessage !== "Phone number already in use. Please use a different one.") {
        // Generic toast is handled by AuthContext if specific validation errors aren't caught by its specific toasts
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentIsLoading = isSubmitting || authLoading;

  if (authLoading && !user && !isMounted) { // Show spinner only if truly loading initial auth state
    return <div className="flex justify-center py-4"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <p className="ml-2">Loading profile...</p></div>;
  }
  
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div className="flex justify-center py-4"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <p className="ml-2">Loading profile form...</p></div>;
  }


  if (!user) { // Should be caught by ProtectedRoute, but as a fallback UI
     return (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Authentication Error</AlertTitle>
          <AlertDescription>User not found or not authenticated. Please log in to view or update your profile.</AlertDescription>
           <Button onClick={() => router.push('/login')} className="mt-2">Go to Login</Button>
        </Alert>
     );
  }


  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
      {isCompletingProfile && (
        <Alert variant="default" className="bg-primary/10 border-primary/30 mb-4">
            <Info className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary font-semibold">Complete Your Profile</AlertTitle>
            <AlertDescription className="text-primary/90">
                Welcome! Please fill in/verify the required details (Username, Role, and Phone Number) to complete your profile setup.
            </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Update Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && !isCompletingProfile && ( // Only show success if not in "complete profile" flow which redirects
        <Alert variant="default" className="border-green-500 bg-green-50 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700 mb-4">
            <CheckCircle className="h-4 w-4 !text-green-700 dark:!text-green-400" />
            <AlertTitle className="font-semibold">Success!</AlertTitle>
            <AlertDescription className="!text-green-700 dark:!text-green-400">{successMessage}</AlertDescription>
        </Alert>
      )}
      
      <div className="pt-2">
        <Label htmlFor="email" className="text-muted-foreground">Email Address (Cannot be changed)</Label>
        <Input
          id="email"
          type="email"
          value={user.email || ""}
          disabled
          className="bg-muted/50 mt-1 h-10"
        />
      </div>

      <AnimatedInput
        label="Full Name *"
        id="displayName" 
        {...form.register("displayName")} 
        disabled={currentIsLoading}
      />
      {form.formState.errors.displayName && (
        <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.displayName.message}</p>
      )}
      
      <AnimatedInput
        label="Username *"
        id="username" 
        {...form.register("username")} 
        disabled={currentIsLoading}
      />
      {form.formState.errors.username && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.username.message}</p>}
      
      <div className="pt-2">
        <Label htmlFor="role" className={cn(form.formState.errors.role ? "text-destructive" : "", "text-muted-foreground")}>Role *</Label>
        <Select 
            onValueChange={(value) => form.setValue("role", value as "Author" | "Reviewer" | "Admin", { shouldValidate: true })} 
            value={form.watch("role")}
            disabled={currentIsLoading || (!isAdminUser && user.role === "Admin")} // Non-admin cannot change role if already admin
        >
          <SelectTrigger id="role" className="h-10 mt-1">
            <SelectValue placeholder="Select your role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Author">Author</SelectItem>
            <SelectItem value="Reviewer">Reviewer</SelectItem>
            {/* Admin role is typically not self-selectable unless by another admin */}
            {isAdminUser && <SelectItem value="Admin">Admin (System)</SelectItem>}
          </SelectContent>
        </Select>
        {form.formState.errors.role && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.role.message}</p>}
      </div>

      <AnimatedInput
        label="Phone Number *"
        id="phoneNumber" 
        {...form.register("phoneNumber")} 
        disabled={currentIsLoading}
      />
      {form.formState.errors.phoneNumber && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.phoneNumber.message}</p>}

      <AnimatedInput
        label="Institution or Organization (Optional)"
        id="institution" 
        {...form.register("institution")} 
        disabled={currentIsLoading}
      />
      {form.formState.errors.institution && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.institution.message}</p>}
      
      <AnimatedInput
        label="ORCID ID / Researcher ID (Optional)"
        id="researcherId" 
        {...form.register("researcherId")} 
        disabled={currentIsLoading}
      />
      {form.formState.errors.researcherId && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.researcherId.message}</p>}


      <Button type="submit" className="w-full mt-4" disabled={currentIsLoading}>
        {currentIsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {currentIsLoading ? "Saving..." : (isCompletingProfile ? "Complete Profile & Save" : "Save Changes")}
      </Button>
    </form>
  );
}

    