
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { useAuth } from "@/hooks/use-auth";
// useRouter no longer needed here
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal, Loader2 } from "lucide-react";
import Link from "next/link";

const loginSchema = z.object({
  identifier: z.string().min(1, { message: "Email or Username is required." }),
  password: z.string().min(1, { message: "Password is required." }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginForm() {
  const { login, loading: authLoading } = useAuth(); // Use authLoading from context
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false); // Local submitting state for form

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await login(data.identifier, data.password);
      toast({ title: "Login Successful", description: "Welcome back!" });
      // Redirect is handled by AuthContext
      form.reset(); // Reset form on success
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage);
      // Toast is handled by AuthContext for login errors to avoid duplication
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const currentIsLoading = isSubmitting || authLoading;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>Login Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AnimatedInput
        id="identifier"
        label="Email or Username *"
        {...form.register("identifier")}
        disabled={currentIsLoading}
        autoComplete="username"
      />
      {form.formState.errors.identifier && (
        <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.identifier.message}</p>
      )}
      
      <AnimatedInput
        id="password"
        label="Password *"
        type="password"
        {...form.register("password")}
        disabled={currentIsLoading}
        autoComplete="current-password"
      />
      <div className="text-right mt-1">
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-primary hover:underline px-1"
        >
          Forgot password?
        </Link>
      </div>
      {form.formState.errors.password && (
        <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.password.message}</p>
      )}
      
      <Button type="submit" className="w-full mt-4" disabled={currentIsLoading}>
        {currentIsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {currentIsLoading ? "Logging in..." : "Log In"}
      </Button>
    </form>
  );
}
