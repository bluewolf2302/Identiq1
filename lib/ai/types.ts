import type { BrandContext, ReviewFinding } from "../contracts";

export type AiAnalysisInput = {
  content: string;
  brandContext: BrandContext;
  deterministicFindings?: ReviewFinding[];
};

export type AiProviderRequest = {
  systemPrompt: string;
  userPrompt: string;
};

export type AiProvider = {
  readonly name: string;
  analyze(request: AiProviderRequest): Promise<unknown>;
};

export type AiAnalysisResult = {
  findings: ReviewFinding[];
  providerUsed: string;
  fallbackUsed: boolean;
};

export type AiAnalysisServiceOptions = {
  primary?: AiProvider;
  fallback?: AiProvider;
};

export type ProviderFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderConfiguration = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetcher?: ProviderFetch;
};

export type ResolvedProviderConfiguration = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetcher: ProviderFetch;
};

export class AiProviderError extends Error {
  readonly provider: string;
  readonly retryable: boolean;
  readonly cause: unknown;

  constructor(
    provider: string,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "AiProviderError";
    this.provider = provider;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

export class AiAnalysisUnavailableError extends Error {
  readonly failures: readonly AiProviderError[];

  constructor(failures: readonly AiProviderError[]) {
    super("AI semantic analysis is unavailable.");
    this.name = "AiAnalysisUnavailableError";
    this.failures = failures;
  }
}

export class MissingAiProviderCredentialsError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`${provider} credentials are not configured.`);
    this.name = "MissingAiProviderCredentialsError";
    this.provider = provider;
  }
}

export class MissingAiProviderConfigurationError extends Error {
  readonly provider: string;
  readonly setting: string;

  constructor(provider: string, setting: string) {
    super(`${provider} configuration is incomplete: ${setting} is not configured.`);
    this.name = "MissingAiProviderConfigurationError";
    this.provider = provider;
    this.setting = setting;
  }
}

export class InvalidAiProviderConfigurationError extends Error {
  constructor(value: string) {
    super(`AI_PRIMARY_PROVIDER must be "gemini" or "openrouter"; received "${value}".`);
    this.name = "InvalidAiProviderConfigurationError";
  }
}
