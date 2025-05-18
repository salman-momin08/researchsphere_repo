
"use client"; // This layout itself doesn't need client hooks if children are wrapped.

import React from 'react';
// ProtectedRoute is applied by individual pages or higher up if needed universally for /author
// For instance, if /author/profile/settings applies it, this layout doesn't need to double-apply.

interface AuthorLayoutProps {
  children: React.ReactNode;
}

export default function AuthorLayout({ children }: AuthorLayoutProps) {
  // This layout is simpler, assuming child pages or a higher layout handles protection.
  // It ensures all routes under /author/* can have a shared structure if needed in the future.
  return (
    <div className="w-full">
      {children}
    </div>
  );
}
