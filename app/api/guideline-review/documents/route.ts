
import { z } from "zod";
import {
    GuidelineDocumentRecordSchema,
} from "@/lib/guidelines/records";
import {
    MAX_GUIDELINE_PDF_SIZE_BYTES,
} from "@/lib/guidelines/pdf-extraction";
import {
    SupabaseGuidelineReviewRepository,
    SupabaseGuidelineRepositoryError,
} from "@/lib/guidelines/supabase-review-repository";
import {
    authenticateOrganisationRequest,
} from "@/lib/supabase/server-auth";
import {
    uploadGuidelinePdf,
    SupabaseStorageError,
} from "@/lib/supabase/storage";

const repository = new SupabaseGuidelineReviewRepository();

const CreateDocumentSchema = z.object({
    organisationId: z.string().uuid(),
    brandId: z.string().uuid(),
    document: GuidelineDocumentRecordSchema,
}).strict();

function errorResponse(
    code: string,
    message: string,
    status: number,
): Response {
    return Response.json({ error: { code, message } }, { status });
}

function operationErrorResponse(error: unknown): Response {
    if (
        error instanceof SupabaseGuidelineRepositoryError ||
        error instanceof SupabaseStorageError
    ) {
        return errorResponse(error.code, error.message, error.status);
    }

    console.error("Guideline persistence error:", error);

    return errorResponse(
        "GUIDELINE_PERSISTENCE_FAILED",
        "The guideline operation could not be completed.",
        500,
    );
}

async function getAuthenticatedScope(
    request: Request,
    organisationId: string,
    brandId: string,
) {
    const auth = await authenticateOrganisationRequest(request);

    if (!auth.ok) {
        return {
            response: errorResponse(
                auth.error.code,
                auth.error.message,
                auth.error.status,
            ),
        };
    }

    const membership = auth.context.memberships.find(
        (item) => item.organisation_id === organisationId,
    );

    if (!membership) {
        return {
            response: errorResponse(
                "ORGANISATION_ACCESS_DENIED",
                "You are not a member of this organisation.",
                403,
            ),
        };
    }

    return {
        scope: {
            organisationId,
            brandId,
            accessToken: auth.context.accessToken,
            userId: auth.context.user.id,
        },
    };
}

export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const organisationId = url.searchParams.get("organisationId");
    const brandId = url.searchParams.get("brandId");

    if (
        !organisationId ||
        !brandId ||
        !z.string().uuid().safeParse(organisationId).success ||
        !z.string().uuid().safeParse(brandId).success
    ) {
        return errorResponse(
            "INVALID_SCOPE",
            "Valid organisationId and brandId query parameters are required.",
            400,
        );
    }

    const authenticated = await getAuthenticatedScope(
        request,
        organisationId,
        brandId,
    );

    if (authenticated.response) return authenticated.response;

    try {
        const documents = await repository.listDocuments(
            authenticated.scope!,
        );

        return Response.json({ documents });
    } catch (error) {
        return operationErrorResponse(error);
    }
}

export async function POST(request: Request): Promise<Response> {
    let formData: FormData;

    try {
        formData = await request.formData();
    } catch {
        return errorResponse(
            "INVALID_MULTIPART_BODY",
            "The request must contain valid multipart form data.",
            400,
        );
    }

    const documentValue = formData.get("document");
    const file = formData.get("file");

    if (typeof documentValue !== "string") {
        return errorResponse(
            "DOCUMENT_REQUIRED",
            "The guideline document record is required.",
            400,
        );
    }

    if (!(file instanceof File)) {
        return errorResponse(
            "FILE_REQUIRED",
            "The original guideline PDF is required.",
            400,
        );
    }

    if (file.size === 0 || file.size > MAX_GUIDELINE_PDF_SIZE_BYTES) {
        return errorResponse(
            "FILE_TOO_LARGE",
            `The PDF must be non-empty and no larger than ${MAX_GUIDELINE_PDF_SIZE_BYTES} bytes.`,
            413,
        );
    }

    let documentBody: unknown;

    try {
        documentBody = JSON.parse(documentValue);
    } catch {
        return errorResponse(
            "INVALID_DOCUMENT_JSON",
            "The guideline document field must contain valid JSON.",
            400,
        );
    }

    const parsed = CreateDocumentSchema.safeParse(documentBody);

    if (!parsed.success) {
        return errorResponse(
            "INVALID_GUIDELINE_DOCUMENT",
            "The organisation, brand, or guideline document is invalid.",
            400,
        );
    }

    const { organisationId, brandId, document } = parsed.data;

    const authenticated = await getAuthenticatedScope(
        request,
        organisationId,
        brandId,
    );

    if (authenticated.response) return authenticated.response;

    try {
        const storagePath = await uploadGuidelinePdf({
            brandId,
            documentId: document.documentId,
            file,
            accessToken: authenticated.scope!.accessToken,
        });

        const saved = await repository.createDraft(
            authenticated.scope!,
            document,
            storagePath,
        );

        return Response.json(
            {
                document: saved,
                storagePath,
            },
            { status: 201 },
        );
    } catch (error) {
        return operationErrorResponse(error);
    }
}
