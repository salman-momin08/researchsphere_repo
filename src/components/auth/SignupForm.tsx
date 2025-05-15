
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal, Loader2 } from "lucide-react";
import Link from "next/link";

const signupSchema = z.object({
  fullName: z.string().min(3, { message: "Full name must be at least 3 characters." }),
  username: z.string()
    .min(4, { message: "Username must be 4-20 characters." })
    .max(20, { message: "Username must be 4-20 characters." })
    .regex(/^[a-zA-Z0-9_]+$/, { message: "Username can only contain letters, numbers, and underscores." }),
  email: z.string().email({ message: "Invalid email address." }),
  confirmEmail: z.string().email({ message: "Invalid email address." }),
  password: z.string()
    .min(8, { message: "Password must be at least 8 characters." })
    .regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, { message: "Password must include at least one letter, one number, and can contain special characters." }),
  confirmPassword: z.string(),
  phoneNumber: z.string().min(1, "Phone number is required.").regex(/^\+?\d[\d\s-]{7,14}$/, { // Updated regex for more flexibility
    message: "Invalid phone number format (e.g., +1-123-456-7890 or +91 9876543210).",
  }),
  institution: z.string().optional().or(z.literal("")).refine(val => !val || val.length >= 2, {
    message: "Institution must be at least 2 characters if provided.",
  }),
  role: z.enum(["Author", "Reviewer"], { required_error: "Please select a role." }),
  researcherId: z.string().optional().or(z.literal("")).refine(val => !val || /(^(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$)|(^[a-zA-Z0-9]+$)/.test(val), {
    message: "Invalid Researcher ID or ORCID format (e.g., 0000-0001-2345-6789 or alphanumeric).",
  }),
  termsAccepted: z.boolean().refine(val => val === true, {
    message: "You must accept the terms and conditions.",
  }),
})
.refine(data => data.email === data.confirmEmail, {
  message: "Emails don't match.",
  path: ["confirmEmail"],
})
.refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match.",
  path: ["confirmPassword"],
});

export type SignupFormValues = z.infer<typeof signupSchema>;

export default function SignupForm() {
  const { signup } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      username: "",
      email: "",
      confirmEmail: "",
      password: "",
      confirmPassword: "",
      phoneNumber: "",
      institution: "",
      researcherId: "",
      termsAccepted: false,
    },
  });

  const onSubmit = async (data: SignupFormValues) => {
    setIsLoading(true);
    setError(null);
    try {
      await signup(data);
      toast({ title: "Signup Successful", description: "Welcome to ResearchSphere!" });
      // Redirect is handled by AuthContext
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage);
      toast({ variant: "destructive", title: "Signup Failed", description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2"> {/* Reduced space-y */}
      {error && (
         <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>Signup Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <AnimatedInput label="Full Name *" id="fullName" {...form.register("fullName")} disabled={isLoading} />
      {form.formState.errors.fullName && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.fullName.message}</p>}

      <AnimatedInput label="Username *" id="username" {...form.register("username")} disabled={isLoading} />
      {form.formState.errors.username && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.username.message}</p>}

      <AnimatedInput label="Email Address *" id="email" type="email" {...form.register("email")} disabled={isLoading} />
      {form.formState.errors.email && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.email.message}</p>}

      <AnimatedInput label="Confirm Email Address *" id="confirmEmail" type="email" {...form.register("confirmEmail")} disabled={isLoading} />
      {form.formState.errors.confirmEmail && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.confirmEmail.message}</p>}
      
      <AnimatedInput label="Password *" id="password" type="password" {...form.register("password")} disabled={isLoading} />
      {form.formState.errors.password && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.password.message}</p>}

      <AnimatedInput label="Confirm Password *" id="confirmPassword" type="password" {...form.register("confirmPassword")} disabled={isLoading} />
      {form.formState.errors.confirmPassword && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.confirmPassword.message}</p>}

      <AnimatedInput label="Phone Number *" id="phoneNumber" {...form.register("phoneNumber")} disabled={isLoading} />
      {form.formState.errors.phoneNumber && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.phoneNumber.message}</p>}

      <AnimatedInput label="Institution or Organization (Optional)" id="institution" {...form.register("institution")} disabled={isLoading} />
      {form.formState.errors.institution && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.institution.message}</p>}

      <div className="pt-2"> {/* Added pt-2 for spacing consistency with AnimatedInput */}
        <Label htmlFor="role" className={form.formState.errors.role ? "text-destructive" : ""}>Role *</Label>
        <Select onValueChange={(value) => form.setValue("role", value as "Author" | "Reviewer")} disabled={isLoading}>
          <SelectTrigger id="role" className="h-10">
            <SelectValue placeholder="Select your role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Author">Author</SelectItem>
            <SelectItem value="Reviewer">Reviewer</SelectItem>
          </SelectContent>
        </Select>
        {form.formState.errors.role && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.role.message}</p>}
      </div>

      <AnimatedInput label="ORCID ID / Researcher ID (Optional)" id="researcherId" {...form.register("researcherId")} disabled={isLoading} />
      {form.formState.errors.researcherId && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.researcherId.message}</p>}

      <div className="flex items-center space-x-2 pt-2">
        <Checkbox
            id="termsAccepted"
            checked={form.watch("termsAccepted")}
            onCheckedChange={(checked) => form.setValue("termsAccepted", Boolean(checked))}
            disabled={isLoading}
            aria-invalid={!!form.formState.errors.termsAccepted}
        />
        <Label htmlFor="termsAccepted" className={cn("text-sm font-normal", form.formState.errors.termsAccepted && "text-destructive")}>
          I accept the{" "}
          <Link href="/terms" target="_blank" className="underline text-primary hover:text-primary/80">
            Terms and Conditions
          </Link> *
        </Label>
      </div>
      {form.formState.errors.termsAccepted && <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.termsAccepted.message}</p>}

      <Button type="submit" className="w-full mt-4" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isLoading ? "Creating account..." : "Create Account"}
      </Button>
    </form>
  );
}
