# AI Semantic Text Analysis

The AI layer in [`lib/ai`](../lib/ai) complements the deterministic engine; it
does not replace or rewrite it. Providers are server-side, injectable, and
return only evidence-validated `ReviewFinding` objects.

## Architecture

- `types.ts` defines the provider seam, configuration, and typed failures.
- `prompt-builder.ts` separates system instructions, approved context, and
  submitted content.
- `openrouter-provider.ts` calls OpenRouter's chat-completions endpoint with a
  strict JSON-schema response format.
- `gemini-provider.ts` calls Gemini `generateContent` with JSON response
  configuration.
- `response-validator.ts` validates candidate structure, source IDs, versions,
  locations, and final `ReviewFinding` compatibility.
- `ai-analysis-service.ts` orchestrates one primary call and at most one
  fallback call.

## Provider configuration

Set server-only variables using `.env` or the deployment environment:

```text
AI_PRIMARY_PROVIDER=gemini
OPENROUTER_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
OPENROUTER_MODEL=google/gemini-3.8-flash
```

`.env.example` contains placeholders only. Do not use `NEXT_PUBLIC_` prefixes.
`AI_PRIMARY_PROVIDER` accepts `gemini` or `openrouter` and defaults to `gemini`.
Model identifiers are required and use the format supported by the selected
provider account: Gemini model names for Gemini and OpenRouter model IDs such as
`google/gemini-3.8-flash` for OpenRouter. The example values are suggestions;
confirm that the selected model is available to the account. No model fallback
is embedded in the application.

## Fallback behavior

Construct providers only when both credentials and model are configured. The
selected provider is primary when configured; if only the other provider is
configured, it becomes primary so a successful single-provider call reports
`fallbackUsed: false`. When both are configured, the non-selected provider is
used once as fallback if the primary call fails. It never retries indefinitely
and never turns provider failure into an empty successful result. If all
providers fail, it throws `AiAnalysisUnavailableError` with safe messages.

## Supported AI checks

The prompt asks the model to analyze contextual tone, meaningful guideline
inconsistency, semantic claim conflicts, and unsupported claims using only the
provided approved context. Submitted text is explicitly untrusted. Findings
that duplicate deterministic findings by category, issue, and location are
removed.

## Evidence validation

AI candidates must include at least one evidence reference. Every source ID and
version ID must exist in the supplied `BrandContext`. Location quotes must
match the submitted text and offsets must be in bounds. Candidates that fail
these checks are rejected; fabricated references are never converted into
findings.

## Security precautions

- Provider credentials are read only by server-side provider constructors.
- Credentials are never inserted into prompts, logs, or public error messages.
- Provider errors are replaced with safe messages.
- Submitted content is serialized as data and treated as untrusted input.
- No provider call is made by the frontend in this phase.

## Tested functionality and limitations

Tests cover successful provider parsing, fallback, unavailable providers,
timeouts, malformed responses, invalid/fabricated evidence, semantic findings,
clean results, deduplication, and prompt-injection text.

Run the ordinary tests with `npm test`. The live Gemini smoke test is separate:

```text
npm run ai:smoke:gemini
```

It loads the local private environment, makes one real structured request, and
validates an empty `findings` array. It requires an active `GEMINI_API_KEY` and
`GEMINI_MODEL`, may consume provider quota, and is never run by `npm test`.

The provider schema intentionally uses a small internal candidate shape because
the public Phase 1 contracts do not include a first-class structured guideline
or claim model. Semantic quality remains model-dependent, and no API route,
frontend integration, or persistence is included in this phase. The smoke test
is an explicit live check; its result depends on account access, model
availability, network connectivity, and quota.

Provider API references:

- [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter API reference](https://openrouter.ai/docs/api_reference/overview)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini text generation](https://ai.google.dev/gemini-api/docs/generate-content)
