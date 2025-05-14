
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
// To run this script:
// 1. Ensure you have a local MongoDB server running.
// 2. Install dependencies: npm install mongoose dotenv
//    (or yarn add mongoose dotenv)
// 3. Create a .env file in the root of your project and add:
//    MONGO_URI=mongodb://localhost:27017/researchsphere_local_dev
// 4. Ensure your tsconfig.json allows for script execution (e.g., "module": "commonjs" for simple ts-node execution or use esm with ts-node-esm)
// 5. Run from project root: npx ts-node --esm scripts/mongo-seed.ts (if using ES modules in tsconfig)
//    or npx ts-node scripts/mongo-seed.ts (if tsconfig module is commonjs)

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import UserModel from '../src/models/mongo/user.model'; // Adjust path if your script is elsewhere
import PaperModel from '../src/models/mongo/paper.model'; // Adjust path

dotenv.config(); // Load environment variables from .env file

// --- Mock Data (adapted from current project structure) ---
// Note: For users, _id should be the Firebase UID if you're migrating/mirroring.
const MOCK_USERS_DATA = [
  { _id: "user1", email: "user1@example.com", displayName: "Alice Wonderland", username: "alicew", role: "Author", isAdmin: false, createdAt: new Date(), updatedAt: new Date() },
  { _id: "user2", email: "user2@example.com", displayName: "Bob The Builder", username: "bobtheb", role: "Author", isAdmin: false, createdAt: new Date(), updatedAt: new Date() },
  { _id: "user3", email: "user3@example.com", displayName: "Jane Doe", username: "janed", role: "Reviewer", isAdmin: false, createdAt: new Date(), updatedAt: new Date() },
  { _id: "adminuser", email: "admin@example.com", displayName: "Admin User", username: "admin", role: "Admin", isAdmin: true, createdAt: new Date(), updatedAt: new Date() },
];

const MOCK_PAPERS_DATA_PREP = [
  {
    // MongoDB will generate its own _id, so we don't specify it here for new insertions
    userId: "user1", title: "The Future of AI in Academic Research",
    abstract: "This paper explores the potential impact of artificial intelligence on academic research methodologies and publication processes. It covers areas like automated literature reviews, AI-assisted writing and peer review, and the ethical implications of AI in academia.",
    authors: ["Dr. Alice Wonderland", "Dr. Bob The Builder"], keywords: ["AI", "Academia", "Future", "Research"],
    uploadDate: new Date("2023-10-15T10:00:00Z"), status: "Accepted",
    plagiarismScore: 0.05, plagiarismReport: { highlightedSections: ["This specific phrase seems common.", "Another sentence here might be too similar."] },
    acceptanceProbability: 0.85, acceptanceReport: { reasoning: "The paper is well-structured, presents novel ideas, and has strong evidence. Clarity is excellent." },
    fileName: "future_of_ai.pdf", fileUrl: "/mock-files/future_of_ai.pdf"
  },
  {
    userId: "user2", title: "Quantum Computing: A New Paradigm",
    abstract: "An in-depth analysis of quantum computing principles and its applications in solving complex problems such as drug discovery, materials science, and cryptography. The paper also discusses current challenges and future prospects of quantum technology.",
    authors: ["Dr. Jane Doe"], keywords: ["Quantum Computing", "Physics", "Technology"],
    uploadDate: new Date("2023-11-01T14:30:00Z"), status: "Under Review",
    plagiarismScore: 0.12, plagiarismReport: { highlightedSections: ["Section 3, paragraph 2 seems derivative."] },
    acceptanceProbability: 0.60, acceptanceReport: { reasoning: "Good potential but requires more experimental validation and clearer distinction from existing work." },
    fileName: "quantum_paradigm.docx", fileUrl: "/mock-files/quantum_paradigm.docx"
  },
  {
    userId: "user1", title: "Sustainable Energy Solutions for Urban Environments",
    abstract: "Investigating innovative sustainable energy solutions to address the growing demands of urban environments and mitigate climate change. This includes a review of solar, wind, and geothermal technologies, as well as smart grid implementations.",
    authors: ["Prof. John Smith", "Dr. Emily White"], keywords: ["Sustainability", "Urban Planning", "Renewable Energy", "Climate Change"],
    uploadDate: new Date("2024-01-20T09:15:00Z"), status: "Payment Pending",
    plagiarismScore: 0.08, plagiarismReport: { highlightedSections: [] }, // Empty array for no highlighted sections
    acceptanceProbability: 0.72, acceptanceReport: { reasoning: "Relevant topic and well-researched. Awaiting payment to proceed with formal review." },
    fileName: "sustainable_urban_energy.pdf", fileUrl: "/mock-files/sustainable_urban_energy.pdf"
  },
];
// --- End Mock Data ---

const mongoURI = process.env.MONGO_URI;
if (!mongoURI) {
  console.error("MONGO_URI is not defined in your .env file. Exiting.");
  process.exit(1);
}

async function seedDatabase() {
  try {
    await mongoose.connect(mongoURI);
    console.log('Successfully connected to MongoDB for seeding.');

    // Clear existing data
    console.log('Attempting to delete existing users...');
    await UserModel.deleteMany({});
    console.log('Attempting to delete existing papers...');
    await PaperModel.deleteMany({});
    console.log('Cleared existing users and papers data.');

    // Insert users
    const createdUsers = [];
    for (const userData of MOCK_USERS_DATA) {
        try {
            // Check if user exists by _id
            const existingUser = await UserModel.findById(userData._id);
            if (existingUser) {
                console.warn(`User with _id ${userData._id} already exists. Skipping.`);
                createdUsers.push(existingUser); // Add existing user to array if needed later
                continue;
            }
            const user = new UserModel(userData);
            await user.save();
            createdUsers.push(user);
        } catch (error: any) {
            // Catch other errors like validation errors if username/email must be unique by schema and data violates it
            console.error(`Error saving user ${userData._id}:`, error.message);
        }
    }
    console.log(`Seeded/verified ${createdUsers.length} users.`);

    // Insert papers
    // Note: IPaper defines optional fields, so they can be null or undefined.
    // The schema default values will apply if not provided.
    const createdPapers = await PaperModel.insertMany(MOCK_PAPERS_DATA_PREP as any[]);
    console.log(`Seeded ${createdPapers.length} papers.`);

    console.log('Database seeding completed successfully!');
  } catch (error: any) {
    console.error('Error seeding database:', error.message);
    if (error.code === 11000) {
        console.error('Details: Duplicate key error. This might happen if unique indexes (e.g., on username or email) are violated by the mock data.');
    }
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

seedDatabase();
