// src/app/author/layout.tsx
"use client";

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
// You can add specific layout elements for the author section here if needed
// For example, a sub-navigation or specific styling wrapper

interface AuthorLayoutProps {
  children: React.ReactNode;
}

export default function AuthorLayout({ children }: AuthorLayoutProps) {
  // The ProtectedRoute here ensures that only authenticated users can access any page under /author/
  // The specific logic for profile completion vs. other pages within /author/
  // is handled by AuthContext and the individual page's ProtectedRoute if needed.
  return (
    <ProtectedRoute>
      <div className="w-full">
        {children}
      </div>
    </ProtectedRoute>
  );
}
