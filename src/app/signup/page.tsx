"use client";

import Link from "next/link";
import SignupForm from "@/components/auth/SignupForm";
import SocialLoginButtons from "@/components/auth/SocialLoginButtons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BookOpenText, UserPlus } from "lucide-react";

export default function SignupPage() {
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-secondary">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
           <div className="mx-auto mb-4 h-12 w-12 text-primary">
             <UserPlus size={48} strokeWidth={1.5}/>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Create your ResearchSphere Account</CardTitle>
          <CardDescription>
            Join our platform to submit and manage your research papers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignupForm />
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-card px-2 text-muted-foreground">
                Or sign up with
              </span>
            </div>
          </div>
          <div className="space-y-3">
            <SocialLoginButtons />
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
