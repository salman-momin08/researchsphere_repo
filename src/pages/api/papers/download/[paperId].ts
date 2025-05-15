
import type { NextApiResponse } from 'next';
import dbConnect from '@/lib/mongodb';
import PaperModel from '@/models/mongo/paper.model';
import withAuth, { NextApiRequestWithUser } from '@/middleware/withAuth';

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
      // Fetch the paper including fileData
      const paper = await PaperModel.findById(paperId).select('+fileData +fileName +fileMimeType');
      if (!paper || !paper.fileData || !paper.fileName || !paper.fileMimeType) {
        return res.status(404).json({ message: 'Paper or file data not found' });
      }

      // Check permissions: owner or admin can download, or if published.
      if (paper.userId !== firebaseUser.uid && !firebaseUser.admin && paper.status !== 'Published') {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to download this file.' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(paper.fileName)}"`);
      res.setHeader('Content-Type', paper.fileMimeType);
      res.send(paper.fileData); // Send the buffer
    } catch (error: any) {
      console.error(`Error downloading paper ${paperId}:`, error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Paper not found for download (invalid ID format)' });
      }
      return res.status(500).json({ message: 'Internal server error during file download', error: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

export default withAuth(handler);
