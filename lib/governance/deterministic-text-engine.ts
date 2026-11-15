import {
  BrandContextSchema,
  ReviewFindingSchema,
  type BrandContext,
  type EvidenceReference,
  type ReviewFinding,
} from "../contracts";
import {
  extractSourceReference,
  findWholeWordMatches,
  normalizeForExactComparison,
} from "./text-matching";
import type {
  DeterministicTextAnalysisInput,
  DeterministicTextAnalysisResult,
} from "./types";
import { applyFindingReliabilityPolicy } from "./finding-policy";

const PROVIDER = "deterministic-text-engine";

export class InvalidDeterministicAnalysisInputError extends Error {
  public readonly issues: unknown;

  constructor(issues: unknown) {
    super("Deterministic text analysis input is invalid.");
    this.name = "InvalidDeterministicAnalysisInputError";
    this.issues = issues;
  }
}

export class InvalidGeneratedFindingError extends Error {
  public readonly issues: unknown;

  constructor(issues: unknown) {
    super("The deterministic engine generated an invalid finding.");
    this.name = "InvalidGeneratedFindingError";
    this.issues = issues;
  }
}

export class DeterministicTextGovernanceEngine {
  analyze(input: DeterministicTextAnalysisInput): DeterministicTextAnalysisResult {
    const parsedContext = BrandContextSchema.safeParse(input.brandContext);
    if (!parsedContext.success || typeof input.content !== "string") {
      throw new InvalidDeterministicAnalysisInputError(
        parsedContext.success
          ? [{ path: ["content"], message: "content must be a string" }]
          : parsedContext.error.issues,
      );
    }

    if (!input.content.trim()) {
      return { findings: [] };
    }

    const findings = [
      ...this.findProhibitedTerminology(input.content, parsedContext.data),
      ...this.findRequiredTerminology(input.content, parsedContext.data),
      ...this.findFactConflicts(input.content, parsedContext.data),
      ...this.findProhibitedExactPhrases(input.content, parsedContext.data),
    ];

    const validatedFindings = findings.map((finding) => {
      const validated = ReviewFindingSchema.safeParse(finding);
      if (!validated.success) {
        throw new InvalidGeneratedFindingError(validated.error.issues);
      }
      return applyFindingReliabilityPolicy(validated.data, true);
    });

    return { findings: validatedFindings };
  }

  private findProhibitedTerminology(
    content: string,
    context: BrandContext,
  ): ReviewFinding[] {
    return context.prohibitedTerminology.flatMap((rule, ruleIndex) => {
      const phrase = valueBeforeSource(rule);
      if (!phrase || isExplicitRuleMarker(phrase)) {
        return [];
      }
      return this.findMatches(content, phrase).map((location, occurrence) =>
        this.createFinding({
          findingId: `prohibited-terminology-${ruleIndex}-${occurrence}`,
          category: "TONE_AND_TERMINOLOGY",
          severity: "HIGH",
          status: "CONFLICTING",
          issue: `Prohibited terminology detected: "${phrase}"`,
          description: "The submitted text contains terminology prohibited by the approved brand context.",
          explanation: `The phrase "${phrase}" is explicitly listed as prohibited terminology.`,
          suggestedCorrection: "Replace the prohibited terminology with approved brand wording.",
          location,
          evidenceReferences: this.evidenceFor(rule),
        }),
      );
    });
  }

  private findRequiredTerminology(
    content: string,
    context: BrandContext,
  ): ReviewFinding[] {
    return context.preferredTerminology.flatMap((rule, ruleIndex) => {
      const value = valueBeforeSource(rule);
      if (!value || !/^REQUIRED(?:_TERMINOLOGY)?\s*:/i.test(value)) {
        return [];
      }
      const phrase = value.replace(/^REQUIRED(?:_TERMINOLOGY)?\s*:/i, "").trim();
      if (!phrase || findWholeWordMatches(content, phrase).length > 0) {
        return [];
      }
      return [
        this.createFinding({
          findingId: `required-terminology-${ruleIndex}`,
          category: "TONE_AND_TERMINOLOGY",
          severity: "MEDIUM",
          status: "NEEDS_HUMAN_REVIEW",
          issue: `Required terminology is missing: "${phrase}"`,
          description: "The submitted text does not contain terminology explicitly marked as required.",
          explanation: `The approved brand context explicitly requires the phrase "${phrase}".`,
          suggestedCorrection: `Include the approved phrase "${phrase}".`,
          evidenceReferences: this.evidenceFor(rule),
        }),
      ];
    });
  }

  private findFactConflicts(
    content: string,
    context: BrandContext,
  ): ReviewFinding[] {
    return context.approvedProductFacts.flatMap((fact, factIndex) => {
      const structured = parseStructuredFact(fact);
      if (!structured || !["PRODUCT_PRICE", "APPROVED_DATE"].includes(structured.kind)) {
        return [];
      }

      const expected = normalizeForExactComparison(structured.value);
      const occurrences = findWholeWordMatches(content, structured.value);
      if (occurrences.length > 0) {
        return [];
      }

      const hasComparableValue = hasComparableToken(
        content,
        structured.value,
        structured.kind,
      );
      if (!hasComparableValue) {
        return [];
      }

      return [
        this.createFinding({
          findingId: `fact-conflict-${factIndex}`,
          category: "FACT_VERIFICATION",
          severity: "HIGH",
          status: "CONFLICTING",
          issue: `Approved ${structured.kind.toLocaleLowerCase()} does not match submitted text`,
          description: `The submitted text contains a comparable value that conflicts with the approved ${structured.kind.toLocaleLowerCase()}.`,
          detectedValue: findComparableToken(
            content,
            structured.value,
            structured.kind,
          ),
          expectedValue: structured.value,
          explanation: `The approved value is "${expected}", but the submitted text contains a different comparable value.`,
          suggestedCorrection: `Use the approved value "${structured.value}".`,
          evidenceReferences: this.evidenceFor(fact),
        }),
      ];
    });
  }

  private findProhibitedExactPhrases(
    content: string,
    context: BrandContext,
  ): ReviewFinding[] {
    return context.approvedPromotionalClaims.flatMap((claim, claimIndex) => {
      const value = valueBeforeSource(claim);
      if (!value || !/^PROHIBITED(?:_PHRASE)?\s*:/i.test(value)) {
        return [];
      }
      const phrase = value.replace(/^PROHIBITED(?:_PHRASE)?\s*:/i, "").trim();
      return this.findMatches(content, phrase).map((location, occurrence) =>
        this.createFinding({
          findingId: `prohibited-claim-${claimIndex}-${occurrence}`,
          category: "PROMOTIONAL_CLAIM",
          severity: "HIGH",
          status: "CONFLICTING",
          issue: `Prohibited promotional phrase detected: "${phrase}"`,
          description: "The submitted text contains a phrase explicitly prohibited by the approved claims data.",
          explanation: `The phrase "${phrase}" is explicitly marked as prohibited in the approved promotional claim data.`,
          suggestedCorrection: "Remove or replace the prohibited promotional phrase.",
          location,
          evidenceReferences: this.evidenceFor(claim),
        }),
      );
    });
  }

  private findMatches(content: string, phrase: string) {
    return findWholeWordMatches(content, phrase);
  }

  private evidenceFor(value: string): EvidenceReference[] {
    const source = extractSourceReference(value, undefined, undefined);
    return source ? [source] : [];
  }

  private createFinding(input: Omit<ReviewFinding, "analysisProvider" | "confidence">): ReviewFinding {
    return {
      ...input,
      analysisProvider: PROVIDER,
      confidence: 1,
    };
  }
}

function valueBeforeSource(value: string): string {
  return value.split(/\s+\[Source:/i, 1)[0]?.trim() ?? "";
}

function isExplicitRuleMarker(value: string): boolean {
  return /^(?:PROHIBITED|REQUIRED)(?:_TERMINOLOGY|_PHRASE)?\s*:/i.test(value);
}

function parseStructuredFact(
  fact: string,
): { kind: "PRODUCT_PRICE" | "APPROVED_DATE"; value: string } | undefined {
  const match = valueBeforeSource(fact).match(
    /^(PRODUCT_PRICE|APPROVED_DATE)\s*:\s*(.+)$/i,
  );
  if (!match) {
    return undefined;
  }
  const kind = match[1]!.toUpperCase();
  if (kind !== "PRODUCT_PRICE" && kind !== "APPROVED_DATE") {
    return undefined;
  }
  return { kind, value: match[2]!.trim() };
}

function comparableTokens(
  value: string,
  kind: "PRODUCT_PRICE" | "APPROVED_DATE",
): string[] {
  const expression =
    kind === "APPROVED_DATE"
      ? /\b\d{4}-\d{2}-\d{2}\b/g
      : /(?:[$€£₹]\s?\d+(?:[,.]\d+)*)/gu;
  return value.match(expression) ?? [];
}

function hasComparableToken(
  content: string,
  expected: string,
  kind: "PRODUCT_PRICE" | "APPROVED_DATE",
): boolean {
  const expectedTokens = comparableTokens(expected, kind);
  return expectedTokens.length > 0 &&
    comparableTokens(content, kind).some(
      (token) => !expectedTokens.some(
        (expectedToken) => normalizeForExactComparison(expectedToken) === normalizeForExactComparison(token),
      ),
    );
}

function findComparableToken(
  content: string,
  expected: string,
  kind: "PRODUCT_PRICE" | "APPROVED_DATE",
): string | undefined {
  const expectedTokens = comparableTokens(expected, kind);
  return comparableTokens(content, kind).find(
    (token) => !expectedTokens.some(
      (expectedToken) => normalizeForExactComparison(expectedToken) === normalizeForExactComparison(token),
    ),
  );
}
