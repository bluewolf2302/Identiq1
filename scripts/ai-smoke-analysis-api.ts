import { parseAnalysisResponsePayload } from "../lib/analysis/api-adapters";

const endpoint = `${process.env.IDENTIQ_BASE_URL ?? "http://localhost:3000"}/api/analyze`;
const submissionId = `smoke-${Date.now()}`;
const textContent =
  "TERALUNE® SPRING WATER | REFRESHMENT, NATURALLY. " +
  "The water that make you feel invincible!!! " +
  "Our spring water keep you fresh and improves your immunity instantly. " +
  "SPECIAL PRICE ₹19 500ml BOTTLE BUY NOW!!! " +
  "100% PURE • CLINICALLY PROVEN • CARBON NEUTRAL";
const expectedSourceIds = new Set([
  "SRC-ASSET-01",
  "SRC-BRAND-01",
  "SRC-CLAIM-01",
  "SRC-PROD-01",
]);

run().catch((error: unknown) => {
  console.error(
    "API smoke test failed:",
    error instanceof Error ? error.message : "Unknown failure.",
  );
  process.exitCode = 1;
});

async function run(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Teralune API smoke test",
        contentType: "Campaign Copy",
        guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
        textContent,
        submissionId,
      }),
    });
  } catch {
    throw new Error("Could not reach the running local application.");
  }

  const bodyText = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`The API returned non-JSON content (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`The API returned HTTP ${response.status}.`);
  }

  const result = parseAnalysisResponsePayload(body);
  if (
    result.submissionId !== submissionId ||
    !result.analysisRunId ||
    !result.analysisStatus ||
    !result.providerUsed ||
    result.providerUsed === "none" ||
    typeof result.fallbackUsed !== "boolean"
  ) {
    throw new Error("The API response is missing required analysis metadata.");
  }

  if (result.findings.length === 0) {
    throw new Error("The deliberately incorrect Teralune copy produced no findings.");
  }

  for (const finding of result.findings) {
    if (!finding.evidenceReferences?.length) {
      throw new Error("A governance finding is missing supporting evidence references.");
    }
    for (const reference of finding.evidenceReferences) {
      if (!expectedSourceIds.has(reference.sourceId)) {
        throw new Error("The API returned an evidence reference outside the Teralune fixture.");
      }
      if (!reference.sourceTitle.trim() || !reference.versionId?.trim()) {
        throw new Error("A Teralune evidence reference is missing its title or version.");
      }
    }
  }

  console.log(`HTTP ${response.status}`);
  console.log(`Provider: ${result.providerUsed}`);
  console.log(`Fallback used: ${result.fallbackUsed}`);
  console.log(`Analysis status: ${result.analysisStatus}`);
  console.log(`Findings: ${result.findings.length}`);
}
