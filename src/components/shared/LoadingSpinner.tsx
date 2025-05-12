"use client";

import { Loader2 } from "lucide-react";
// Removed React import as React.memo is no longer used. Default functional components don't need explicit React import in modern Next.js/React.

interface LoadingSpinnerProps {
  size?: number;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 24 }) => {
  return (
    <div className="flex justify-center items-center h-full w-full">
      <Loader2 className="animate-spin text-primary" style={{ height: `${size}px`, width: `${size}px` }} />
    </div>
  );
};

LoadingSpinner.displayName = 'LoadingSpinner';

export default LoadingSpinner;
