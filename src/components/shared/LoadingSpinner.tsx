"use client";

import { Loader2 } from "lucide-react";
import React from "react"; // Import React for React.memo

interface LoadingSpinnerProps {
  size?: number;
}

// Wrap the component with React.memo
const LoadingSpinner: React.FC<LoadingSpinnerProps> = React.memo(({ size = 24 }) => {
  return (
    <div className="flex justify-center items-center h-full w-full">
      <Loader2 className="animate-spin text-primary" style={{ height: `${size}px`, width: `${size}px` }} />
    </div>
  );
});

// It's good practice to set a displayName when using React.memo for easier debugging
LoadingSpinner.displayName = 'LoadingSpinner';

export default LoadingSpinner;
