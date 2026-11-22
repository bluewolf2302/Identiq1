const CONTEXT_WARNING_LABELS: Readonly<Record<string, string>> = {
  NO_PUBLISHED_KNOWLEDGE:
    "No published brand rules are available yet for this brand.",
  NO_APPROVED_GUIDELINES:
    "No published communication or design guidelines are currently active.",
  NO_APPROVED_PRODUCT_FACTS:
    "No published product specifications are active for fact checks.",
  NO_APPROVED_PROMOTIONAL_CLAIMS:
    "No published claim-verification policies are active.",
  NO_APPROVED_TERMINOLOGY:
    "No published terminology preferences are currently active.",
  NO_APPROVED_VISUAL_ASSETS:
    "No published colour, typography, or logo standards are currently active.",
};

const SENSITIVE_OR_INTERNAL_PATTERN =
  /(\{\s*"error"|<!doctype|<html|gemini_api_key|openrouter_api_key|supabase_service_role_key|ai_primary_provider|openrouter|gemini|meta-llama|claude|openai|sk-or-|aizasy|bearer\s+[a-z0-9._-]+|insufficient credits|payment required|resource_exhausted|permission_denied|api_key_invalid|http\s*[45]\d{2}|status\s*[45]\d{2}|\bat\s+\S+\s*\()/i;

const DEFAULT_SAFE_DIAGNOSTIC =
  "AI visual inspection could not be completed. Deterministic visual checks and OCR results were preserved.";

export function sanitizeClientDiagnosticMessage(
  raw: unknown,
  fallback = DEFAULT_SAFE_DIAGNOSTIC,
): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;

  if (SENSITIVE_OR_INTERNAL_PATTERN.test(trimmed)) {
    if (/credit|quota|402|rate\s*limit|429/i.test(trimmed)) {
      return "Enhanced AI inspection was temporarily unavailable due to service capacity limits. Deterministic visual checks and OCR results were preserved.";
    }
    if (/timeout|timed out|aborted|abort/i.test(trimmed)) {
      return "Enhanced AI inspection timed out. Deterministic visual checks and OCR results were preserved.";
    }
    if (/api_key|credentials|not configured|unauthorized|401|403/i.test(trimmed)) {
      return "Enhanced AI visual inspection is unavailable in this environment; deterministic visual checks and OCR results were preserved.";
    }
    return fallback;
  }

  return trimmed.length > 260 ? `${trimmed.slice(0, 257)}...` : trimmed;
}

export function formatContextWarning(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (CONTEXT_WARNING_LABELS[normalized]) {
    return CONTEXT_WARNING_LABELS[normalized]!;
  }
  return sanitizeClientDiagnosticMessage(
    code,
    "Partial brand context coverage applies to this review.",
  );
}

export function formatDisplayGovernanceEngine(providerUsed?: string): string {
  if (!providerUsed) return "Automated Governance Engine";
  const lower = providerUsed.toLowerCase();
  if (lower.includes("deterministic") || lower === "none") {
    return "Deterministic Rule Engine";
  }
  if (lower.includes("openrouter") || lower.includes("fallback")) {
    return "Automated Governance Engine (Secondary)";
  }
  if (lower.includes("gemini") || lower.includes("vision") || lower.includes("ai")) {
    return "Automated Governance Engine";
  }
  return "Automated Governance Engine";
}
