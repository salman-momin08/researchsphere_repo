# ResearchSphere

ResearchSphere is an advanced platform for academic paper submissions. It simplifies author workflows with AI tools for plagiarism and acceptance feedback. A helpful AI chatbot assists with platform queries, and the system supports distinct roles for authors, reviewers, and admins to manage the entire publication lifecycle.

## Running the Project

The project is developed using the Next.js Framework. To run this project on your system, follow these steps:

1.  Unzip the folder.
2.  Open a command prompt or terminal within the project directory.
3.  Run `npm install` to install the required packages.
4.  Once the installation is complete, run `npm run dev` to start the local development server.

### Environment Variables

Before running the project, you must create a `.env` file in the root directory. This file stores essential API keys and configuration. Add the following variables:

-   Firebase project configuration (e.g., `NEXT_PUBLIC_FIREBASE_API_KEY`, etc.)
-   Google OAuth credentials (Client ID and Secret)
-   GitHub OAuth credentials (Client ID and Secret)
-   Cloudinary credentials (Cloud Name, API Key, and Upload Preset)
