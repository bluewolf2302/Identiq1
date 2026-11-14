import {
  extractGuidelinePdfText,
  MAX_GUIDELINE_PDF_SIZE_BYTES,
} from "@/lib/guidelines/pdf-extraction";
import { GuidelinePdfExtractionError } from "@/lib/guidelines/types";

function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

function statusForExtractionError(code: string): number {
  if (code === "FILE_TOO_LARGE") return 413;
  if (code === "MALFORMED_PDF" || code === "ENCRYPTED_PDF") return 422;
  if (code === "PDF_PROCESSING_FAILED" || code === "PARSER_CLEANUP_FAILED") {
    return 500;
  }
  return 400;
}

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      "INVALID_MULTIPART_BODY",
      "The upload request must contain valid form data.",
      400,
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse(
      "FILE_REQUIRED",
      "Select a PDF file to extract.",
      400,
    );
  }

  if (file.size > MAX_GUIDELINE_PDF_SIZE_BYTES) {
    return errorResponse(
      "FILE_TOO_LARGE",
      `The PDF exceeds the ${MAX_GUIDELINE_PDF_SIZE_BYTES}-byte size limit.`,
      413,
    );
  }

  try {
    const extraction = await extractGuidelinePdfText({
      fileName: file.name,
      mimeType: file.type,
      data: await file.arrayBuffer(),
    });
    return Response.json({ extraction });
  } catch (error) {
    if (error instanceof GuidelinePdfExtractionError) {
      if (
        error.code === "PDF_PROCESSING_FAILED" ||
        error.code === "PARSER_CLEANUP_FAILED"
      ) {
        console.error("Guideline PDF extraction failed:", error.cause);
      }
      return errorResponse(
        error.code,
        error.message,
        statusForExtractionError(error.code),
      );
    }
    throw error;
  }
}
