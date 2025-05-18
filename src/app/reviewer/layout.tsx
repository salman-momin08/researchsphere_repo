
"use client"; 

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
// Import other necessary components or hooks for reviewer layout if any
// For example, if you have a reviewer-specific sub-navigation or sidebar elements.

interface ReviewerLayoutProps {
  children: React.ReactNode;
}

export default function ReviewerLayout({ children }: ReviewerLayoutProps) {
  // You can add specific layout elements for reviewers here
  // e.g., a reviewer-specific sidebar or header section

  return (
    <ProtectedRoute> {/* Ensures only authenticated users can access reviewer routes */}
      {/* Additional role check for "Reviewer" can be done inside ProtectedRoute or here */}
      <div className="w-full">
        {/* Example: <ReviewerSpecificSubHeader /> */}
        {children}
      </div>
    </ProtectedRoute>
  );
}
