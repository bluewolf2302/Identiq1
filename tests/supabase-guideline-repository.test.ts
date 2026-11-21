
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildGuidelineDocumentRecord } from "../lib/guidelines/record-builder";
import {
    SupabaseGuidelineReviewRepository,
    SupabaseGuidelineRepositoryError,
} from "../lib/guidelines/supabase-review-repository";
import type { PdfExtractionResult } from "../lib/guidelines/types";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

const scope = {
    organisationId: "org-123",
    brandId: "brand-123",
    accessToken: "user-jwt",
    userId: "user-123",
};

const extraction: PdfExtractionResult = {
    fileName: "guide.pdf",
    totalPageCount: 1,
    status: "TEXT_EXTRACTED",
    pages: [
        {
            pageNumber: 1,
            text: "Use clear, direct wording.",
            status: "TEXT_EXTRACTED",
        },
    ],
};

function makeDocument() {
    return buildGuidelineDocumentRecord({
        documentId: "doc-123",
        title: "Brand Guidelines",
        versionId: "version-1",
        extraction,
        sections: [
            {
                sectionId: "section-1",
                name: "Voice",
                startPage: 1,
                endPage: 1,
            },
        ],
        rules: [
            {
                ruleId: "rule-1",
                sectionId: "section-1",
                pageNumber: 1,
                startOffset: 0,
                endOffset: extraction.pages[0]!.text.length,
            },
        ],
    });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
});

function configureSupabase() {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
        "https://mock-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
}

test("lists guideline documents using the authenticated user token and scope", async () => {
    configureSupabase();
    const document = makeDocument();
    let requestedUrl = "";
    let authorization = "";

    globalThis.fetch = (async (
        url: RequestInfo | URL,
        init?: RequestInit,
    ) => {
        requestedUrl = String(url);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json([
            {
                document_id: document.documentId,
                version_id: document.versionId,
                record: document,
            },
        ]);
    }) as typeof fetch;

    const repository = new SupabaseGuidelineReviewRepository();
    const result = await repository.listDocuments(scope);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], document);
    assert.match(requestedUrl, /organisation_id=eq\.org-123/);
    assert.match(requestedUrl, /brand_id=eq\.brand-123/);
    assert.equal(authorization, "Bearer user-jwt");
});

test("creates a guideline draft without sending caller-controlled audit identities", async () => {
    configureSupabase();
    const document = makeDocument();
    let requestBody: Record<string, unknown> = {};

    globalThis.fetch = (async (
        _url: RequestInfo | URL,
        init?: RequestInit,
    ) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json(
            [
                {
                    document_id: document.documentId,
                    version_id: document.versionId,
                    record: document,
                },
            ],
            { status: 201 },
        );
    }) as typeof fetch;

    const repository = new SupabaseGuidelineReviewRepository();
    const result = await repository.createDraft(scope, document);

    assert.deepEqual(result, document);
    assert.equal(requestBody.organisation_id, scope.organisationId);
    assert.equal(requestBody.brand_id, scope.brandId);
    assert.equal("created_by" in requestBody, false);
    assert.equal("updated_by" in requestBody, false);
});

test("maps duplicate document versions to DUPLICATE_DRAFT", async () => {
    configureSupabase();

    globalThis.fetch = (async () =>
        Response.json(
            { code: "23505", message: "duplicate key value violates unique constraint" },
            { status: 409 },
        )) as typeof fetch;

    const repository = new SupabaseGuidelineReviewRepository();

    await assert.rejects(
        repository.createDraft(scope, makeDocument()),
        (error: unknown) =>
            error instanceof SupabaseGuidelineRepositoryError &&
            error.code === "DUPLICATE_DRAFT" &&
            error.status === 409,
    );
});

test("updates a rule while preserving its original source evidence", async () => {
    configureSupabase();
    const document = makeDocument();
    let patchCount = 0;

    globalThis.fetch = (async (
        _url: RequestInfo | URL,
        init?: RequestInit,
    ) => {
        const method = init?.method ?? "GET";

        if (method === "GET") {
            return Response.json([
                {
                    document_id: document.documentId,
                    version_id: document.versionId,
                    record: document,
                },
            ]);
        }

        if (method === "PATCH") {
            patchCount += 1;
            const body = JSON.parse(String(init?.body));
            return Response.json([
                {
                    document_id: document.documentId,
                    version_id: document.versionId,
                    record: body.record,
                },
            ]);
        }

        return Response.json({ message: "Unexpected method" }, { status: 405 });
    }) as typeof fetch;

    const repository = new SupabaseGuidelineReviewRepository();
    const updated = await repository.updateRule(
        scope,
        document.documentId,
        document.versionId,
        "rule-1",
        {
            reviewedText: "Use concise language.",
            reviewStatus: "ACCEPTED",
        },
    );

    assert.equal(patchCount, 1);
    assert.equal(updated.rules[0]!.reviewedText, "Use concise language.");
    assert.equal(updated.rules[0]!.reviewStatus, "ACCEPTED");
    assert.equal(
        updated.rules[0]!.originalText,
        "Use clear, direct wording.",
    );
    assert.equal(
        updated.rules[0]!.source.excerpt,
        "Use clear, direct wording.",
    );
});

test("rejects an update that contains no review fields", async () => {
    const repository = new SupabaseGuidelineReviewRepository();

    await assert.rejects(
        repository.updateRule(
            scope,
            "doc-123",
            "version-1",
            "rule-1",
            {},
        ),
        (error: unknown) =>
            error instanceof SupabaseGuidelineRepositoryError &&
            error.code === "INVALID_UPDATE",
    );
});

test("rejects invalid repository scope before making a request", async () => {
    let requestCount = 0;

    globalThis.fetch = (async () => {
        requestCount += 1;
        return Response.json([]);
    }) as typeof fetch;

    const repository = new SupabaseGuidelineReviewRepository();

    await assert.rejects(
        repository.listDocuments({
            ...scope,
            accessToken: "",
        }),
        (error: unknown) =>
            error instanceof SupabaseGuidelineRepositoryError &&
            error.code === "INVALID_REPOSITORY_SCOPE",
    );

    assert.equal(requestCount, 0);
});
