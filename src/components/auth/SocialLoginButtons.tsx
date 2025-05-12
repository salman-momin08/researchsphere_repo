
"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Chrome, Github, Loader2 } from "lucide-react"; 
import { useState } from 'react';

export default function SocialLoginButtons() {
  const { loginWithGoogle, loginWithGitHub, loading: authGlobalLoading } = useAuth();
  const [processingProvider, setProcessingProvider] = useState<null | 'google' | 'github'>(null);

  const handleGoogleLogin = async () => {
    setProcessingProvider('google');
    try {
      await loginWithGoogle();
    } catch (error) {
      // Error is already handled by toast in AuthContext, but can log here if needed
      console.error("SocialLoginButtons: Google login error", error);
    } finally {
      setProcessingProvider(null);
    }
  };

  const handleGitHubLogin = async () => {
    setProcessingProvider('github');
    try {
      await loginWithGitHub();
    } catch (error) {
      // Error is already handled by toast in AuthContext
      console.error("SocialLoginButtons: GitHub login error", error);
    } finally {
      setProcessingProvider(null);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className="w-full"
        onClick={handleGoogleLogin}
        disabled={authGlobalLoading || (processingProvider !== null && processingProvider !== 'google')}
      >
        {(authGlobalLoading && processingProvider === 'google') ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Chrome className="mr-2 h-4 w-4" />
        )}
        Continue with Google
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={handleGitHubLogin}
        disabled={authGlobalLoading || (processingProvider !== null && processingProvider !== 'github')}
      >
        {(authGlobalLoading && processingProvider === 'github') ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Github className="mr-2 h-4 w-4" />
        )}
        Continue with GitHub
      </Button>
      <p className="text-xs text-muted-foreground text-center mt-2 px-2">
        Please ensure popups are enabled in your browser for social sign-in to work correctly.
      </p>
    </>
  );
}
