
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

let connectionPromise: Promise<typeof mongoose> | null = null;
let mongooseInstance: typeof mongoose | null = null;

async function dbConnect(): Promise<typeof mongoose | null> {
  if (!MONGODB_URI) {
    console.error(
      'CRITICAL ERROR: MONGODB_URI is not defined in your .env.local file. MongoDB connection will fail.'
    );
    return null; // Prevent throwing at module level, let API routes handle null connection
  }

  if (mongooseInstance) {
    console.log('MongoDB: Using existing connection.');
    return mongooseInstance;
  }

  if (!connectionPromise) {
    const opts = {
      bufferCommands: false,
    };
    console.log('MongoDB: Creating new connection promise.');
    connectionPromise = mongoose.connect(MONGODB_URI!, opts).then((mongooseModule) => {
      console.log('MongoDB connected successfully.');
      mongooseInstance = mongooseModule;
      return mongooseModule;
    }).catch(err => {
      console.error('MongoDB connection error:', err.message);
      connectionPromise = null; // Reset promise on error so it can be retried
      mongooseInstance = null;
      throw err; // Re-throw error to be caught by API route using dbConnect
    });
  } else {
    console.log('MongoDB: Waiting for existing connection promise to resolve.');
  }
  
  try {
    mongooseInstance = await connectionPromise;
    return mongooseInstance;
  } catch (e) {
    // Error already logged by the catch block in the promise chain
    return null; // Ensure function returns null on error
  }
}

export default dbConnect;
