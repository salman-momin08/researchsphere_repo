# ResearchSphere

ResearchSphere is an advanced platform for academic paper submissions. It simplifies author workflows with AI tools for plagiarism and acceptance feedback. A helpful AI chatbot assists with platform queries, and the system supports distinct roles for authors, reviewers, and admins to manage the entire publication lifecycle.

## Core Technologies

This project is built with a modern, full-stack technology set:

*   **Framework:** **Next.js** (v15) with the App Router for robust server-side rendering and static site generation.
*   **Language:** **TypeScript** for type safety and improved developer experience.
*   **Styling:** **Tailwind CSS** for a utility-first styling approach.
*   **UI Components:** **ShadCN UI** for a set of accessible and reusable components.
*   **AI/Generative:** **Genkit** (from Google) to orchestrate calls to **Gemini AI models** for features like plagiarism checks, acceptance probability, and the user-facing chatbot.
*   **Backend & Database:** **Firebase** for Authentication (including social logins), Firestore (as the NoSQL database), and serverless infrastructure.
*   **File Storage:** **Cloudinary** for scalable cloud-based storage and delivery of user-uploaded paper files (PDFs/DOCX).

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