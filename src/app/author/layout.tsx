
// src/app/author/layout.tsx
"use client";

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

interface AuthorLayoutProps {
  children: React.ReactNode;
}

export default function AuthorLayout({ children }: AuthorLayoutProps) {
  // This layout ensures that all routes under /author/* are protected
  // and require authentication. The specific logic for profile completion
  // or role-based access within these routes can be handled by AuthContext
  // or the individual page components.
  return (
    <ProtectedRoute>
      <div className="w-full">
        {children}
      </div>
    </ProtectedRoute>
  );
}
