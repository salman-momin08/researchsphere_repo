"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Chrome, Github, Loader2 } from "lucide-react"; // Chrome for Google, Github for Github

export default function SocialLoginButtons() {
  const { loginWithGoogle, loginWithGitHub, loading } = useAuth();

  return (
    <>
      <Button variant="outline" className="w-full" onClick={loginWithGoogle} disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Chrome className="mr-2 h-4 w-4" />}
        Continue with Google
      </Button>
      <Button variant="outline" className="w-full" onClick={loginWithGitHub} disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Github className="mr-2 h-4 w-4" />}
        Continue with GitHub
      </Button>
    </>
  );
}
