import { GeminiVisionError, validateAndMapGeminiVisionResponse } from "./gemini-vision";
import { buildVisionPrompt } from "./vision-prompts";
import type {
  GeminiVisionAdapter,
  VisionPageInput,
  VisualFinding,
} from "../types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_OPENROUTER_VISION_MODELS = [
  "google/gemini-2.0-flash-001",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.2-11b-vision-instruct",
] as const;

export interface OpenRouterVisionAdapterOptions {
  apiKey?: string;
  models?: string[];
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  assetId?: string;
  fetcher?: typeof fetch;
}

function cleanJsonString(raw: string): string {
  const trimmed = raw.trim();
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return trimmed;
}

function classifyOpenRouterError(error: unknown, status?: number): GeminiVisionError {
  if (error instanceof GeminiVisionError) return error;
  const msg = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403 || /unauthorized|invalid api key|forbidden/i.test(msg)) {
    return new GeminiVisionError(
      "INVALID_CREDENTIALS",
      "OpenRouter API credentials were rejected.",
      false,
    );
  }
  if (status === 429 || /rate limit|429|quota/i.test(msg)) {
    return new GeminiVisionError(
      "RATE_LIMITED",
      "OpenRouter vision rate limit exceeded.",
      true,
    );
  }
  if (status === 404 || /not found/i.test(msg)) {
    return new GeminiVisionError(
      "MODEL_NOT_FOUND",
      "Configured OpenRouter vision model was not found.",
      false,
    );
  }
  if (error instanceof DOMException && error.name === "AbortError" || /timeout|aborted/i.test(msg)) {
    return new GeminiVisionError("TIMEOUT", "OpenRouter vision request timed out.", true);
  }
  return new GeminiVisionError(
    "PROVIDER_ERROR",
    `OpenRouter vision request failed: ${msg}`,
    status === undefined || status >= 500,
  );
}

export class OpenRouterVisionAdapter implements GeminiVisionAdapter {
  readonly providerName = "openrouter-vision";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly models: string[];
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly assetId: string;
  private readonly fetcher: typeof fetch;

  constructor(options: OpenRouterVisionAdapterOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new GeminiVisionError(
        "MISSING_CREDENTIALS",
        "OPENROUTER_API_KEY is not configured for vision analysis.",
        false,
      );
    }
    this.apiKey = apiKey;

    const candidateModels = options.models && options.models.length > 0
      ? options.models
      : options.model
        ? [options.model]
        : [...DEFAULT_OPENROUTER_VISION_MODELS];

    this.models = candidateModels;
    this.modelName = this.models[0] ?? DEFAULT_OPENROUTER_VISION_MODELS[0];
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 0;
    this.assetId = options.assetId ?? "creative";
    this.fetcher = options.fetcher ?? fetch;
  }

  async analyzePage(
    input: VisionPageInput,
  ): Promise<{ findings: VisualFinding[]; retryCount: number; validationFailures: number; modelUsed?: string }> {
    const { systemInstruction, userPrompt } = buildVisionPrompt(input);
    const imageBase64 = input.pngBuffer.toString("base64");

    let retryCount = 0;
    let lastError: GeminiVisionError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const requestBody = {
          model: this.modelName,
          ...(this.models.length > 1 ? { models: this.models } : {}),
          max_tokens: 2048,
          messages: [
            {
              role: "system",
              content: systemInstruction,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: userPrompt,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        };

        const res = await this.fetcher(OPENROUTER_CHAT_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://identiq.local",
            "X-Title": "Identiq Multimodal Brand Governance",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw classifyOpenRouterError(new Error(errText || `HTTP ${res.status}`), res.status);
        }

        const payload = (await res.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
        };

        const rawContent = payload.choices?.[0]?.message?.content;
        if (!rawContent || !rawContent.trim()) {
          throw new GeminiVisionError("EMPTY_OUTPUT", "OpenRouter vision returned empty output.", true);
        }

        const cleaned = cleanJsonString(rawContent);
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(cleaned);
        } catch {
          throw new GeminiVisionError(
            "MALFORMED_JSON",
            "OpenRouter vision returned malformed JSON.",
            false,
          );
        }

        const validated = validateAndMapGeminiVisionResponse(
          parsedJson,
          input.brandContext,
          this.assetId,
          input.pageNumber,
          "openrouter_vision",
        );

        return {
          findings: validated.findings,
          retryCount,
          validationFailures: validated.validationFailures,
          modelUsed: payload.model ?? this.modelName,
        };
      } catch (err) {
        const classified = classifyOpenRouterError(err);
        lastError = classified;
        if (!classified.retryable || attempt >= this.maxRetries) {
          throw classified;
        }
        retryCount++;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new GeminiVisionError("PROVIDER_ERROR", "OpenRouter vision failed.");
  }
}

export function createOpenRouterVisionAdapterFromEnvironment(
  assetId: string,
  overrides: { timeoutMs?: number; maxRetries?: number; fetcher?: typeof fetch } = {},
): OpenRouterVisionAdapter | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const rawEnvModels =
    process.env.OPENROUTER_VISION_MODELS ||
    process.env.OPENROUTER_VISION_MODEL ||
    process.env.OPENROUTER_MODEL;

  const models = rawEnvModels
    ? rawEnvModels
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : [...DEFAULT_OPENROUTER_VISION_MODELS];

  return new OpenRouterVisionAdapter({
    apiKey,
    models,
    assetId,
    timeoutMs: overrides.timeoutMs,
    maxRetries: overrides.maxRetries,
    fetcher: overrides.fetcher,
  });
}
