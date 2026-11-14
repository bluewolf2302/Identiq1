# Next.js governance API integration

The `/api/analyze` route uses the `AnalysisOrchestrator` for text and
multimodal governance workflows. The legacy `lib/ai/analyzer.ts` is no longer
imported by the route and is not an active production analysis path.

## Server-side composition

`lib/analysis/composition-root.ts` constructs the route's dependencies:

1. `MockBrandKnowledgeRepository`
2. `BrandContextService`
3. `DeterministicTextGovernanceEngine`
4. `createAiAnalysisServiceFromEnvironment()` with configurable provider
   priority and fallback
5. `AnalysisOrchestrator`

The composition root is server-only by usage: it is imported by the server
route, not by client components. Provider clients and credentials remain
inside the server-side AI providers.

The repository is explicitly mock-backed in this phase. The demo submission
collection `Teralune Brand Identity & AI Guidelines v1.0` maps only to the
dedicated `demo-brand-teralune` fixture, which is grounded in the local
fictional brand-guidelines PDF. The generic `brand-001` fixture remains
available for contract tests but is not associated with Teralune. The fixture
is not connected to Supabase or live Knowledge Hub data. No Supabase schema or
migration was added.

The provider factory supports `gemini` and `openrouter` through the
server-only `AI_PRIMARY_PROVIDER` setting. When both providers are configured,
the selected provider is called first and the other provider is attempted once
only after a primary failure. If only one provider is configured, it is treated
as primary and a successful response reports `fallbackUsed: false`.

## Request adapter

`lib/analysis/api-adapters.ts` validates the existing frontend payload before
mapping it to the Phase 1 `AnalysisRequest` contract:

- `title` becomes `campaignName`.
- `textContent` becomes `contentText`.
- The existing `submissionId` is preserved, or one is generated before
  orchestration.
- The Teralune guideline collection is explicitly mapped to the actual
  `demo-brand-teralune` mock fixture.
- Aura Botanicals, Northstar Pay and other unrelated seed collections are not
  mapped to a backend brand and are rejected for new analysis requests.
- Unknown collections are rejected with HTTP 422 rather than guessed.
- `knowledgeSummary` is intentionally ignored as evidence. Plain UI strings
  are not equivalent to approved structured brand records.
- Asset data is converted into the backend `creativePayload` contract. The
  visual pipeline validates the file, extracts OCR, runs deterministic visual
  checks, and optionally invokes vision providers. Durable asset storage is not
  implemented in this phase.
- No content platform is inferred from the UI `contentType`.

The frontend creates the submission ID before calling the API and uses the
returned ID as the stored review ID, so the identifier remains stable through
the request and Review Studio navigation.

## Response adapter

The response adapter validates the canonical `AnalysisResponse` and maps it to
the existing UI response model. It deliberately:

- Maps canonical categories and severities to the current display categories.
- Preserves descriptions, detected values, expected values, locations,
  evidence references, and source version IDs.
- Maps backend evidence statuses without treating unverified findings as
  supported.
- Leaves findings unresolved; review resolution is a separate workflow.
- Uses an honest `"No evidence reference available"` display value when the
  canonical finding contains no evidence references. It does not invent a
  source identifier.
- Derives the legacy display compliance score from finding severities because
  the Phase 1 response contract does not define a score.
- Preserves `analysisStatus`, provider name, fallback usage, submission ID, and
  analysis run ID.

## Route flow and errors

`app/api/analyze/route.ts`:

1. Parses JSON safely.
2. Validates and adapts the frontend request.
3. Invokes the injected composition-root orchestrator.
4. Validates and adapts the canonical response.
5. Returns safe HTTP errors.

The route never returns a clean success when AI analysis fails. Typical status
mapping is:

- `200`: completed or partial validated analysis.
- `400`: malformed JSON or frontend request.
- `404`: no brand context for the selected brand.
- `422`: no configured demo mapping for the selected collection.
- `500`: deterministic or unexpected orchestration failure.
- `502`: invalid final response or repository failure.
- `503`: AI semantic analysis unavailable when reported through the typed
  orchestrator error.

Provider credentials and raw provider errors are not included in responses.

The frontend validates successful response payloads before creating a local
review, so failed requests do not create a review or navigate to Review Studio.

## Manual API smoke test

Start the application separately:

```text
npm run dev
```

With a configured server-side provider, run:

```text
npm run ai:smoke:api
```

The smoke test sends a real HTTP POST to `http://localhost:3000/api/analyze`
using the controlled Teralune sample. It checks response metadata and evidence
source IDs without printing credentials. It is not part of `npm test` and
requires the local server and an available configured provider.

## Legacy analyzer status

`lib/ai/analyzer.ts` remains in the repository for compatibility with the
earlier prototype and is covered by no route import. It should be removed or
formally deprecated in a future cleanup after downstream references are
retired. The API route does not use its mock fallback.

## Remaining blockers

- The repository is mock-backed until a live Supabase repository and approved
  source/version model are available.
- The current UI has no authenticated organization or brand selector.
- Only the Teralune collection currently has a backend demo fixture mapping.
- Visual assets are accepted by the UI but are not analyzed or persisted by
  this phase.
- The UI still uses localStorage for reviews and review decisions.
- The display compliance score is derived at the adapter boundary, not a
  canonical backend score.
- Image and PDF attachments are processed by the local multimodal pipeline.
  OCR text is combined with manual copy, visual and text findings are merged,
  and page/bounding-box metadata is preserved. Durable asset storage remains
  unavailable until the storage owner supplies its repository interface.

## Review Studio and persistence boundary

The Review Studio consumes the adapted response through the shared
`IdentiqProvider`. Findings retain evidence references, source versions,
detector, confidence, corrections, human-review state, reviewer decisions,
comments, and resolution metadata. Reviewer actions create scoped activity
events and survive refresh through the existing `identiq_workspace_v2`
localStorage store.

This is local prototype persistence, not shared or authenticated persistence.
`lib/supabase/client.ts` exposes only an integration status check and a
placeholder sync function; it does not connect to Supabase. No production
database, authentication, organization isolation, or storage implementation
was available in this branch, so the analysis route continues to use
`MockBrandKnowledgeRepository`.

## Current cross-owner integration status

- **Knowledge Hub:** the UI stores local `KnowledgeEntry` records, while the
  analysis pipeline consumes structured `BrandKnowledgeRecord` values from the
  repository interface. There is no adapter from the local UI entries to that
  repository, so only the explicit Teralune and contract-test fixtures reach
  analysis.
- **Database/auth/storage:** no live repository, migration, authentication, or
  storage interface is present. The local provider remains functional and
  explicitly must not be treated as a shared database.
- **Multimodal processing:** the existing image/PDF validation, OCR,
  deterministic visual checks, vision fallback, partial-status handling, and
  page/bounding-box contracts are active and unchanged.
- **Dashboard/activity:** activity metadata includes finding decisions, while
  Review Studio uses the existing audit-history builder for review-scoped
  decisions, comments, corrections, evidence, and resolution snapshots.

Source versions are carried in each finding's evidence references and are not
replaced when a later guideline version is introduced. Historical reviews retain
their returned references in local state; a production repository must preserve
the same immutable evidence fields when its interface becomes available.
