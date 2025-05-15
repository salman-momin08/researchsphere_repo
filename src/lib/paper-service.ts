
import type { Paper, PaperStatus, User } from '@/types';

const getAuthToken = async (): Promise<string | null> => {
  const authModule = await import('@/context/auth-context'); // Dynamic import to access context's method
  if (authModule.AuthContext) { // Check if AuthContext is available (it should be in client components)
    // This is a bit of a hack to get the context value outside a React component.
    // A better long-term solution for services needing auth is to pass the token from the component.
    // Or, if this service is ONLY ever called from components that use useAuth(),
    // you could pass the getIdToken function or the token itself as an argument.
    // For now, attempting to call the exported getIdToken from the context.
    const { default: AuthContextConsumer } = await import('@/hooks/use-auth'); // Assuming useAuth exports the context consumer
    // This approach is still problematic as useAuth() is a hook.
    // The MOST RELIABLE way is to get the token in the component and pass it to these service functions.
    // console.warn("paper-service (getAuthToken): Attempting to get token via dynamic import of AuthContext. This is fragile.");
    // This direct call to AuthContext.getIdToken won't work as AuthContext is the Context object, not the value.
  }

  // Fallback to direct Firebase Auth if available (e.g., if called from a context where firebaseAuth is directly accessible)
  const { auth: firebaseAuth } = await import('@/lib/firebase'); 
  if (firebaseAuth && firebaseAuth.currentUser) {
      try {
          const token = await firebaseAuth.currentUser.getIdToken(true);
          console.log("paper-service (getAuthToken): Token fetched successfully via firebaseAuth.currentUser.");
          return token;
      } catch (e) {
          console.error("paper-service (getAuthToken): Error getting ID token via firebaseAuth.currentUser:", e);
          return null;
      }
  }
  console.warn("paper-service (getAuthToken): No current user found via firebaseAuth.currentUser, cannot get auth token for API calls.");
  return null;
};


export const addPaper = async (
  paperData: Omit<Paper, 'id' | 'uploadDate' | 'fileUrl' | 'fileName' | 'fileMimeType' | 'fileData' | 'userId' | 'status'> & { paymentOption: "payNow" | "payLater" },
  fileToUpload: File,
  userIdClient: string 
): Promise<Paper> => { 
  console.log(`paper-service (addPaper - API): Called for userId: ${userIdClient}, fileName: ${fileToUpload.name}, paymentOption: ${paperData.paymentOption}`);
  
  const token = await getAuthToken();
  if (!token) {
    console.error("paper-service (addPaper - API): Authentication token not available.");
    throw new Error("Authentication token not available. Cannot submit paper.");
  }
  console.log(`paper-service (addPaper - API): Using token (first 20 chars): ${token.substring(0,20)}...`);

  const formData = new FormData();
  formData.append('title', paperData.title);
  formData.append('abstract', paperData.abstract);
  formData.append('authors', JSON.stringify(paperData.authors)); 
  formData.append('keywords', JSON.stringify(paperData.keywords)); 
  formData.append('paymentOption', paperData.paymentOption);
  formData.append('paperFile', fileToUpload, fileToUpload.name); 
  
  console.log("paper-service (addPaper - API): FormData prepared. Keys:");
  for (const key of (formData as any).keys()) { // Type assertion to iterate keys for logging
    console.log(`  - ${key}`);
  }

  try {
    console.log("paper-service (addPaper - API): Sending POST request to /api/papers");
    const response = await fetch('/api/papers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    const responseData = await response.json();
    if (!response.ok) {
      console.error(`paper-service (addPaper - API): Error adding paper. Status: ${response.status}. API Response:`, responseData);
      throw new Error(responseData.message || `Failed to add paper: ${response.statusText}`);
    }
    
    console.log(`paper-service (addPaper - API): Paper submitted to API successfully. Server response:`, responseData);
    const createdPaper = responseData.paper;
    return {
        ...createdPaper,
        id: createdPaper._id, 
        uploadDate: new Date(createdPaper.uploadDate).toISOString(),
        submissionDate: createdPaper.submissionDate ? new Date(createdPaper.submissionDate).toISOString() : null,
        paymentDueDate: createdPaper.paymentDueDate ? new Date(createdPaper.paymentDueDate).toISOString() : null,
        paidAt: createdPaper.paidAt ? new Date(createdPaper.paidAt).toISOString() : null,
    } as Paper;

  } catch (error: any) {
    console.error("paper-service (addPaper - API): Error in API call:", error);
    throw new Error(`Failed to add paper via API: ${error.message || 'Unknown API error'}`);
  }
};

export const getPaper = async (paperId: string): Promise<Paper | null> => {
  console.log(`paper-service (getPaper - API): Fetching paper with ID: ${paperId}`);
  const token = await getAuthToken();
  // Token might be optional if API endpoint allows public access for published papers

  try {
    const response = await fetch(`/api/papers/${paperId}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (response.status === 404) {
        console.warn(`paper-service (getPaper - API): Paper ${paperId} not found (404).`);
        return null;
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`paper-service (getPaper - API): Error fetching paper ${paperId}. Status: ${response.status}. API Error:`, errorData.message);
      throw new Error(errorData.message || `Failed to fetch paper ${paperId}`);
    }
    const data = await response.json();
    console.log(`paper-service (getPaper - API): Paper ${paperId} fetched successfully.`);
    return {
        ...data,
        id: data._id,
        uploadDate: new Date(data.uploadDate).toISOString(),
        submissionDate: data.submissionDate ? new Date(data.submissionDate).toISOString() : null,
        paymentDueDate: data.paymentDueDate ? new Date(data.paymentDueDate).toISOString() : null,
        paidAt: data.paidAt ? new Date(data.paidAt).toISOString() : null,
    } as Paper;
  } catch (error) {
    console.error(`paper-service (getPaper - API): Error fetching paper ${paperId} from API: `, error);
    throw error;
  }
};

export const getUserPapers = async (userId: string): Promise<Paper[]> => {
  console.log(`paper-service (getUserPapers - API): Fetching papers for user ID: ${userId}`);
  const token = await getAuthToken();
  if (!token) {
      console.error("paper-service (getUserPapers - API): Authentication required.");
      throw new Error("Authentication required to fetch user papers.");
  }

  try {
    const response = await fetch(`/api/papers?userId=${userId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`paper-service (getUserPapers - API): Error fetching papers for user ${userId}. Status: ${response.status}. API Error:`, errorData.message);
      throw new Error(errorData.message || 'Failed to fetch user papers');
    }
    const papersData = await response.json();
    console.log(`paper-service (getUserPapers - API): Fetched ${papersData.length} papers for user ${userId}.`);
    return papersData.map((p: any) => ({
        ...p,
        id: p._id,
        uploadDate: new Date(p.uploadDate).toISOString(),
        submissionDate: p.submissionDate ? new Date(p.submissionDate).toISOString() : null,
        paymentDueDate: p.paymentDueDate ? new Date(p.paymentDueDate).toISOString() : null,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    })) as Paper[];
  } catch (error) {
    console.error(`paper-service (getUserPapers - API): Error fetching user papers from API for user ${userId}: `, error);
    throw error;
  }
};

export const getAllPapers = async (): Promise<Paper[]> => { 
  console.log("paper-service (getAllPapers - API): Fetching all papers (admin).");
  const token = await getAuthToken();
  if (!token) {
    console.error("paper-service (getAllPapers - API): Authentication required.");
    throw new Error("Authentication required to fetch all papers.");
  }
  
  try {
    const response = await fetch('/api/papers', { 
      headers: { 'Authorization': `Bearer ${token}` },
    });
     if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`paper-service (getAllPapers - API): Error fetching all papers. Status: ${response.status}. API Error:`, errorData.message);
      throw new Error(errorData.message || 'Failed to fetch all papers');
    }
    const papersData = await response.json();
    console.log(`paper-service (getAllPapers - API): Fetched ${papersData.length} papers.`);
    return papersData.map((p: any) => ({
        ...p,
        id: p._id,
        uploadDate: new Date(p.uploadDate).toISOString(),
        submissionDate: p.submissionDate ? new Date(p.submissionDate).toISOString() : null,
        paymentDueDate: p.paymentDueDate ? new Date(p.paymentDueDate).toISOString() : null,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    })) as Paper[];
  } catch (error) {
    console.error("paper-service (getAllPapers - API): Error fetching all papers from API: ", error);
    throw error;
  }
};

export const updatePaperStatus = async (paperId: string, status: PaperStatus, paymentDetails?: { paidAt: string }): Promise<Paper> => {
  console.log(`paper-service (updatePaperStatus - API): Updating status for paper ${paperId} to ${status}. Payment details:`, paymentDetails);
  const token = await getAuthToken();
  if (!token) {
    console.error("paper-service (updatePaperStatus - API): Authentication required.");
    throw new Error("Authentication required to update paper status.");
  }

  const body: Partial<Paper> & { paidAt?: string } = { status };
  if (paymentDetails?.paidAt) {
    body.paidAt = paymentDetails.paidAt; 
  }
   if (status === 'Submitted' && paymentDetails?.paidAt) {
    // If moving to 'Submitted' due to payment, also set submissionDate
    // and clear paymentDueDate
    body.submissionDate = new Date().toISOString();
    body.paymentDueDate = null; // Clear due date once paid
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
    const responseData = await response.json();
    if (!response.ok) {
      console.error(`paper-service (updatePaperStatus - API): Error updating status for paper ${paperId}. Status: ${response.status}. API Error:`, responseData.message);
      throw new Error(responseData.message || `Failed to update paper status for ${paperId}`);
    }
    console.log(`paper-service (updatePaperStatus - API): Status updated for paper ${paperId}. API Response:`, responseData);
    const updatedPaper = responseData.paper;
     return {
        ...updatedPaper,
        id: updatedPaper._id, 
        uploadDate: new Date(updatedPaper.uploadDate).toISOString(),
        submissionDate: updatedPaper.submissionDate ? new Date(updatedPaper.submissionDate).toISOString() : null,
        paymentDueDate: updatedPaper.paymentDueDate ? new Date(updatedPaper.paymentDueDate).toISOString() : null,
        paidAt: updatedPaper.paidAt ? new Date(updatedPaper.paidAt).toISOString() : null,
    } as Paper;
  } catch (error) {
    console.error(`paper-service (updatePaperStatus - API): Error updating paper status for ${paperId} via API: `, error);
    throw error;
  }
};

export const updatePaperData = async (paperId: string, data: Partial<Omit<Paper, 'id'>>): Promise<Paper> => {
  console.log(`paper-service (updatePaperData - API): Updating data for paper ${paperId}. Data:`, data);
  const token = await getAuthToken();
  if (!token) {
    console.error("paper-service (updatePaperData - API): Authentication required.");
    throw new Error("Authentication required to update paper data.");
  }

  try {
    const response = await fetch(`/api/papers/${paperId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    const responseData = await response.json();
     if (!response.ok) {
      console.error(`paper-service (updatePaperData - API): Error updating data for paper ${paperId}. Status: ${response.status}. API Error:`, responseData.message);
      throw new Error(responseData.message || `Failed to update paper data for ${paperId}`);
    }
    console.log(`paper-service (updatePaperData - API): Data updated for paper ${paperId}. API Response:`, responseData);
    const updatedPaper = responseData.paper;
    return {
        ...updatedPaper,
        id: updatedPaper._id, 
        uploadDate: new Date(updatedPaper.uploadDate).toISOString(),
        submissionDate: updatedPaper.submissionDate ? new Date(updatedPaper.submissionDate).toISOString() : null,
        paymentDueDate: updatedPaper.paymentDueDate ? new Date(updatedPaper.paymentDueDate).toISOString() : null,
        paidAt: updatedPaper.paidAt ? new Date(updatedPaper.paidAt).toISOString() : null,
    } as Paper;
  } catch (error) {
    console.error(`paper-service (updatePaperData - API): Error updating paper data for ${paperId} via API: `, error);
    throw error;
  }
};

export const getPublishedPapers = async (): Promise<Paper[]> => {
  console.log("paper-service (getPublishedPapers - API): Fetching published papers.");
  const token = await getAuthToken(); 
                                    
  try {
    const response = await fetch('/api/papers?status=Published', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`paper-service (getPublishedPapers - API): Error fetching published papers. Status: ${response.status}. API Error:`, errorData.message);
      throw new Error(errorData.message || 'Failed to fetch published papers');
    }
    const papersData = await response.json();
    console.log(`paper-service (getPublishedPapers - API): Fetched ${papersData.length} published papers.`);
    return papersData.map((p: any) => ({
        ...p,
        id: p._id,
        uploadDate: new Date(p.uploadDate).toISOString(),
        submissionDate: p.submissionDate ? new Date(p.submissionDate).toISOString() : null,
        paymentDueDate: p.paymentDueDate ? new Date(p.paymentDueDate).toISOString() : null,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    })) as Paper[];
  } catch (error) {
    console.error("paper-service (getPublishedPapers - API): Error fetching published papers from API: ", error);
    throw error;
  }
};
