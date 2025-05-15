
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal, Loader2 } from "lucide-react";
import Link from "next/link";

const loginSchema = z.object({
  identifier: z.string().min(1, { message: "Email or Username is required." }),
  password: z.string().min(1, { message: "Password is required." }), // Min 1 for presence check, AuthContext handles actual length
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    setError(null);
    try {
      // The login function in AuthContext now handles email/username logic
      await login(data.identifier, data.password);
      toast({ title: "Login Successful", description: "Welcome back!" });
      // Redirect is handled by AuthContext
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage);
      // Toast is now handled by AuthContext for login errors to avoid duplication
      // toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2"> {/* Reduced space-y */}
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
        disabled={isLoading}
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
        disabled={isLoading}
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
      
      <Button type="submit" className="w-full mt-4" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isLoading ? "Logging in..." : "Log In"}
      </Button>
    </form>
  );
}
