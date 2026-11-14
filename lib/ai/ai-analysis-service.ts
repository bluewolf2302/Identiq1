import fs from "node:fs";
import path from "node:path";
import { BrandContextSchema } from "../contracts";
import {
  AiProviderError,
  AiAnalysisUnavailableError,
  MissingAiProviderCredentialsError,
  type AiAnalysisInput,
  type AiAnalysisResult,
  type AiAnalysisServiceOptions,
  type AiProvider,
} from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import { buildAiAnalysisRequest } from "./prompt-builder";
import { parseAndValidateCandidates } from "./response-validator";

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
          .filter((finding) => !isDuplicateOfDeterministic(finding, input.deterministicFindings));
        return {
          findings,
          providerUsed: provider.name,
          fallbackUsed: index > 0,
        };
      } catch (error) {
        if (error instanceof MissingAiProviderCredentialsError) {
          failures.push(
            new AiProviderError(provider.name, error.message, { cause: error }),
          );
        } else {
          failures.push(
            new AiProviderError(
              provider.name,
              error instanceof Error
                ? error.message
                : "Provider returned an invalid response.",
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

export function createAiAnalysisServiceFromEnvironment(): AiAnalysisService {
  if (typeof process !== "undefined") {
    const cwd = process.cwd();
    const envOverrides = {
      ...parseDotEnvFile(path.join(cwd, ".env")),
      ...parseDotEnvFile(path.join(cwd, ".env.local")),
    };
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value !== "") {
        process.env[key] = value;
      }
    }
  }

  const openRouterModel =
    process.env.OPENROUTER_MODEL?.trim() ||
    process.env.OPENROUTER_TEXT_MODEL?.trim() ||
    "google/gemini-3.6-flash";

  const geminiModel =
    process.env.GEMINI_MODEL?.trim() ||
    process.env.GEMINI_TEXT_MODEL?.trim() ||
    "gemini-3.6-flash";

  const primary = process.env.OPENROUTER_API_KEY?.trim()
    ? new OpenRouterProvider({
        apiKey: process.env.OPENROUTER_API_KEY.trim(),
        model: openRouterModel,
      })
    : undefined;

  const fallback = process.env.GEMINI_API_KEY?.trim()
    ? new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY.trim(),
        model: geminiModel,
      })
    : undefined;

  return new AiAnalysisService({ primary, fallback });
}

function isDuplicateOfDeterministic(
  finding: import("../contracts").ReviewFinding,
  deterministicFindings: import("../contracts").ReviewFinding[] = [],
): boolean {
  return deterministicFindings.some(
    (existing) =>
      existing.category === finding.category &&
      existing.location?.startOffset === finding.location?.startOffset &&
      existing.location?.endOffset === finding.location?.endOffset &&
      existing.issue.toLocaleLowerCase() === finding.issue.toLocaleLowerCase(),
  );
}
