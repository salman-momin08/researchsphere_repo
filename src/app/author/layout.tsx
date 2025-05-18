// src/app/author/layout.tsx
"use client";

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

interface AuthorLayoutProps {
  children: React.ReactNode;
}

export default function AuthorLayout({ children }: AuthorLayoutProps) {
  return (
    <ProtectedRoute>
      <div className="w-full">
        {children}
      </div>
    </ProtectedRoute>
  );
}
