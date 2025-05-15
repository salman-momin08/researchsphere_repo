// Removed "use client" as it's not strictly needed for this simple component
// if it doesn't use client-specific hooks directly, though it's harmless.
// For consistency with other UI components, it can be kept if preferred.
"use client"; 

import * as React from "react"; // Import React for React.memo
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils"; // Assuming cn might be used in future enhancements

interface LoadingSpinnerProps {
  size?: number;
  className?: string; // Allow passing additional classes
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = React.memo(({ size = 24, className }) => {
  return (
    <div className={cn("flex justify-center items-center h-full w-full", className)}>
      <Loader2 className="animate-spin text-primary" style={{ height: `${size}px`, width: `${size}px` }} />
    </div>
  );
});

LoadingSpinner.displayName = 'LoadingSpinner';

export default LoadingSpinner;