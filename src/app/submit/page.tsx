
"use client";

import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PaperUploadForm from "@/components/papers/PaperUploadForm";

function SubmitPaperPageContent() {
  return (
    <div className="container py-8 md:py-12 px-4">
      <PaperUploadForm />
    </div>
  );
}

export default function SubmitPaperPage() {
  return (
    <ProtectedRoute>
      <SubmitPaperPageContent />
    </ProtectedRoute>
  );
}
