import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AiCandidateResponseSchema,
  GeminiProvider,
} from "../lib/ai";

loadLocalEnvironment();

const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim();

if (!apiKey || !model) {
  console.error("Gemini smoke test failed: GEMINI_API_KEY and GEMINI_MODEL are required.");
  process.exitCode = 1;
} else {
  runSmokeTest(apiKey, model).catch(() => {
    console.error("Gemini smoke test failed: the provider request or response validation failed.");
    process.exitCode = 1;
  });
}

async function runSmokeTest(apiKey: string, model: string): Promise<void> {
  const provider = new GeminiProvider({ apiKey, model });
  const response = await provider.analyze({
    systemPrompt:
      "Return only a JSON object with a findings array. For this connectivity test, findings must be empty.",
    userPrompt: "Return the empty findings response now.",
  });
  const parsed = AiCandidateResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.findings.length !== 0) {
    throw new Error("Gemini returned an unexpected structured response.");
  }
  console.log(`Gemini smoke test succeeded using model ${model}.`);
}

function loadLocalEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    let contents: string;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) {
        continue;
      }
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  }
}
