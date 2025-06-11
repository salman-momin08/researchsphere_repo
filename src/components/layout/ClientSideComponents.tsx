
"use client";

import React from 'react';
import dynamic from 'next/dynamic';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// Dynamically import modals that are client-side only
const LoginModal = dynamic(() => import('@/components/auth/LoginModal'), {
  ssr: false, 
  loading: () => <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center"><LoadingSpinner size={32} /></div>,
});

const Chatbot = dynamic(() => import('@/components/chatbot/Chatbot'), {
  ssr: false,
  // No specific loading for chatbot FAB itself, it's small. Dialog will handle its own.
});

export default function ClientSideComponents() {
  return (
    <>
      <LoginModal />
      <Chatbot />
    </>
  );
}
