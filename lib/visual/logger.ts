/**
 * Structured server-side diagnostic logger for the visual analysis pipeline.
 * Never logs API keys, tokens, base64 payloads, or full raw model prompts.
 */

export interface VisualLogEvent {
  timestamp: string;
  level: "info" | "warn" | "error";
  analysisRunId: string;
  reviewId: string;
  creativeId?: string;
  stage: string;
  pageNumber?: number;
  message: string;
  metrics?: Record<string, string | number | boolean | undefined>;
}

const REDACTED_KEYS = /(api[-_]?key|token|secret|password|authorization|base64|pngBuffer)/i;

export function sanitizeLogFields(
  fields?: Record<string, unknown>,
): Record<string, string | number | boolean | undefined> | undefined {
  if (!fields) return undefined;
  const cleaned: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEYS.test(key)) {
      cleaned[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string") {
      cleaned[key] = value.length > 240 ? `${value.slice(0, 240)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === undefined) {
      cleaned[key] = value;
    } else {
      cleaned[key] = "[OBJECT]";
    }
  }
  return cleaned;
}

export class VisualPipelineLogger {
  private readonly analysisRunId: string;
  private readonly reviewId: string;
  private readonly creativeId?: string;
  private readonly sink: (event: VisualLogEvent) => void;

  constructor(options: {
    analysisRunId: string;
    reviewId: string;
    creativeId?: string;
    sink?: (event: VisualLogEvent) => void;
  }) {
    this.analysisRunId = options.analysisRunId;
    this.reviewId = options.reviewId;
    this.creativeId = options.creativeId;
    this.sink =
      options.sink ??
      ((event) => {
        if (process.env.NODE_ENV !== "test") {
          const line = JSON.stringify({ scope: "identiq-visual", ...event });
          if (event.level === "error") {
            console.error(line);
          } else if (event.level === "warn") {
            console.warn(line);
          } else {
            console.info(line);
          }
        }
      });
  }

  info(
    stage: string,
    message: string,
    extra?: { pageNumber?: number; metrics?: Record<string, unknown> },
  ): void {
    this.emit("info", stage, message, extra);
  }

  warn(
    stage: string,
    message: string,
    extra?: { pageNumber?: number; metrics?: Record<string, unknown> },
  ): void {
    this.emit("warn", stage, message, extra);
  }

  error(
    stage: string,
    message: string,
    extra?: { pageNumber?: number; metrics?: Record<string, unknown> },
  ): void {
    this.emit("error", stage, message, extra);
  }

  private emit(
    level: VisualLogEvent["level"],
    stage: string,
    message: string,
    extra?: { pageNumber?: number; metrics?: Record<string, unknown> },
  ): void {
    this.sink({
      timestamp: new Date().toISOString(),
      level,
      analysisRunId: this.analysisRunId,
      reviewId: this.reviewId,
      creativeId: this.creativeId,
      stage,
      pageNumber: extra?.pageNumber,
      message,
      metrics: sanitizeLogFields(extra?.metrics),
    });
  }
}
