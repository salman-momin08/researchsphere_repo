
import type { NextApiResponse } from 'next';
import {NextConnect} from 'next-connect';
import multer from 'multer';
import dbConnect from '@/lib/mongodb';
import PaperModel, { IPaper } from '@/models/mongo/paper.model';
import withAuth, { NextApiRequestWithUser } from '@/middleware/withAuth';
import type { PaperStatus } from '@/types';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; 
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      console.warn(`API (/api/papers POST): File upload rejected. Invalid mimetype: ${file.mimetype} for file: ${file.originalname}`);
      cb(new Error('Only .pdf and .docx files are allowed!'));
    }
  }
});

interface NextApiRequestWithFile extends NextApiRequestWithUser {
  file?: Express.Multer.File;
}

const handler = NextConnect<NextApiRequestWithFile, NextApiResponse>({
  onError: (err: any, req, res) => { // Add type for err
    console.error(`API Route Error for ${req.method} ${req.url}:`, err.stack);
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.` });
    }
    if (err.message === 'Only .pdf and .docx files are allowed!') {
        return res.status(415).json({ message: err.message });
    }
    res.status(500).json({ message: "Something broke!", error: err.message });
  },
  onNoMatch: (req, res) => {
    res.status(405).json({ message: `Method ${req.method} Not Allowed on /api/papers` });
  },
});

handler.use(withAuth); 
handler.use(upload.single('paperFile')); 

handler.post(async (req, res) => {
  console.log("API (/api/papers POST): Received request to submit paper.");
  await dbConnect();
  const firebaseUser = req.user;

  if (!firebaseUser) {
    console.warn("API (/api/papers POST): Unauthorized access attempt (no firebaseUser).");
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!req.file) {
    console.warn("API (/api/papers POST): Paper file is missing in the request.");
    return res.status(400).json({ message: 'Paper file is required.' });
  }
  console.log(`API (/api/papers POST): File received: ${req.file.originalname}, Size: ${req.file.size}, Mimetype: ${req.file.mimetype}`);
  
  const { title, abstract, authors: authorsStr, keywords: keywordsStr, paymentOption } = req.body;
  console.log("API (/api/papers POST): Request body fields:", { title, abstract, authorsStr, keywordsStr, paymentOption });


  if (!title || !abstract || !authorsStr || !keywordsStr || !paymentOption) {
    console.warn("API (/api/papers POST): Missing required paper details in request body.");
    return res.status(400).json({ message: 'Missing required paper details (title, abstract, authors, keywords, paymentOption).' });
  }
  
  let authors, keywords;
  try {
    authors = JSON.parse(authorsStr as string); 
    keywords = JSON.parse(keywordsStr as string);
    if (!Array.isArray(authors) || !Array.isArray(keywords)) {
        throw new Error("Authors and keywords must be arrays.");
    }
  } catch (e) {
    console.warn("API (/api/papers POST): Error parsing authors/keywords from request body. They should be JSON stringified arrays.", e);
    return res.status(400).json({ message: 'Invalid format for authors or keywords. Must be comma-separated strings that are then JSON.stringified arrays.'});
  }


  let paymentDueDate: Date | null = null;
  let status: PaperStatus = 'Submitted'; 
  let submissionDate: Date | null = null;

  if (paymentOption === 'payLater') {
    status = 'Payment Pending';
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + 2); 
    paymentDueDate = dueDate;
    console.log(`API (/api/papers POST): PayLater option selected. Status: Payment Pending, DueDate: ${paymentDueDate}`);
  } else if (paymentOption === 'payNow') {
    submissionDate = new Date(); // Set submission date if paying now
    console.log(`API (/api/papers POST): PayNow option selected. Status: Submitted, SubmissionDate: ${submissionDate}`);
  } else {
    console.warn(`API (/api/papers POST): Invalid paymentOption: ${paymentOption}`);
    return res.status(400).json({message: "Invalid payment option specified."});
  }
  
  const newPaperData: Partial<IPaper> = {
    userId: firebaseUser.uid,
    title,
    abstract,
    authors,
    keywords,
    fileName: req.file.originalname,
    fileMimeType: req.file.mimetype,
    fileData: req.file.buffer, 
    uploadDate: new Date(),
    status,
    paymentOption,
    paymentDueDate,
    paidAt: paymentOption === 'payNow' ? new Date() : null,
    submissionDate: submissionDate,
  };

  try {
    console.log("API (/api/papers POST): Attempting to create paper document in MongoDB with data:", { ...newPaperData, fileData: `Buffer of size ${newPaperData.fileData?.length}` });
    const paper = await PaperModel.create(newPaperData);
    const { fileData, ...paperResponse } = paper.toObject();
    console.log("API (/api/papers POST): Paper created successfully in MongoDB. ID:", paper._id);
    return res.status(201).json({ message: 'Paper submitted successfully', paper: paperResponse });
  } catch (error: any) {
    console.error('API (/api/papers POST): Error creating paper in MongoDB:', error);
    return res.status(500).json({ message: 'Internal server error creating paper', error: error.message });
  }
});

handler.get(async (req, res) => {
  console.log("API (/api/papers GET): Received request to list papers. Query:", req.query);
  await dbConnect();
  const firebaseUser = req.user;

  if (!firebaseUser) {
    console.warn("API (/api/papers GET): Unauthorized access attempt (no firebaseUser).");
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { userId, status, authorName } = req.query;
  const queryFilter: any = {};

  if (userId && typeof userId === 'string') {
    if (userId !== firebaseUser.uid && !firebaseUser.admin) {
      console.warn(`API (/api/papers GET): Forbidden attempt by ${firebaseUser.uid} to access papers of ${userId}.`);
      return res.status(403).json({ message: 'Forbidden: You can only view your own papers.' });
    }
    queryFilter.userId = userId;
  } else if (!firebaseUser.admin && !userId) {
    queryFilter.userId = firebaseUser.uid;
  }

  if (status && typeof status === 'string') {
    queryFilter.status = status;
  }
  
  if (authorName && typeof authorName === 'string') {
    queryFilter.authors = { $regex: new RegExp(authorName, 'i') };
  }

  console.log("API (/api/papers GET): Constructed query filter:", queryFilter);
  try {
    const papers = await PaperModel.find(queryFilter).select('-fileData -__v').sort({ uploadDate: -1 });
    console.log(`API (/api/papers GET): Found ${papers.length} papers matching filter.`);
    return res.status(200).json(papers);
  } catch (error: any) {
    console.error('API (/api/papers GET): Error fetching papers from MongoDB:', error);
    return res.status(500).json({ message: 'Internal server error fetching papers', error: error.message });
  }
});


export const config = {
  api: {
    bodyParser: false, 
  },
};

export default handler;
