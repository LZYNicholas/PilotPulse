# Project Requirements: AI-Powered CV Analyzer

## 1. Project Overview

Build a web application where CVs/resumes serve as a **common knowledge base**. Users can upload and delete CVs, and then create conversations to ask AI-powered questions about all CVs in the knowledge base — including strengths, weaknesses, skill comparisons, and more.

---

## 2. Objectives

- Provide a simple, intuitive web interface for CV upload and management
- Build a shared CV knowledge base accessible to all users
- Extract and store structured information from CVs using AI
- Enable natural-language Q&A over the CV knowledge base through multi-conversation support
- Allow users to create, list, and reset conversations

---

## 3. Functional Requirements

### 3.1 CV Knowledge Base (Upload & Management)

All uploaded CVs form a **shared common knowledge base**. Any user can contribute CVs and query the entire collection.

| ID | Requirement | Priority |
|----|-------------|----------|
| F-01 | Users can upload CV files (PDF, DOCX) via a web form | Must Have |
| F-02 | System validates file type and size (max 10 MB) | Must Have |
| F-03 | Users can view a list of all uploaded CVs in the knowledge base | Must Have |
| F-04 | Users can delete CVs from the knowledge base | Must Have |
| F-05 | Users can preview uploaded CV content | Should Have |

### 3.2 AI Processing & Storage

| ID | Requirement | Priority |
|----|-------------|----------|
| F-07 | Extract text content from uploaded CV files (PDF/DOCX parsing) | Must Have |
| F-08 | Chunk extracted text into segments for embedding | Must Have |
| F-09 | Generate vector embeddings of CV chunks | Must Have |
| F-10 | Store embeddings in vector database (Qdrant / Pinecone) with file metadata | Must Have |

### 3.3 Conversation Management

| ID | Requirement | Priority |
|----|-------------|----------|
| F-12 | Users can **create a new conversation** | Must Have |
| F-13 | Users can **view a list of all conversations** (with title/date) | Must Have |
| F-14 | Users can **select and continue** a previous conversation | Must Have |
| F-15 | Users can **reset (clear) a conversation** to start fresh | Must Have |
| F-16 | Users can **delete a conversation** | Should Have |
| F-17 | Conversations persist across browser sessions | Should Have |

### 3.4 AI-Powered Q&A (Chat with CV Knowledge Base)

| ID | Requirement | Priority |
|----|-------------|----------|
| F-18 | Users can ask natural-language questions about all CVs in the knowledge base | Must Have |
| F-19 | System retrieves relevant CV content using RAG (Retrieval-Augmented Generation) | Must Have |
| F-20 | AI provides answers grounded in actual CV data (not hallucinated) | Must Have |
| F-21 | Support questions across multiple CVs (e.g., "Who has the most Python experience?") | Must Have |
| F-22 | Maintain full conversation history within each conversation | Must Have |
| F-23 | Users can ask about strengths, weaknesses, and comparisons between candidates | Should Have |

---

## 4. Technical Architecture

### 4.1 System Diagram

```
┌─────────────────┐       ┌─────────────────────────────────┐
│                  │       │          Backend (API)           │
│   Frontend       │       │                                  │
│   (React/Next.js)│──────▶│  ┌───────────┐  ┌────────────┐ │
│                  │       │  │ Upload API │  │  Chat API   │ │
│  - CV Knowledge  │       │  └─────┬─────┘  └─────┬──────┘ │
│    Base Page     │       │        │               │        │
│  - Conversations │       │        ▼               ▼        │
│  - Chat Page     │       │  ┌───────────┐  ┌────────────┐ │
│                  │       │  │ CV Parser  │  │ RAG Engine │ │
└─────────────────┘       │  └─────┬─────┘  └─────┬──────┘ │
                           │        │               │        │
                           │        ▼               ▼        │
                           │  ┌─────────────────────────┐   │
                           │  │     AI / LLM Service     │   │
                           │  │  (Claude API / OpenAI)   │   │
                           │  └─────────────────────────┘   │
                           │        │               │        │
                           │        ▼               ▼        │
                           │  ┌───────────┐  ┌────────────┐ │
                           │  │ Database   │  │ Vector DB  │ │
                           │  │ (Postgres/ │  │ (Qdrant/   │ │
                           │  │  Supabase) │  │  Pinecone) │ │
                           │  └───────────┘  └────────────┘ │
                           └─────────────────────────────────┘
```

### 4.2 Recommended Tech Stack

The following is a suggested stack. You are free to choose your own technologies as long as the functional requirements are met.

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | React or Next.js (TypeScript) | With Tailwind CSS for styling |
| **Backend** | Python (FastAPI) | REST API, best ecosystem for AI/LLM libraries |
| **Database** | PostgreSQL | Structured data (CVs, conversations, messages) |
| **Vector DB** | Qdrant or Pinecone | CV embeddings for RAG semantic search |
| **AI/LLM** | Claude API (Anthropic) or OpenAI API | Q&A, text understanding |
| **CV Parsing** | PyPDF2 / pdfplumber + python-docx | Extract raw text from files |
| **Embeddings** | Voyage AI / OpenAI Embeddings / Pinecone Inference | Convert text to vectors |
| **File Storage** | Supabase Storage / Cloudflare R2 / Firebase Storage / AWS S3 | Store original CV files |

### 4.3 Technology Explanations

**React / Next.js** — React is a JavaScript library for building user interfaces. Next.js is a framework built on top of React that adds server-side rendering, routing, and API routes out of the box. Using TypeScript adds type safety to catch errors early.

**FastAPI** — A modern Python web framework for building REST APIs. It is fast, easy to learn, has automatic API documentation (Swagger UI), and works well with async code. It is the best choice for AI/LLM projects because Python has the richest ecosystem for AI libraries.

**PostgreSQL** — A powerful open-source relational database. It stores structured data in tables with rows and columns (like Excel but for applications). You will use it to store CV metadata, conversation records, and chat messages. Free hosted options: **Supabase** (500MB free) or **Neon** (512MB free).

**Qdrant** — An open-source vector database. Unlike a regular database that searches by exact values (e.g., `WHERE name = 'John'`), a vector database stores numerical representations (embeddings) of text and finds similar content by meaning. When a user asks "Who has machine learning experience?", Qdrant finds CV chunks that are semantically similar to that question, even if the exact words don't match. Free tier: Qdrant Cloud (1GB, 1 cluster).

**Pinecone** — A managed cloud vector database similar to Qdrant. It is easier to set up (fully managed, no infrastructure to worry about) and also offers a built-in Inference API that can generate embeddings for you, so you don't need a separate embedding service. Free tier: 1 index, 2GB storage.

**Embeddings** — Embeddings convert text into numerical vectors (arrays of numbers) that capture the meaning of the text. Similar texts produce similar vectors. For example, "Python developer" and "Python programmer" would have very close vectors. You generate embeddings using an API:
- **OpenAI Embeddings** — popular, easy to use (`text-embedding-3-small`)
- **Voyage AI** — high quality embeddings, competitive pricing
- **Pinecone Inference** — if you use Pinecone, it can generate embeddings for you directly

**RAG (Retrieval-Augmented Generation)** — The core pattern of this project. Instead of sending all CVs to the LLM (which would be too large), RAG works in 2 steps: (1) **Retrieve** — use the vector DB to find the most relevant CV chunks for the user's question, (2) **Generate** — send only those relevant chunks + the question to the LLM to generate a grounded answer.

**AWS S3** — Amazon's cloud file storage service. It stores files (called "objects") in "buckets". Think of it as a cloud hard drive accessible via API. You upload CV files here and retrieve them later. It is the industry standard for file storage.

**Supabase Storage** — A free alternative to S3, built on top of S3-compatible storage. Comes bundled with Supabase's free PostgreSQL database. Free tier: 1GB storage.

**Cloudflare R2** — Another S3-compatible file storage service. Free tier: 10GB storage with no egress (download) fees, which is very generous.

**Firebase Storage** — Google's cloud file storage. Easy to integrate if you use other Google/Firebase services. Free tier: 5GB storage.

**Claude API / OpenAI API** — These are APIs to access large language models (LLMs). You send a prompt (text) and receive an AI-generated response. In this project, the LLM answers user questions about CVs based on the retrieved context from RAG.

### 4.4 Free Services for Interns

| Service | Free Tier | Use For |
|---------|-----------|---------|
| **Qdrant Cloud** | 1GB storage, 1 cluster | Vector DB for RAG |
| **Pinecone** | 1 index, 2GB storage | Vector DB for RAG (+ built-in embeddings) |
| **Supabase** | 500MB Postgres + 1GB file storage + Auth | Database + file storage |
| **Neon** | 512MB Postgres, auto-suspend | Alternative free PostgreSQL |
| **Cloudflare R2** | 10GB storage, no egress fees | CV file storage |
| **Firebase Storage** | 5GB storage | CV file storage |
| **Vercel** | Free hobby tier | Frontend hosting (Next.js) |
| **Railway** or **Render** | Free tier with limits | Backend hosting (FastAPI) |
| **Claude API** | Free credits for new accounts | LLM for Q&A |
| **OpenAI API** | Free credits for new accounts | Alternative LLM |

---

## 5. UI Wireframes (Page Descriptions)

The following are suggested pages. You are free to design the UI layout and navigation by yourself.

### Page 1: CV Knowledge Base
- Drag-and-drop file upload area (PDF, DOCX)
- Upload progress bar and processing status
- Table view of all CVs: Name, Email, Skills (tags), Date Uploaded
- Search and filter capabilities
- Delete button per CV
- Click to preview CV content

### Page 2: Conversation List
- List of all conversations with title, last message preview, date
- "New Conversation" button
- Click to open a conversation
- Delete and reset actions per conversation

### Page 3: Chat Interface
- Chat interface (similar to ChatGPT/Claude)
- Full message history for the current conversation
- Message input with send button
- AI responses with citations to specific CVs
- "New Conversation" and "Reset Conversation" buttons in the header

---

## 6. Processing Pipeline

```
CV Upload
    │
    ▼
File Validation (type, size)
    │
    ▼
Text Extraction (PDF/DOCX → plain text)
    │
    ▼
Chunk text into segments
    │
    ▼
Generate Embeddings (chunks → vectors)
    │
    └──▶ Store in Qdrant / Pinecone
    │
    ▼
CV added to Knowledge Base — Ready for Q&A


User asks a question (in a Conversation)
    │
    ▼
Retrieve relevant CV chunks via RAG (Qdrant / Pinecone)
    │
    ▼
Build prompt with conversation history + retrieved context
    │
    ▼
LLM generates grounded answer
    │
    ▼
Store message in Conversation history
```

---

## 7. Deliverables

| # | Deliverable | Description |
|---|------------|-------------|
| 1 | Source code | Full source code in a Git repository |
| 2 | README | Setup instructions, environment variables, how to run |
| 3 | API documentation | Endpoint descriptions with request/response examples |
| 4 | Demo | Working demo with at least 5 sample CVs uploaded and assessed |
| 5 | Presentation | 10-15 minute walkthrough of architecture and features |

---

## 8. Milestones & Timeline (Suggested: 4 Weeks)

| Week | Milestone | Key Tasks |
|------|-----------|-----------|
| **Week 1** | Project Setup & CV Upload | Set up project structure, database, file upload API, basic frontend |
| **Week 2** | AI Processing | Implement text extraction, structured data extraction via LLM, embedding generation, vector storage |
| **Week 3** | Q&A Chat & Scoring | Build RAG pipeline, chat interface, assessment/scoring logic |
| **Week 4** | Polish & Demo | UI refinement, error handling, testing, documentation, demo preparation |

