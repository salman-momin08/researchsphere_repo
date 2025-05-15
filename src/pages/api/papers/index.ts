
import type { NextApiResponse } from 'next';
import {NextConnect} from 'next-connect';
import multer from 'multer';
import dbConnect from '@/lib/mongodb';
import PaperModel, { IPaper } from '@/models/mongo/paper.model';
import withAuth, { NextApiRequestWithUser } from '@/middleware/withAuth';
import type { PaperStatus } from '@/types';

// Configure multer for memory storage (to handle file buffer)
// Max file size 10MB for embedding in MongoDB
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; 
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new Error('Only .pdf and .docx files are allowed!'));
    }
  }
});

interface NextApiRequestWithFile extends NextApiRequestWithUser {
  file?: Express.Multer.File;
}

const handler = NextConnect<NextApiRequestWithFile, NextApiResponse>({
  onError: (err, req, res) => {
    console.error("API Route Error:", err.stack);
    res.status(500).json({ message: "Something broke!", error: err.message });
  },
  onNoMatch: (req, res) => {
    res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  },
});

handler.use(withAuth); // Protect all routes in this file
handler.use(upload.single('paperFile')); // Middleware for single file upload with field name 'paperFile'

// POST /api/papers - Submit a new paper
handler.post(async (req, res) => {
  await dbConnect();
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ message: 'Paper file is required.' });
  }
  
  const { title, abstract, authors: authorsStr, keywords: keywordsStr, paymentOption } = req.body;

  if (!title || !abstract || !authorsStr || !keywordsStr || !paymentOption) {
    return res.status(400).json({ message: 'Missing required paper details (title, abstract, authors, keywords, paymentOption).' });
  }
  
  const authors = JSON.parse(authorsStr as string); // Assuming authors and keywords are JSON stringified arrays
  const keywords = JSON.parse(keywordsStr as string);


  let paymentDueDate: Date | null = null;
  let status: PaperStatus = 'Submitted'; // Default if payNow

  if (paymentOption === 'payLater') {
    status = 'Payment Pending';
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + 2); // 2 hours from now
    paymentDueDate = dueDate;
  }
  
  const newPaperData: Partial<IPaper> = {
    userId: firebaseUser.uid,
    title,
    abstract,
    authors,
    keywords,
    fileName: req.file.originalname,
    fileMimeType: req.file.mimetype,
    fileData: req.file.buffer, // Store file content as Buffer
    uploadDate: new Date(),
    status,
    paymentOption,
    paymentDueDate,
    paidAt: paymentOption === 'payNow' ? new Date() : null,
    submissionDate: paymentOption === 'payNow' ? new Date() : null,
  };

  try {
    const paper = await PaperModel.create(newPaperData);
    // Exclude fileData from the response for brevity and security
    const { fileData, ...paperResponse } = paper.toObject();
    return res.status(201).json({ message: 'Paper submitted successfully', paper: paperResponse });
  } catch (error: any) {
    console.error('Error creating paper in MongoDB:', error);
    return res.status(500).json({ message: 'Internal server error creating paper', error: error.message });
  }
});

// GET /api/papers - List papers (supports filtering by userId and status)
handler.get(async (req, res) => {
  await dbConnect();
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { userId, status, authorName } = req.query;
  const queryFilter: any = {};

  if (userId && typeof userId === 'string') {
    // If a specific user ID is requested, ensure it's the logged-in user or an admin
    if (userId !== firebaseUser.uid && !firebaseUser.admin) {
      return res.status(403).json({ message: 'Forbidden: You can only view your own papers.' });
    }
    queryFilter.userId = userId;
  } else if (!firebaseUser.admin && !userId) {
    // Non-admin requesting general list, defaults to their own papers
    queryFilter.userId = firebaseUser.uid;
  }
  // Admins can see all if no specific userId is provided

  if (status && typeof status === 'string') {
    queryFilter.status = status;
  }
  
  if (authorName && typeof authorName === 'string') {
    // Case-insensitive search for author name within the authors array
    queryFilter.authors = { $regex: new RegExp(authorName, 'i') };
  }


  try {
    // Exclude fileData from list view for performance
    const papers = await PaperModel.find(queryFilter).select('-fileData -__v').sort({ uploadDate: -1 });
    return res.status(200).json(papers);
  } catch (error: any) {
    console.error('Error fetching papers from MongoDB:', error);
    return res.status(500).json({ message: 'Internal server error fetching papers', error: error.message });
  }
});


export const config = {
  api: {
    bodyParser: false, // Disable Next.js body parser, multer will handle it
  },
};

export default handler;
