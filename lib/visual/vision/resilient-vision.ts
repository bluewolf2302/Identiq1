import {
  type GeminiVisionAdapter,
  type VisionPageInput,
  type VisualFinding,
} from "../types";
import {
  createGeminiVisionAdapterFromEnvironment,
  GeminiVisionError,
} from "./gemini-vision";
import {
  createOpenRouterVisionAdapterFromEnvironment,
} from "./openrouter-vision";

export interface ResilientVisionAdapterOptions {
  primary?: GeminiVisionAdapter | null;
  fallback?: GeminiVisionAdapter | null;
  onFallbackAttempt?: (info: {
    pageNumber: number;
    primaryProvider: string;
    primaryModel: string;
    fallbackProvider: string;
    fallbackModel: string;
    reason: string;
    primaryError: unknown;
  }) => void;
}

export interface ResilientVisionResult {
  findings: VisualFinding[];
  retryCount: number;
  validationFailures: number;
  providerUsed: string;
  fallbackUsed: boolean;
  modelUsed?: string;
}

export class ResilientVisionAdapter implements GeminiVisionAdapter {
  readonly providerName: string;
  readonly modelName: string;
  private readonly primary?: GeminiVisionAdapter | null;
  private readonly fallback?: GeminiVisionAdapter | null;
  private readonly onFallbackAttempt?: ResilientVisionAdapterOptions["onFallbackAttempt"];

  constructor(options: ResilientVisionAdapterOptions) {
    this.primary = options.primary ?? null;
    this.fallback = options.fallback ?? null;
    this.onFallbackAttempt = options.onFallbackAttempt;

    if (this.primary) {
      this.providerName = this.primary.providerName;
      this.modelName = this.primary.modelName;
    } else if (this.fallback) {
      this.providerName = this.fallback.providerName;
      this.modelName = this.fallback.modelName;
    } else {
      this.providerName = "none";
      this.modelName = "none";
    }
  }

  get hasConfiguredProvider(): boolean {
    return Boolean(this.primary || this.fallback);
  }

  async analyzePage(input: VisionPageInput): Promise<ResilientVisionResult> {
    if (!this.primary && !this.fallback) {
      throw new GeminiVisionError(
        "MISSING_CREDENTIALS",
        "Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured for vision analysis.",
        false,
      );
    }

    // 1. Try Primary (Gemini) if available
    let primaryError: unknown;
    if (this.primary) {
      try {
        const result = await this.primary.analyzePage(input);
        return {
          ...result,
          providerUsed: `${this.primary.providerName}:${this.primary.modelName}`,
          fallbackUsed: false,
        };
      } catch (err) {
        primaryError = err;
        // If no fallback is configured, throw primary error
        if (!this.fallback) {
          throw err;
        }

        // Notify callback of fallback transition
        const errMsg = err instanceof Error ? err.message : String(err);
        this.onFallbackAttempt?.({
          pageNumber: input.pageNumber,
          primaryProvider: this.primary.providerName,
          primaryModel: this.primary.modelName,
          fallbackProvider: this.fallback.providerName,
          fallbackModel: this.fallback.modelName,
          reason: errMsg,
          primaryError: err,
        });
      }
    }

    // 2. Try Fallback (OpenRouter)
    if (this.fallback) {
      try {
        const result = await this.fallback.analyzePage(input);
        return {
          ...result,
          providerUsed: `${this.fallback.providerName}:${result.modelUsed ?? this.fallback.modelName}`,
          fallbackUsed: Boolean(this.primary),
        };
      } catch (fallbackErr) {
        const primaryMsg = primaryError instanceof Error ? primaryError.message : String(primaryError ?? "none");
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new GeminiVisionError(
          "PROVIDER_ERROR",
          `All visual AI providers failed. Primary (${primaryMsg}), Fallback (${fallbackMsg})`,
          false,
        );
      }
    }

    throw primaryError ?? new GeminiVisionError("PROVIDER_ERROR", "Visual AI analysis failed.");
  }
}

export function createResilientVisionAdapterFromEnvironment(
  assetId: string,
  options: {
    geminiTimeoutMs?: number;
    geminiMaxRetries?: number;
    openrouterTimeoutMs?: number;
    openrouterMaxRetries?: number;
    onFallbackAttempt?: ResilientVisionAdapterOptions["onFallbackAttempt"];
  } = {},
): ResilientVisionAdapter {
  const primary = createGeminiVisionAdapterFromEnvironment(assetId, {
    timeoutMs: options.geminiTimeoutMs,
    maxRetries: options.geminiMaxRetries,
  });

  const fallback = createOpenRouterVisionAdapterFromEnvironment(assetId, {
    timeoutMs: options.openrouterTimeoutMs,
    maxRetries: options.openrouterMaxRetries,
  });

  return new ResilientVisionAdapter({
    primary,
    fallback,
    onFallbackAttempt: options.onFallbackAttempt,
  });
}
