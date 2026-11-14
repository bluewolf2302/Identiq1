import { GoogleGenAI, Type } from "@google/genai";
import { GeminiVisionResponseSchema } from "../schemas";
import type {
  BrandVisualContext,
  GeminiVisionAdapter,
  VisionPageInput,
  VisualFinding,
} from "../types";
import { buildVisionPrompt } from "./vision-prompts";

export class GeminiVisionError extends Error {
  readonly code:
    | "MISSING_CREDENTIALS"
    | "INVALID_CREDENTIALS"
    | "RATE_LIMITED"
    | "TIMEOUT"
    | "MODEL_NOT_FOUND"
    | "MALFORMED_JSON"
    | "EMPTY_OUTPUT"
    | "INVALID_SCHEMA"
    | "PROVIDER_ERROR";
  readonly retryable: boolean;

  constructor(
    code: GeminiVisionError["code"],
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "GeminiVisionError";
    this.code = code;
    this.retryable = retryable;
  }
}

const VISION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ruleId: { type: Type.STRING, nullable: true },
          category: {
            type: Type.STRING,
            enum: ["logo", "colour", "typography", "layout", "visual_consistency"],
          },
          title: { type: Type.STRING },
          explanation: { type: Type.STRING },
          expectedValue: { type: Type.STRING },
          observedValue: { type: Type.STRING },
          sourceId: { type: Type.STRING, nullable: true },
          sourceVersion: { type: Type.STRING, nullable: true },
          guidelinePageNumber: { type: Type.INTEGER, nullable: true },
          excerpt: { type: Type.STRING, nullable: true },
          boundingBox: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              width: { type: Type.NUMBER },
              height: { type: Type.NUMBER },
            },
            required: ["x", "y", "width", "height"],
          },
          evidenceDescription: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          reviewStatus: {
            type: Type.STRING,
            enum: ["candidate", "uncertain", "needs_human_review"],
          },
          severity: {
            type: Type.STRING,
            enum: ["HIGH", "MEDIUM", "LOW", "INFO"],
          },
          suggestedCorrection: { type: Type.STRING, nullable: true },
        },
        required: [
          "category",
          "title",
          "explanation",
          "expectedValue",
          "observedValue",
          "evidenceDescription",
          "confidence",
          "reviewStatus",
          "severity",
        ],
      },
    },
  },
  required: ["findings"],
};

export function validateAndMapGeminiVisionResponse(
  rawJson: unknown,
  brandContext: BrandVisualContext,
  assetId: string,
  pageNumber: number,
  detector: "gemini_vision" | "openrouter_vision" = "gemini_vision",
): { findings: VisualFinding[]; validationFailures: number } {
  const parsed = GeminiVisionResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new GeminiVisionError(
      "INVALID_SCHEMA",
      `${detector === "openrouter_vision" ? "OpenRouter" : "Gemini"} vision response failed schema validation.`,
    );
  }

  const validSourceIds = new Set(brandContext.validSourceIds);
  const validVersions = new Set(brandContext.validVersions);
  const validFindings: VisualFinding[] = [];
  let validationFailures = 0;

  const prefix = detector === "openrouter_vision" ? "vis-openrouter" : "vis-gemini";

  for (const [idx, item] of parsed.data.findings.entries()) {
    // Reject findings that fabricate non-existent source IDs or versions
    if (item.sourceId && !validSourceIds.has(item.sourceId)) {
      validationFailures++;
      continue;
    }
    if (item.sourceVersion && !validVersions.has(item.sourceVersion)) {
      validationFailures++;
      continue;
    }

    const matchingRule = item.ruleId
      ? brandContext.rules.find((r) => r.ruleId.toUpperCase() === item.ruleId!.toUpperCase())
      : undefined;

    const resolvedSourceId = item.sourceId ?? matchingRule?.sourceId ?? null;
    const resolvedVersion = item.sourceVersion ?? matchingRule?.sourceVersion ?? null;
    const resolvedTitle = matchingRule?.sourceTitle ?? null;

    validFindings.push({
      id: `${prefix}-p${pageNumber}-${idx + 1}`,
      ruleId: item.ruleId ?? matchingRule?.ruleId ?? null,
      category: item.category,
      title: item.title,
      explanation: item.explanation,
      expectedValue: item.expectedValue,
      observedValue: item.observedValue,
      sourceReference: {
        sourceId: resolvedSourceId,
        sourceVersion: resolvedVersion,
        sourceTitle: resolvedTitle,
        pageNumber: item.guidelinePageNumber ?? matchingRule?.pageNumber ?? null,
        excerpt: item.excerpt ?? matchingRule?.excerpt ?? null,
      },
      creativeEvidence: {
        assetId,
        pageNumber,
        boundingBox: item.boundingBox ?? null,
        description: item.evidenceDescription,
      },
      confidence: Math.max(0, Math.min(1, item.confidence)),
      reviewStatus: item.reviewStatus,
      severity: item.severity,
      detector,
      classification:
        item.reviewStatus === "candidate" ? "possible_mismatch" : "possible_mismatch",
      suggestedCorrection: item.suggestedCorrection ?? undefined,
    });
  }

  return { findings: validFindings, validationFailures };
}

function classifyProviderError(error: unknown): GeminiVisionError {
  if (error instanceof GeminiVisionError) return error;
  const msg = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;

  if (status === 401 || status === 403 || /API_KEY_INVALID|PERMISSION_DENIED|unauthorized/i.test(msg)) {
    return new GeminiVisionError("INVALID_CREDENTIALS", "Gemini API credentials were rejected.", false);
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|rate limit|429/i.test(msg)) {
    return new GeminiVisionError("RATE_LIMITED", "Gemini API rate limit exceeded.", true);
  }
  if (status === 404 || /NOT_FOUND/i.test(msg)) {
    return new GeminiVisionError("MODEL_NOT_FOUND", "Configured Gemini vision model was not found.", false);
  }
  if (/timeout|aborted|AbortError/i.test(msg)) {
    return new GeminiVisionError("TIMEOUT", "Gemini vision request timed out.", true);
  }
  return new GeminiVisionError(
    "PROVIDER_ERROR",
    "Gemini vision request could not be completed.",
    status === undefined || status >= 500,
  );
}

export type GeminiClientGenerateFn = (args: {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  imageBase64: string;
  mimeType: string;
  signal: AbortSignal;
}) => Promise<string | undefined>;

export class SdkGeminiVisionAdapter implements GeminiVisionAdapter {
  readonly providerName = "gemini-vision";
  readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly generateFn: GeminiClientGenerateFn;
  private readonly assetId: string;

  constructor(options: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    maxRetries?: number;
    assetId?: string;
    generateFn?: GeminiClientGenerateFn;
  }) {
    const model = options.model?.trim() || "gemini-4-hydrogen";
    this.modelName = model;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.assetId = options.assetId ?? "creative";

    if (options.generateFn) {
      this.generateFn = options.generateFn;
      return;
    }

    const apiKey = options.apiKey?.trim() ?? "";
    if (!apiKey) {
      throw new GeminiVisionError(
        "MISSING_CREDENTIALS",
        "GEMINI_API_KEY is not configured for vision analysis.",
      );
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    this.generateFn = async ({
      model: targetModel,
      systemInstruction,
      userPrompt,
      imageBase64,
      mimeType,
      signal,
    }) => {
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            { text: userPrompt },
          ],
        },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: VISION_RESPONSE_SCHEMA,
          abortSignal: signal,
        },
      });
      return response.text;
    };
  }

  async analyzePage(
    input: VisionPageInput,
  ): Promise<{ findings: VisualFinding[]; retryCount: number; validationFailures: number }> {
    const { systemInstruction, userPrompt } = buildVisionPrompt(input);
    const imageBase64 = input.pngBuffer.toString("base64");

    let retryCount = 0;
    let lastError: GeminiVisionError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const rawText = await Promise.race([
          this.generateFn({
            model: this.modelName,
            systemInstruction,
            userPrompt,
            imageBase64,
            mimeType: "image/png",
            signal: controller.signal,
          }),
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener("abort", () =>
              reject(new GeminiVisionError("TIMEOUT", "Gemini vision request timed out.", true)),
            );
          }),
        ]);

        if (!rawText || !rawText.trim()) {
          throw new GeminiVisionError("EMPTY_OUTPUT", "Gemini vision returned empty output.", true);
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          throw new GeminiVisionError("MALFORMED_JSON", "Gemini vision returned malformed JSON.", false);
        }

        const validated = validateAndMapGeminiVisionResponse(
          parsedJson,
          input.brandContext,
          this.assetId,
          input.pageNumber,
        );

        return {
          findings: validated.findings,
          retryCount,
          validationFailures: validated.validationFailures,
        };
      } catch (err) {
        const classified = classifyProviderError(err);
        lastError = classified;
        if (!classified.retryable || attempt >= this.maxRetries) {
          throw classified;
        }
        retryCount++;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new GeminiVisionError("PROVIDER_ERROR", "Gemini vision failed.");
  }
}

export function createGeminiVisionAdapterFromEnvironment(
  assetId: string,
  overrides: { timeoutMs?: number; maxRetries?: number } = {},
): GeminiVisionAdapter | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-4-hydrogen";
  return new SdkGeminiVisionAdapter({
    apiKey,
    model,
    assetId,
    timeoutMs: overrides.timeoutMs,
    maxRetries: overrides.maxRetries,
  });
}
