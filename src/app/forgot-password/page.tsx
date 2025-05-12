"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MailQuestion, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const forgotPasswordSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address." }),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { sendPasswordResetEmail } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    setIsLoading(true);
    setMessage(null);
    setIsSuccess(false);
    try {
      await sendPasswordResetEmail(data.email);
      setMessage("If an account with that email exists, a password reset link has been sent.");
      setIsSuccess(true);
      form.reset(); 
      toast({
        title: "Request Submitted",
        description: "If your email is registered, you'll receive a reset link.",
      });
    } catch (err) {
      // In a real app, you might get specific errors, but for password reset,
      // it's often better to show a generic message for security (to prevent email enumeration).
      setMessage("An error occurred while processing your request. Please try again later.");
      setIsSuccess(false);
       toast({
        variant: "destructive",
        title: "Error",
        description: "Could not process your request. Please try again later.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-secondary">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 text-primary">
            <MailQuestion size={48} strokeWidth={1.5} />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Forgot Your Password?</CardTitle>
          <CardDescription>
            Enter your email address and we&apos;ll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {message && (
            <Alert 
              variant={isSuccess ? "default" : "destructive"}
              className={isSuccess ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700" : ""}
            >
              {isSuccess ? <CheckCircle className="h-4 w-4 !text-green-700 dark:!text-green-400" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertTitle>{isSuccess ? "Check Your Email" : "Error"}</AlertTitle>
              <AlertDescription className={isSuccess ? "!text-green-700 dark:!text-green-400" : ""}>{message}</AlertDescription>
            </Alert>
          )}

          {!isSuccess && (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  {...form.register("email")}
                  disabled={isLoading}
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSuccess ? "Remembered it after all? " : "Remember your password? "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
