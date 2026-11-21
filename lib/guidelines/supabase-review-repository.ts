


import {
    GuidelineDocumentRecordSchema,
    type GuidelineDocumentRecord,
    type GuidelineReviewStatus,
} from "./records";
import { callServerPostgrest } from "../supabase/server";

export type GuidelineRepositoryScope = {
    organisationId: string;
    brandId: string;
    accessToken: string;
    userId: string;
};

export class SupabaseGuidelineRepositoryError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly status = 500,
    ) {
        super(message);
        this.name = "SupabaseGuidelineRepositoryError";
    }
}

type GuidelineDocumentRow = {
    document_id: string;
    version_id: string;
    record: unknown;
};

function validateScope(scope: GuidelineRepositoryScope): void {
    if (
        !scope.organisationId ||
        !scope.brandId ||
        !scope.accessToken ||
        !scope.userId
    ) {
        throw new SupabaseGuidelineRepositoryError(
            "INVALID_REPOSITORY_SCOPE",
            "Organisation, brand and authenticated access token are required.",
            400,
        );
    }
}

function parseRecord(value: unknown): GuidelineDocumentRecord {
    const parsed = GuidelineDocumentRecordSchema.safeParse(value);

    if (!parsed.success) {
        throw new SupabaseGuidelineRepositoryError(
            "INVALID_STORED_GUIDELINE",
            "The stored guideline document failed validation.",
        );
    }

    return parsed.data;
}

function scopeFilter(scope: GuidelineRepositoryScope): string {
    return (
        `organisation_id=eq.${encodeURIComponent(scope.organisationId)}` +
        `&brand_id=eq.${encodeURIComponent(scope.brandId)}`
    );
}

export class SupabaseGuidelineReviewRepository {
    async listDocuments(
        scope: GuidelineRepositoryScope,
    ): Promise<GuidelineDocumentRecord[]> {
        validateScope(scope);

        const result = await callServerPostgrest<GuidelineDocumentRow[]>(
            `/rest/v1/guideline_documents?select=document_id,version_id,record&${scopeFilter(scope)}&order=created_at.desc`,
            { userToken: scope.accessToken },
        );

        if (result.error) {
            throw new SupabaseGuidelineRepositoryError(
                result.error.code ?? "GUIDELINE_LIST_FAILED",
                "Could not retrieve guideline documents.",
                result.status || 500,
            );
        }

        return (result.data ?? []).map((row) => {
            const record = parseRecord(row.record);

            if (
                record.documentId !== row.document_id ||
                record.versionId !== row.version_id
            ) {
                throw new SupabaseGuidelineRepositoryError(
                    "STORED_GUIDELINE_ID_MISMATCH",
                    "Stored guideline identifiers do not match the document record.",
                );
            }

            return record;
        });
    }

    async createDraft(
        scope: GuidelineRepositoryScope,
        document: GuidelineDocumentRecord,
        storagePath?: string,
    ): Promise<GuidelineDocumentRecord> {
        validateScope(scope);
        const record = parseRecord(document);

        const result = await callServerPostgrest<GuidelineDocumentRow[]>(
            "/rest/v1/guideline_documents",
            {
                method: "POST",
                userToken: scope.accessToken,
                headers: { Prefer: "return=representation" },
                body: {
                    organisation_id: scope.organisationId,
                    brand_id: scope.brandId,
                    document_id: record.documentId,
                    version_id: record.versionId,
                    title: record.title,
                    record,
                    storage_path: storagePath ?? null,
                },
            },
        );

        if (result.error) {
            const duplicate =
                result.error.code === "23505" || result.status === 409;

            throw new SupabaseGuidelineRepositoryError(
                duplicate
                    ? "DUPLICATE_DRAFT"
                    : result.error.code ?? "GUIDELINE_CREATE_FAILED",
                duplicate
                    ? "A draft already exists for this document and version."
                    : "Could not create the guideline draft.",
                duplicate ? 409 : result.status || 500,
            );
        }

        const saved = result.data?.[0];

        if (!saved) {
            throw new SupabaseGuidelineRepositoryError(
                "EMPTY_INSERT_RESPONSE",
                "The database did not return the created guideline draft.",
            );
        }

        return parseRecord(saved.record);
    }

    async saveDraft(
        scope: GuidelineRepositoryScope,
        document: GuidelineDocumentRecord,
    ): Promise<GuidelineDocumentRecord> {
        validateScope(scope);
        const record = parseRecord(document);

        const result = await callServerPostgrest<GuidelineDocumentRow[]>(
            `/rest/v1/guideline_documents?${scopeFilter(scope)}&document_id=eq.${encodeURIComponent(record.documentId)}&version_id=eq.${encodeURIComponent(record.versionId)}`,
            {
                method: "PATCH",
                userToken: scope.accessToken,
                headers: { Prefer: "return=representation" },
                body: {
                    title: record.title,
                    record,
                    updated_by: scope.userId,
                    updated_at: new Date().toISOString(),
                },
            },
        );

        if (result.error) {
            throw new SupabaseGuidelineRepositoryError(
                result.error.code ?? "GUIDELINE_SAVE_FAILED",
                "Could not save the guideline draft.",
                result.status || 500,
            );
        }

        const saved = result.data?.[0];

        if (!saved) {
            throw new SupabaseGuidelineRepositoryError(
                "DRAFT_NOT_FOUND",
                "The guideline draft was not found in this organisation and brand.",
                404,
            );
        }

        return parseRecord(saved.record);
    }

    async updateRule(
        scope: GuidelineRepositoryScope,
        documentId: string,
        versionId: string,
        ruleId: string,
        update: {
            reviewedText?: string;
            reviewStatus?: GuidelineReviewStatus;
        },
    ): Promise<GuidelineDocumentRecord> {
        if (
            update.reviewedText === undefined &&
            update.reviewStatus === undefined
        ) {
            throw new SupabaseGuidelineRepositoryError(
                "INVALID_UPDATE",
                "At least one rule review field must be updated.",
                400,
            );
        }

        const documents = await this.listDocuments(scope);
        const current = documents.find(
            (document) =>
                document.documentId === documentId &&
                document.versionId === versionId,
        );

        if (!current) {
            throw new SupabaseGuidelineRepositoryError(
                "DRAFT_NOT_FOUND",
                "The guideline draft was not found.",
                404,
            );
        }

        let foundRule = false;

        const rules = current.rules.map((rule) => {
            if (rule.ruleId !== ruleId) return rule;

            foundRule = true;

            return {
                ...rule,
                ...(update.reviewedText === undefined
                    ? {}
                    : { reviewedText: update.reviewedText }),
                ...(update.reviewStatus === undefined
                    ? {}
                    : { reviewStatus: update.reviewStatus }),
            };
        });

        if (!foundRule) {
            throw new SupabaseGuidelineRepositoryError(
                "RULE_NOT_FOUND",
                "The guideline rule was not found.",
                404,
            );
        }

        const updated = parseRecord({ ...current, rules });
        return this.saveDraft(scope, updated);
    }
}
