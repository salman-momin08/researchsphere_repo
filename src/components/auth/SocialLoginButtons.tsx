"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Chrome, Github } from "lucide-react"; // Chrome for Google, Github for Github

export default function SocialLoginButtons() {
  const { loginWithGoogle, loginWithGitHub } = useAuth();

  return (
    <>
      <Button variant="outline" className="w-full" onClick={loginWithGoogle}>
        <Chrome className="mr-2 h-4 w-4" /> Continue with Google
      </Button>
      <Button variant="outline" className="w-full" onClick={loginWithGitHub}>
        <Github className="mr-2 h-4 w-4" /> Continue with GitHub
      </Button>
    </>
  );
}
