
import type { Paper, PaperStatus, User } from '@/types';
// No longer using Firebase Firestore directly here. API calls will be made.

const getAuthToken = async (): Promise<string | null> => {
  // In a real app, you'd get this from your auth context or Firebase SDK
  // For now, this is a placeholder. You need to implement getIdToken() in AuthContext
  // and find a way to access it here or pass it to these service functions.
  // This is a critical part for securing API calls.
  const authModule = await import('@/context/auth-context');
  const { AuthContext } = authModule; // Assuming AuthContext is exported
  
  // This is a simplified way and might not work perfectly if AuthContext is not readily available
  // or if this service is used server-side where context doesn't exist.
  // A better approach might be to pass the token to each service function.
  if (firebaseAuth?.currentUser) {
    return await firebaseAuth.currentUser.getIdToken();
  }
  // Fallback or error if no currentUser in Firebase Auth
  // This is problematic. Service layer should ideally receive token.
  const { auth: firebaseAuth } = await import('@/lib/firebase'); // Lazy import
  if (firebaseAuth && firebaseAuth.currentUser) {
      try {
          return await firebaseAuth.currentUser.getIdToken(true);
      } catch (e) {
          console.error("Error getting ID token in paper-service:", e);
          return null;
      }
  }
  console.warn("paper-service: No current user found, cannot get auth token for API calls.");
  return null;
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'fileUrl' | 'fileName' | 'fileMimeType' | 'fileData' | 'userId' | 'status'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File,
  userIdClient: string // Explicitly pass userId for clarity, though token will verify
): Promise<Paper> => { // Return the created paper from API
  console.log("paper-service (API): addPaper called with userId:", userIdClient, "fileName:", fileToUpload.name);
  
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Authentication token not available. Cannot submit paper.");
  }

  const formData = new FormData();
  formData.append('title', paperData.title);
  formData.append('abstract', paperData.abstract);
  formData.append('authors', JSON.stringify(paperData.authors)); // Send as JSON string
  formData.append('keywords', JSON.stringify(paperData.keywords)); // Send as JSON string
  formData.append('paymentOption', paperData.paymentOption);
  formData.append('paperFile', fileToUpload); // 'paperFile' must match multer field name in API

  try {
    const response = await fetch('/api/papers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        // 'Content-Type': 'multipart/form-data' is set automatically by browser for FormData
      },
      body: formData,
    });

    const responseData = await response.json();
    if (!response.ok) {
      console.error("paper-service (API): Error adding paper:", response.status, responseData);
      throw new Error(responseData.message || `Failed to add paper: ${response.statusText}`);
    }
    
    console.log(`paper-service (API): Paper submitted to API, server response:`, responseData);
    // Transform API response (MongoDB doc) to client-side Paper type
    const createdPaper = responseData.paper;
    return {
        ...createdPaper,
        id: createdPaper._id, // MongoDB uses _id
        uploadDate: new Date(createdPaper.uploadDate).toISOString(),
        submissionDate: createdPaper.submissionDate ? new Date(createdPaper.submissionDate).toISOString() : null,
        paymentDueDate: createdPaper.paymentDueDate ? new Date(createdPaper.paymentDueDate).toISOString() : null,
        paidAt: createdPaper.paidAt ? new Date(createdPaper.paidAt).toISOString() : null,
        // fileData is not returned from this API for list/create, only for download
    } as Paper;

  } catch (error: any) {
    console.error("paper-service (API): Error in addPaper API call:", error);
    throw new Error(`Failed to add paper via API: ${error.message || 'Unknown API error'}`);
  }
};

export const getPaper = async (paperId: string): Promise<Paper | null> => {
  const token = await getAuthToken();
  if (!token) {
    console.warn("paper-service: No auth token for getPaper");
    // Allow public fetch for 'Published' papers, or if rules allow unauth access to specific papers
    // For now, assume token is needed for most GETs or API handles public access.
  }

  try {
    const response = await fetch(`/api/papers/${paperId}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || `Failed to fetch paper ${paperId}`);
    }
    const data = await response.json();
    return {
        ...data,
        id: data._id,
        uploadDate: new Date(data.uploadDate).toISOString(),
        submissionDate: data.submissionDate ? new Date(data.submissionDate).toISOString() : null,
        paymentDueDate: data.paymentDueDate ? new Date(data.paymentDueDate).toISOString() : null,
        paidAt: data.paidAt ? new Date(data.paidAt).toISOString() : null,
    } as Paper;
  } catch (error) {
    console.error(`Error getting paper ${paperId} from API: `, error);
    throw error;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  const token = await getAuthToken();
  if (!token) throw new Error("Authentication required to fetch user papers.");

  try {
    const response = await fetch(`/api/papers?userId=${userId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || 'Failed to fetch user papers');
    }
    const papersData = await response.json();
    return papersData.map((p: any) => ({
        ...p,
        id: p._id,
        uploadDate: new Date(p.uploadDate).toISOString(),
        submissionDate: p.submissionDate ? new Date(p.submissionDate).toISOString() : null,
        paymentDueDate: p.paymentDueDate ? new Date(p.paymentDueDate).toISOString() : null,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    })) as Paper[];
  } catch (error) {
    console.error("Error getting user papers from API: ", error);
    throw error;
  }
};

export const getAllPapers = async (): Promise<Paper[]> => { // Typically for admin
  const token = await getAuthToken();
  if (!token) throw new Error("Authentication required to fetch all papers.");
  
  try {
    const response = await fetch('/api/papers', { // Admin API implicitly gets all
      headers: { 'Authorization': `Bearer ${token}` },
    });
     if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || 'Failed to fetch all papers');
    }
    const papersData = await response.json();
    return papersData.map((p: any) => ({
        ...p,
        id: p._id,
        uploadDate: new Date(p.uploadDate).toISOString(),
        submissionDate: p.submissionDate ? new Date(p.submissionDate).toISOString() : null,
        paymentDueDate: p.paymentDueDate ? new Date(p.paymentDueDate).toISOString() : null,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    })) as Paper[];
  } catch (error) {
    console.error("Error getting all papers from API: ", error);
    throw error;
  }
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<void> => {
  const token = await getAuthToken();
  if (!token) throw new Error("Authentication required to update paper status.");

  const body: Partial<Paper> & { paidAt?: string } = { status };
  if (paymentDetails?.paidAt) {
    body.paidAt = paymentDetails.paidAt; // API will handle converting this to Date for MongoDB
  }

  try {
    const response = await fetch(`/api/papers/${paperId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || `Failed to update paper status for ${paperId}`);
    }
    // const updatedPaper = await response.json(); // API returns updated paper
  } catch (error) {
    console.error(`Error updating paper status for ${paperId} via API: `, error);
    throw error;
  }
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id'>>): Promise<void> => {
  const token = await getAuthToken();
  if (!token) throw new Error("Authentication required to update paper data.");

  try {
    const response = await fetch(`/api/papers/${paperId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
     if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || `Failed to update paper data for ${paperId}`);
    }
    // const updatedPaper = await response.json();
  } catch (error) {
    console.error(`Error updating paper data for ${paperId} via API: `, error);
    throw error;
  }
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  const token = await getAuthToken(); // May not be needed if API endpoint is public for published papers
                                    // but good for consistency if auth middleware handles it.
  try {
    const response = await fetch('/api/papers?status=Published', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || 'Failed to fetch published papers');
    }
    const papersData = await response.json();
    return papersData.map((p: any) => ({
        ...p,
        id: p._id,
        uploadDate: new Date(p.uploadDate).toISOString(),
        submissionDate: p.submissionDate ? new Date(p.submissionDate).toISOString() : null,
        paymentDueDate: p.paymentDueDate ? new Date(p.paymentDueDate).toISOString() : null,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    })) as Paper[];
  } catch (error) {
    console.error("Error getting published papers from API: ", error);
    throw error;
  }
};

// Seed function is for local MongoDB, not directly part of client paper service.
// Kept for reference, but would be run server-side or as a script.
// export const seedMockPapersToFirestore = async (mockPapers: Paper[]) => { ... }

// Delete file from storage: This needs to be an API call if files are on server.
// If files were client-uploaded to S3/GCS, client might delete directly.
// For files in MongoDB, a DELETE /api/papers/[paperId] should handle associated file data.
// This function is now OBSOLETE as file is embedded in MongoDB or handled by DELETE paper API.
// export const deletePaperFileFromStorage = async (fileUrl: string): Promise<void> => { ... }

// No longer using Firestore directly, so functions like seedMockPapersToFirestore are not applicable here.
// The deletePaperFileFromStorage is also not directly applicable as the file is part of the MongoDB document.
// Deleting the paper document via API will remove the file data.
