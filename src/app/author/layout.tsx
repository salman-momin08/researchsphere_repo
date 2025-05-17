
"use client"; // All layouts using hooks or context need to be client components

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
// You can add specific layout elements for the author section here if needed
// For example, a sub-navigation or specific styling wrapper

interface AuthorLayoutProps {
  children: React.ReactNode;
}

export default function AuthorLayout({ children }: AuthorLayoutProps) {
  return (
    <ProtectedRoute>
      {/* If you had an author-specific sidebar or sub-header, it would go here */}
      {/* For now, it just ensures the route is protected */}
      <div className="w-full"> {/* Ensure content takes full width if no specific layout needed */}
        {children}
      </div>
    </ProtectedRoute>
  );
}
