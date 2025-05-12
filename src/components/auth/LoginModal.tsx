"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LoginForm from "./LoginForm";
import SocialLoginButtons from "./SocialLoginButtons";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { LockKeyhole } from "lucide-react";

export default function LoginModal() {
  const { showLoginModal, setShowLoginModal } = useAuth();

  return (
    <Dialog open={showLoginModal} onOpenChange={setShowLoginModal}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 text-primary">
             <LockKeyhole size={48} strokeWidth={1.5}/>
          </div>
          <DialogTitle className="text-2xl font-bold">Login Required</DialogTitle>
          <DialogDescription>
            Please log in or create an account to continue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-2 py-4">
          <LoginForm />
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>
          <div className="space-y-3">
            <SocialLoginButtons />
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link 
              href="/signup" 
              className="font-medium text-primary hover:underline"
              onClick={() => setShowLoginModal(false)} // Close modal before navigating
            >
              Sign up
            </Link>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
