
import { z } from "zod";
import {
    GuidelineDocumentRecordSchema,
    GuidelineReviewStatusSchema,
} from "@/lib/guidelines/records";
import {
    SupabaseGuidelineReviewRepository,
    SupabaseGuidelineRepositoryError,
} from "@/lib/guidelines/supabase-review-repository";
import { authenticateOrganisationRequest } from "@/lib/supabase/server-auth";

const repository = new SupabaseGuidelineReviewRepository();

const ScopeSchema = z.object({
    organisationId: z.string().uuid(),
    brandId: z.string().uuid(),
});

const SaveDocumentSchema = ScopeSchema.extend({
    document: GuidelineDocumentRecordSchema,
}).strict();

const UpdateRuleSchema = ScopeSchema.extend({
    versionId: z.string().trim().min(1),
    ruleId: z.string().trim().min(1),
    update: z.object({
        reviewedText: z.string().optional(),
        reviewStatus: GuidelineReviewStatusSchema.optional(),
    }).strict(),
}).strict();

type RouteContext = {
    params: Promise<{ documentId: string }>;
};

function errorResponse(
    code: string,
    message: string,
    status: number,
): Response {
    return Response.json({ error: { code, message } }, { status });
}

function repositoryErrorResponse(error: unknown): Response {
    if (error instanceof SupabaseGuidelineRepositoryError) {
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

export async function PUT(
    request: Request,
    context: RouteContext,
): Promise<Response> {
    const { documentId } = await context.params;

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return errorResponse("INVALID_JSON", "The request body must contain valid JSON.", 400);
    }

    const parsed = SaveDocumentSchema.safeParse(body);

    if (!parsed.success) {
        return errorResponse(
            "INVALID_GUIDELINE_DOCUMENT",
            "The organisation, brand, or guideline document is invalid.",
            400,
        );
    }

    const { organisationId, brandId, document } = parsed.data;

    if (document.documentId !== documentId) {
        return errorResponse(
            "DOCUMENT_ID_MISMATCH",
            "The document ID in the URL does not match the submitted document.",
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
        const saved = await repository.saveDraft(
            authenticated.scope!,
            document,
        );

        return Response.json({ document: saved });
    } catch (error) {
        return repositoryErrorResponse(error);
    }
}

export async function PATCH(
    request: Request,
    context: RouteContext,
): Promise<Response> {
    const { documentId } = await context.params;

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return errorResponse("INVALID_JSON", "The request body must contain valid JSON.", 400);
    }

    const parsed = UpdateRuleSchema.safeParse(body);

    if (!parsed.success) {
        return errorResponse(
            "INVALID_RULE_UPDATE",
            "The organisation, brand, version, or rule update is invalid.",
            400,
        );
    }

    const { organisationId, brandId, versionId, ruleId, update } = parsed.data;

    if (
        update.reviewedText === undefined &&
        update.reviewStatus === undefined
    ) {
        return errorResponse(
            "INVALID_UPDATE",
            "At least one rule review field must be updated.",
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
        const document = await repository.updateRule(
            authenticated.scope!,
            documentId,
            versionId,
            ruleId,
            update,
        );

        return Response.json({ document });
    } catch (error) {
        return repositoryErrorResponse(error);
    }
}
