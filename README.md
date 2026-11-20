<!-- IdentIQ README -->

<div align="center">

# IdentIQ

### Evidence-led brand governance. Clear decisions. Consistent brands.

Review campaign content against trusted brand knowledge, surface supporting evidence, and help teams make informed approval decisions — all in one workspace.

<br />

<a href="https://identiq-iota.vercel.app/">
  <img src="https://img.shields.io/badge/OPEN_IDENTIQ-LIVE_APP-171717?style=for-the-badge&logo=vercel&logoColor=white" alt="Open IdentIQ live app" />
</a>

<br /><br />

<a href="https://identiq-iota.vercel.app/"><strong>Launch the live application →</strong></a>
&nbsp; · &nbsp;
<a href="https://github.com/bluewolf2302/Identiq1">View source code</a>

<br /><br />

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)

</div>

---

## At a glance

**IdentIQ** is a brand governance and compliance workspace for teams that need to check whether marketing content follows approved brand guidelines. It brings brand rules, creative assets, AI-assisted analysis, evidence review, and approval activity into one workflow.

Instead of treating a content check as a simple pass/fail result, IdentIQ helps reviewers distinguish between:

| Evidence status | What it means |
| --- | --- |
| **Supported** | The content is supported by the available brand evidence. |
| **Conflicting** | The content appears to conflict with a documented brand rule. |
| **Unverified** | There is not enough available evidence to confirm the claim or rule. |

## What you can do with IdentIQ

| Workspace | Capabilities |
| --- | --- |
| **Brand Knowledge Hub** | Organise brand guidelines and governance rules, manage their review status, and draft rules from PDF guidelines. |
| **Asset Library** | Keep approved brand references such as logos, colour references, photography, and templates together. |
| **New Review** | Submit campaign copy, images, and PDFs for content and visual checks, including document text extraction and OCR. |
| **Review Studio** | Inspect findings alongside submitted content, review evidence, explore suggested replacements, and record reviewer decisions and comments. |
| **Approvals** | Work through pending reviews and approve content or request changes. |
| **Activity & Reports** | Follow review activity, view compliance summaries, print review dossiers, and export structured CSV data. |
| **Settings** | Manage the reviewer profile, evidence policies, guided tour, and sample workspace data. |

## How the workflow fits together

1. **Build brand knowledge** — organise the rules and approved references your team wants to enforce.
2. **Submit content** — add campaign copy, a creative, or a PDF for review.
3. **Analyse against evidence** — combine document and visual extraction with AI-assisted governance checks.
4. **Review the findings** — inspect what is supported, conflicting, or still unverified.
5. **Make a decision** — record an approval or request changes, then follow the activity and reporting trail.

## Technology

| Layer | Technologies |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript |
| Interface | Tailwind CSS v4, Lucide React, Motion |
| AI analysis | Google Gemini and OpenRouter integrations, structured validation, deterministic fallback |
| Document & image processing | PDF.js, PDF-lib, Tesseract.js, Sharp |
| Data & authentication integration | Supabase client and server libraries / API boundaries |
| Quality checks | Node.js test runner through tsx, TypeScript, ESLint, Next.js production build |

## Run locally

### Requirements

- Node.js 22 or later
- npm

### 1. Clone the repository

```bash
git clone https://github.com/bluewolf2302/Identiq1.git
cd Identiq1
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example environment file:

**Windows PowerShell**

```powershell
Copy-Item .env.example .env.local
```

**macOS / Linux**

```bash
cp .env.example .env.local
```

Add the credentials for the integrations you intend to use. The example file documents the supported AI and Supabase settings, including:

- AI provider and model configuration
- Gemini or OpenRouter API credentials
- Supabase project URL and publishable/anonymous key
- Server-side Supabase secret key for protected server operations

AI and shared-workspace features need their corresponding valid credentials. Keep secrets in your local environment or deployment provider; **never commit `.env.local` or expose server-side keys in browser code.**

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm test` | Run the automated test suite |
| `npx tsc --noEmit` | Check TypeScript types |
| `npm run lint` | Run ESLint |
| `npm run build` | Create a production build |

## Project links

- **Live application:** [https://identiq-iota.vercel.app](https://identiq-iota.vercel.app)
- **Source repository:** [https://github.com/bluewolf2302/Identiq1](https://github.com/bluewolf2302/Identiq1)

---

<div align="center">

**IdentIQ — make every brand decision evidence-led.**

<a href="https://identiq-iota.vercel.app/"><strong>Visit the live app →</strong></a>

</div>
