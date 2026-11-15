import fs from "node:fs";
import path from "node:path";
import { BrandContextSchema } from "../contracts";
import {
  AiProviderError,
  AiAnalysisUnavailableError,
  InvalidAiProviderConfigurationError,
  MissingAiProviderCredentialsError,
  MissingAiProviderConfigurationError,
  type AiAnalysisInput,
  type AiAnalysisResult,
  type AiAnalysisServiceOptions,
  type AiProvider,
  type ProviderConfiguration,
  type ProviderFetch,
} from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import { buildAiAnalysisRequest } from "./prompt-builder";
import { parseAndValidateCandidates } from "./response-validator";
import { areDuplicateFindings } from "../analysis/finding-merger";

export class AiAnalysisService {
  private readonly primary?: AiProvider;
  private readonly fallback?: AiProvider;

  constructor(options: AiAnalysisServiceOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
  }

  async analyze(input: AiAnalysisInput): Promise<AiAnalysisResult> {
    const context = BrandContextSchema.safeParse(input.brandContext);
    if (!context.success || !input.content.trim()) {
      return { findings: [], providerUsed: "none", fallbackUsed: false };
    }

    const request = buildAiAnalysisRequest(
      input.content,
      context.data,
      input.deterministicFindings,
    );
    const failures: AiProviderError[] = [];
    for (const [index, provider] of [this.primary, this.fallback].entries()) {
      if (!provider) {
        continue;
      }
      try {
        const raw = await provider.analyze(request);
        const findings = parseAndValidateCandidates(raw, context.data, input.content)
          .filter(
            (finding) =>
              !input.deterministicFindings?.some((existing) =>
                areDuplicateFindings(existing, finding),
              ),
          );
        return {
          findings,
          providerUsed: provider.name,
          fallbackUsed: index > 0 && Boolean(this.primary),
        };
      } catch (error) {
        if (
          error instanceof MissingAiProviderCredentialsError ||
          error instanceof MissingAiProviderConfigurationError
        ) {
          failures.push(
            new AiProviderError(provider.name, error.message, { cause: error }),
          );
        } else {
          failures.push(
            new AiProviderError(
              provider.name,
              `${provider.name} provider request failed.`,
              { cause: error },
            ),
          );
        }
      }
    }

    throw new AiAnalysisUnavailableError(failures);
  }
}

function parseDotEnvFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, "utf8");
    const parsed: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
    }
    return parsed;
  } catch {
    return {};
  }
}

function loadLocalEnvironment(): void {
  if (typeof process === "undefined") return;

  const cwd = process.cwd();
  const envOverrides = {
    ...parseDotEnvFile(path.join(cwd, ".env")),
    ...parseDotEnvFile(path.join(cwd, ".env.local")),
  };

  for (const [key, value] of Object.entries(envOverrides)) {
    // Preserve environment variables already supplied by the runtime.
    if (
      (process.env[key] === undefined || process.env[key] === "") &&
      value !== ""
    ) {
      process.env[key] = value;
    }
  }
}

export function createAiAnalysisServiceFromEnvironment(
  environment?: Readonly<Record<string, string | undefined>>,
  options: { fetcher?: ProviderFetch; timeoutMs?: number } = {},
): AiAnalysisService {
  // Explicitly injected environments are used by tests.
  // Otherwise, load the local environment for manual smoke testing.
  if (environment === undefined) {
    loadLocalEnvironment();
  }
  const env = environment ?? process.env;
  const geminiConfiguration = getProviderConfiguration(
    env.GEMINI_API_KEY,
    env.GEMINI_MODEL ?? env.GEMINI_TEXT_MODEL,
  );
  const openRouterConfiguration = getProviderConfiguration(
    env.OPENROUTER_API_KEY,
    env.OPENROUTER_MODEL ?? env.OPENROUTER_TEXT_MODEL,
  );
  const configured = {
    gemini: geminiConfiguration
      ? new GeminiProvider({ ...geminiConfiguration, ...options })
      : undefined,
    openrouter: openRouterConfiguration
      ? new OpenRouterProvider({ ...openRouterConfiguration, ...options })
      : undefined,
  };
  const primaryName = env.AI_PRIMARY_PROVIDER?.trim().toLowerCase() || "gemini";
  if (primaryName !== "gemini" && primaryName !== "openrouter") {
    throw new InvalidAiProviderConfigurationError(primaryName);
  }
  const fallbackName = primaryName === "gemini" ? "openrouter" : "gemini";
  const selectedPrimary = configured[primaryName];
  const configuredFallback = configured[fallbackName];
  return new AiAnalysisService({
    primary: selectedPrimary ?? configuredFallback,
    fallback: selectedPrimary ? configuredFallback : undefined,
  });
}

function getProviderConfiguration(
  apiKey: string | undefined,
  model: string | undefined,
): Pick<ProviderConfiguration, "apiKey" | "model"> | undefined {
  if (!apiKey?.trim() || !model?.trim()) return undefined;
  return { apiKey: apiKey.trim(), model: model.trim() };
}
