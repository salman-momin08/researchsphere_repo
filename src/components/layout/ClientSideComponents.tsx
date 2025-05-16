
"use client";

import React from 'react';
import dynamic from 'next/dynamic';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// Dynamically import modals that are client-side only
const LoginModal = dynamic(() => import('@/components/auth/LoginModal'), {
  ssr: false, 
  loading: () => <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center"><LoadingSpinner size={32} /></div>,
});

// You can add other client-side only dynamic imports here if needed

export default function ClientSideComponents() {
  return (
    <>
      <LoginModal />
      {/* Render other dynamically imported client-side components here */}
    </>
  );
}
