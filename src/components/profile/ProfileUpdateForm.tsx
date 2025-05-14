
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
import { Loader2, CheckCircle, AlertTriangle, UserCog, Info } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParams, useRouter } from "next/navigation";

// Schema for updating/completing profile
const profileUpdateSchema = z.object({
  displayName: z.string().min(3, { message: "Full name must be at least 3 characters." }),
  username: z.string()
    .min(4, { message: "Username must be 4-20 characters." })
    .max(20, { message: "Username must be 4-20 characters." })
    .regex(/^[a-zA-Z0-9_]+$/, { message: "Username can only contain letters, numbers, and underscores." }),
  role: z.enum(["Author", "Reviewer"], { required_error: "Please select a role." }),
  phoneNumber: z.string().optional().or(z.literal("")).refine(val => !val || /^\+?\d[\d-]{7,14}$/.test(val), {
    message: "Invalid phone number format (e.g., +1-1234567890).",
  }),
  institution: z.string().optional().or(z.literal("")).refine(val => !val || val.length >= 2, {
    message: "Institution must be at least 2 characters if provided.",
  }),
  researcherId: z.string().optional().or(z.literal("")).refine(val => !val || /(^(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$)|(^[a-zA-Z0-9]+$)/.test(val), {
    message: "Invalid Researcher ID or ORCID format (e.g., 0000-0001-2345-6789 or alphanumeric).",
  }),
});

type ProfileUpdateFormValues = z.infer<typeof profileUpdateSchema>;

export default function ProfileUpdateForm() {
  const { user, updateUserProfile, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const isCompletingProfile = searchParams.get('complete') === 'true';

  const form = useForm<ProfileUpdateFormValues>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      displayName: user?.displayName || "",
      username: user?.username || "",
      role: user?.role === "Author" || user?.role === "Reviewer" ? user.role : undefined,
      phoneNumber: user?.phoneNumber || "",
      institution: user?.institution || "",
      researcherId: user?.researcherId || "",
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        displayName: user.displayName || "",
        username: user.username || "",
        role: user.role === "Author" || user.role === "Reviewer" ? user.role : undefined,
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
      await updateUserProfile(data); 
      setSuccessMessage("Profile updated successfully!");
      toast({ title: "Success", description: "Your profile has been updated." });
      
      if (isCompletingProfile && data.username && data.role) {
        localStorage.removeItem('profileIncomplete');
        setTimeout(() => router.push('/dashboard'), 1000); 
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage);
      toast({ variant: "destructive", title: "Update Failed", description: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading && !user) {
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
      {isCompletingProfile && (
        <Alert variant="default" className="bg-primary/10 border-primary/30">
            <Info className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">Complete Your Profile</AlertTitle>
            <AlertDescription>
                Welcome! Please fill in the required details (Username and Role) to complete your profile setup.
            </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Update Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && !isCompletingProfile && (
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
          disabled
          className="bg-muted/50"
        />
         <p className="text-xs text-muted-foreground mt-1">Email address cannot be changed here.</p>
      </div>

      <div>
        <Label htmlFor="displayName">Full Name *</Label>
        <Input
          id="displayName"
          {...form.register("displayName")}
          disabled={isSubmitting || authLoading}
          placeholder="Enter your full name"
        />
        {form.formState.errors.displayName && (
          <p className="text-sm text-destructive mt-1">{form.formState.errors.displayName.message}</p>
        )}
      </div>
      
      <div>
        <Label htmlFor="username">Username * (letters, numbers, and underscores only)</Label>
        <Input 
            id="username" 
            {...form.register("username")} 
            disabled={isSubmitting || authLoading}
            placeholder="Choose a unique username"
        />
        {form.formState.errors.username && <p className="text-sm text-destructive mt-1">{form.formState.errors.username.message}</p>}
      </div>
      
      <div>
        <Label htmlFor="role">Role *</Label>
        <Select 
            onValueChange={(value) => form.setValue("role", value as "Author" | "Reviewer", { shouldValidate: true })} 
            defaultValue={user?.role === "Author" || user?.role === "Reviewer" ? user.role : undefined}
            disabled={isSubmitting || authLoading}
        >
          <SelectTrigger id="role">
            <SelectValue placeholder="Select your role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Author">Author</SelectItem>
            <SelectItem value="Reviewer">Reviewer</SelectItem>
          </SelectContent>
        </Select>
        {form.formState.errors.role && <p className="text-sm text-destructive mt-1">{form.formState.errors.role.message}</p>}
      </div>

      <div>
        <Label htmlFor="phoneNumber">Phone Number (Optional)</Label>
        <Input 
            id="phoneNumber" 
            placeholder="+1-1234567890" 
            {...form.register("phoneNumber")} 
            disabled={isSubmitting || authLoading}
        />
        {form.formState.errors.phoneNumber && <p className="text-sm text-destructive mt-1">{form.formState.errors.phoneNumber.message}</p>}
      </div>

      <div>
        <Label htmlFor="institution">Institution or Organization (Optional)</Label>
        <Input 
            id="institution" 
            {...form.register("institution")} 
            disabled={isSubmitting || authLoading}
            placeholder="Your university or company"
        />
        {form.formState.errors.institution && <p className="text-sm text-destructive mt-1">{form.formState.errors.institution.message}</p>}
      </div>
      
      <div>
        <Label htmlFor="researcherId">ORCID ID / Researcher ID (Optional)</Label>
        <Input 
            id="researcherId" 
            placeholder="e.g., 0000-0001-2345-6789" 
            {...form.register("researcherId")} 
            disabled={isSubmitting || authLoading}
        />
        {form.formState.errors.researcherId && <p className="text-sm text-destructive mt-1">{form.formState.errors.researcherId.message}</p>}
      </div>


      <Button type="submit" className="w-full" disabled={isSubmitting || authLoading}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        {isSubmitting ? "Saving..." : (isCompletingProfile ? "Complete Profile & Save" : "Save Changes")}
      </Button>
    </form>
  );
}

