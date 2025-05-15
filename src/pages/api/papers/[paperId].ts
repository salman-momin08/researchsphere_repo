
import type { NextApiResponse } from 'next';
import dbConnect from '@/lib/mongodb';
import PaperModel, { IPaper } from '@/models/mongo/paper.model';
import withAuth, { NextApiRequestWithUser } from '@/middleware/withAuth';
import type { PaperStatus } from '@/types';

async function handler(req: NextApiRequestWithUser, res: NextApiResponse) {
  const { paperId } = req.query;
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  await dbConnect();

  if (typeof paperId !== 'string') {
    return res.status(400).json({ message: 'Invalid paper ID' });
  }

  if (req.method === 'GET') {
    try {
      const paper = await PaperModel.findById(paperId).select('-fileData -__v'); // Exclude fileData for general GET
      if (!paper) {
        return res.status(404).json({ message: 'Paper not found' });
      }
      // Check permissions: owner or admin can view
      if (paper.userId !== firebaseUser.uid && !firebaseUser.admin) {
         // Or if status is published, allow any authenticated user
        if (paper.status !== 'Published') {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to view this paper.' });
        }
      }
      return res.status(200).json(paper);
    } catch (error: any) {
      console.error(`Error fetching paper ${paperId}:`, error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Paper not found (invalid ID format)' });
      }
      return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
  } else if (req.method === 'PUT') {
    try {
      const paperToUpdate = await PaperModel.findById(paperId);
      if (!paperToUpdate) {
        return res.status(404).json({ message: 'Paper not found for update' });
      }

      // Only owner or admin can update
      if (paperToUpdate.userId !== firebaseUser.uid && !firebaseUser.admin) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to update this paper.' });
      }
      
      const { status, adminFeedback, plagiarismScore, plagiarismReport, acceptanceProbability, acceptanceReport, paidAt } = req.body;
      const updateData: Partial<IPaper> = {};

      if (firebaseUser.admin) { // Admins can update these fields
        if (status) updateData.status = status as PaperStatus;
        if (adminFeedback !== undefined) updateData.adminFeedback = adminFeedback;
        if (plagiarismScore !== undefined) updateData.plagiarismScore = plagiarismScore;
        if (plagiarismReport !== undefined) updateData.plagiarismReport = plagiarismReport;
        if (acceptanceProbability !== undefined) updateData.acceptanceProbability = acceptanceProbability;
        if (acceptanceReport !== undefined) updateData.acceptanceReport = acceptanceReport;
        
        if (status === 'Submitted' && paperToUpdate.status === 'Payment Pending' && paidAt) {
            updateData.paidAt = new Date(paidAt);
            updateData.submissionDate = new Date(); // Mark submission date upon payment confirmation
            updateData.paymentDueDate = null;
        } else if (status === 'Payment Pending' && !updateData.paymentDueDate && !paperToUpdate.paymentDueDate) {
            const dueDate = new Date();
            dueDate.setHours(dueDate.getHours() + 2);
            updateData.paymentDueDate = dueDate;
        }
      } else { // User is owner, can only update limited fields (e.g., if status is 'Action Required', they might re-submit, not handled here)
         // For now, assume users cannot update papers directly via this PUT endpoint after submission
         // Future: Could allow updates to title/abstract if status is 'Action Required'
         // if (paperToUpdate.status === 'Action Required') {
         //    if (req.body.title) updateData.title = req.body.title;
         //    if (req.body.abstract) updateData.abstract = req.body.abstract;
         //    if (Object.keys(updateData).length > 0) updateData.status = 'Submitted'; // Or 'Under Review'
         // }
         if(status && (status as PaperStatus) === 'Submitted' && paperToUpdate.status === 'Payment Pending' && paidAt) {
             updateData.status = status as PaperStatus;
             updateData.paidAt = new Date(paidAt);
             updateData.submissionDate = new Date();
             updateData.paymentDueDate = null;
         } else {
            return res.status(403).json({ message: 'Forbidden: Users cannot directly modify paper details post-submission via this endpoint without admin rights or specific conditions.' });
         }
      }


      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: 'No update data provided or no permission to update specified fields.' });
      }

      const updatedPaper = await PaperModel.findByIdAndUpdate(paperId, updateData, { new: true }).select('-fileData -__v');
      if (!updatedPaper) {
        // This case should be rare if findById worked, but good practice
        return res.status(404).json({ message: 'Paper not found after attempting update (race condition or ID issue).' });
      }
      return res.status(200).json({ message: 'Paper updated successfully', paper: updatedPaper });
    } catch (error: any) {
      console.error(`Error updating paper ${paperId}:`, error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Paper not found for update (invalid ID format)' });
      }
      return res.status(500).json({ message: 'Internal server error during paper update', error: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

export default withAuth(handler);
