
"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(_: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // You can also log the error to an error reporting service
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-background">
          <Alert variant="destructive" className="max-w-md">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle className="text-xl font-semibold">Oops! Something went wrong.</AlertTitle>
            <AlertDescription className="mt-2 text-md">
              We encountered an unexpected error. Please try refreshing the page.
              If the problem persists, please contact support.
            </AlertDescription>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4 p-2 text-left bg-muted/50 rounded text-xs overflow-auto max-h-60">
                <summary className="cursor-pointer font-medium">Error Details (Development)</summary>
                <pre className="mt-2 whitespace-pre-wrap">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </Alert>
          <Button onClick={this.handleReload} className="mt-6">
            Refresh Page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
