
"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Chrome, Github, Loader2 } from "lucide-react"; 
import { useState } from 'react';

export default function SocialLoginButtons() {
  const { loginWithGoogle, loginWithGitHub, isSocialLoginInProgress: authGlobalLoading, /* loading: authGlobalLoading - replaced */ } = useAuth();
  // Use local state to track which button was clicked, for individual spinner
  const [processingProvider, setProcessingProvider] = useState<null | 'google' | 'github'>(null);


  const handleGoogleLogin = async () => {
    setProcessingProvider('google');
    try {
      await loginWithGoogle();
      // Success is handled by onAuthStateChanged
    } catch (error) {
      // Error is already handled by toast in AuthContext
      console.error("SocialLoginButtons: Google login error caught (already handled by context)", error);
    } finally {
       // setActiveSocialLoginProvider(null) is handled in AuthContext
       // No need to setProcessingProvider(null) here if it's handled globally by onAuthStateChanged
    }
  };

  const handleGitHubLogin = async () => {
    setProcessingProvider('github');
    try {
      await loginWithGitHub();
      // Success is handled by onAuthStateChanged
    } catch (error) {
      // Error is already handled by toast in AuthContext
      console.error("SocialLoginButtons: GitHub login error caught (already handled by context)", error);
    } finally {
      // setActiveSocialLoginProvider(null) is handled in AuthContext
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
      {/* Removed instructional paragraph about popups as the error message is now clearer */}
    </>
  );
}
