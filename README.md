# Identiq — Brand Governance & Compliance Platform

Identiq is an evidence-driven brand governance platform designed to help brand, legal, and marketing teams inspect campaign copy, visual creatives, PDFs, and product documentation against verified brand knowledge.

---

## Product Entry & Core Workflow

1. **First-Visit Landing Page (`/`)**: Introduces Identiq's evidence-backed review approach (`Supported`, `Conflicting`, and `Unverified` distinctions) with a single `"Get Started"` flow into workspace setup.
2. **One-Time Profile Setup**: Collects a required reviewer name and lets you choose a bespoke geometric avatar preset or upload a custom photo (`PNG`/`JPG`/`WEBP`, up to `512 KB`). Returning visitors restore their profile and enter the dashboard directly.
3. **Optional Guided Introduction**: A five-step walkthrough introducing Brand Knowledge Hub, Asset Library, New Review, Review Studio, and Approvals & Reports, replayable anytime from the top bar or Settings.
4. **Dashboard (`/`)**: Compliance KPI summary, multi-filter bar (content type, brand collection, date range, search), recent review cards, interactive governance analytics (`Activity`, `Status`, `Severity`, `Topics`), and recent activity.
5. **Brand Knowledge Hub (`/knowledge-hub`)**: Complete CRUD and approval management across brand governance sections plus session PDF guideline rule drafting.
6. **Asset Library (`/assets`)**: Visual asset library for approved logos, color references, photography, and templates.
7. **New Review (`/reviews/new`)**: Multimodal submission pipeline accepting campaign copy, images, and PDFs (including the Teralune sample PDF fixture), running OCR, visual rule checks, and AI governance analysis.
8. **Review Studio (`/studio`)**: Split-view inspection workspace with highlighted copy, creative bounding-box overlays, evidence status filtering, guided replacements, reviewer decisions, and comment threads.
9. **Approvals (`/approvals`)**: Queue for inspecting pending reviews, checking resolution progress, and signing off with `Approve Content` or `Request Changes`.
10. **Activity & Reports (`/activity`, `/reports`)**: Full chronological activity feed, brand compliance reports, printable review dossiers, and structured CSV exports.
11. **Settings (`/settings`)**: Edit reviewer name, role, and avatar; configure evidence policies; replay the product tour; or safely reset sample workspace data.

---

## Technology Stack

- **Framework**: Next.js 16 (App Router)
- **UI & Styling**: Tailwind CSS v4, Lucide React icons, `motion/react`
- **AI Integration**: Server-side routes (`/api/analyze`) supporting OpenRouter and Gemini (`@google/genai`) with structured schema validation and deterministic fallback
- **Persistence**: Dedicated local viewer profile (`identiq_viewer_profile_v1`), browser demo state, and Supabase auth/multi-tenant persistence boundaries (`lib/supabase/client.ts`)
- **Verification**: Node built-in test runner (`npm test`), TypeScript (`npx tsc --noEmit`), ESLint (`npm run lint`), and Next.js production build (`npm run build`)

---

## Getting Started

### Prerequisites
- Node.js 22+ & npm

### Installation & Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables (optional for live AI / team workspace persistence):
   ```bash
   cp .env.example .env.local
   ```
3. Run the development server on port 3000:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.
5. Run automated tests and type checks:
   ```bash
   npm test
   npx tsc --noEmit
   npm run lint
   ```
