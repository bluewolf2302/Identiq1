import {
  AiProviderError,
  MissingAiProviderConfigurationError,
  MissingAiProviderCredentialsError,
  type AiProvider,
  type AiProviderRequest,
  type ProviderConfiguration,
  type ResolvedProviderConfiguration,
} from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "TONE_AND_TERMINOLOGY",
              "FACT_VERIFICATION",
              "PROMOTIONAL_CLAIM",
              "VISUAL_COMPLIANCE",
              "ACCESSIBILITY",
            ],
          },
          severity: {
            type: "string",
            enum: ["HIGH", "MEDIUM", "LOW", "INFO"],
          },
          status: {
            type: "string",
            enum: [
              "SUPPORTED",
              "CONFLICTING",
              "UNVERIFIED",
              "NEEDS_HUMAN_REVIEW",
            ],
          },
          issue: { type: "string" },
          description: { type: "string" },
          detectedValue: { type: ["string", "null"] },
          expectedValue: { type: ["string", "null"] },
          explanation: { type: "string" },
          suggestedCorrection: { type: ["string", "null"] },
          evidenceReferences: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sourceId: { type: "string" },
                versionId: { type: "string" },
                sourceTitle: { type: "string" },
                sourceType: { type: "string" },
                excerpt: { type: ["string", "null"] },
                pageNumber: { type: ["integer", "null"] },
                section: { type: ["string", "null"] },
              },
              required: [
                "sourceId",
                "versionId",
                "sourceTitle",
                "sourceType",
                "excerpt",
                "pageNumber",
                "section",
              ],
              additionalProperties: false,
            },
          },
          confidence: { type: ["number", "null"] },
        },
        required: [
          "category",
          "severity",
          "status",
          "issue",
          "description",
          "detectedValue",
          "expectedValue",
          "explanation",
          "suggestedCorrection",
          "evidenceReferences",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter";
  private readonly config: ResolvedProviderConfiguration;

  constructor(config: ProviderConfiguration) {
    if (!config.apiKey.trim()) {
      throw new MissingAiProviderCredentialsError(this.name);
    }
    if (!config.model.trim()) {
      throw new MissingAiProviderConfigurationError(this.name, "OPENROUTER_MODEL");
    }
    this.config = {
      ...config,
      apiKey: config.apiKey.trim(),
      model: config.model.trim(),
      timeoutMs: config.timeoutMs ?? 30_000,
      fetcher: config.fetcher ?? fetch,
    };
  }

  async analyze(request: AiProviderRequest): Promise<unknown> {
    return fetchJson(
      this.config.fetcher,
      OPENROUTER_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1800,
          reasoning: { effort: "minimal" },
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "identiq_findings",
              strict: true,
              schema: CANDIDATE_SCHEMA,
            },
          },
        }),
      },
      this.name,
      this.config.timeoutMs,
    );
  }
}

async function fetchJson(
  fetcher: NonNullable<ProviderConfiguration["fetcher"]>,
  url: string,
  init: RequestInit,
  provider: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new AiProviderError(provider, `${provider} request failed.`, {
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiProviderError(provider, `${provider} returned no structured content.`);
    }
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new AiProviderError(provider, `${provider} returned malformed JSON.`, {
        cause: error,
      });
    }
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    throw new AiProviderError(
      provider,
      error instanceof DOMException && error.name === "AbortError"
        ? `${provider} request timed out.`
        : `${provider} request could not be completed.`,
      { retryable: true, cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}
