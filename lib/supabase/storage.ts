
import { getSupabaseServerConfig } from "./server";

const BUCKET = "brand-documents";

export class SupabaseStorageError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly status = 500,
    ) {
        super(message);
        this.name = "SupabaseStorageError";
    }
}

function encodeStoragePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
}

function buildDocumentPath(
    brandId: string,
    documentId: string,
    fileName: string,
): string {
    const safeSegment = /^[a-zA-Z0-9._-]+$/;

    if (
        !safeSegment.test(brandId) ||
        !safeSegment.test(documentId) ||
        !fileName ||
        fileName.includes("/") ||
        fileName.includes("\\")
    ) {
        throw new SupabaseStorageError(
            "INVALID_STORAGE_PATH",
            "The brand, document, or filename is invalid.",
            400,
        );
    }

    return `${brandId}/${documentId}/${fileName}`;
}

export async function uploadGuidelinePdf(input: {
    brandId: string;
    documentId: string;
    file: File;
    accessToken: string;
}): Promise<string> {
    if (!input.accessToken) {
        throw new SupabaseStorageError(
            "AUTHENTICATION_REQUIRED",
            "An authenticated user token is required.",
            401,
        );
    }

    if (
        input.file.type !== "application/pdf" ||
        !input.file.name.toLowerCase().endsWith(".pdf")
    ) {
        throw new SupabaseStorageError(
            "INVALID_PDF",
            "Only PDF guideline documents can be uploaded.",
            400,
        );
    }

    const config = getSupabaseServerConfig();

    if (!config.supabaseUrl || !config.anonKey) {
        throw new SupabaseStorageError(
            "STORAGE_NOT_CONFIGURED",
            "Supabase Storage is not configured.",
            503,
        );
    }

    const safeFileName = `${crypto.randomUUID()}.pdf`;
    const storagePath = buildDocumentPath(
        input.brandId,
        input.documentId,
        safeFileName,
    );

    const url =
        `${config.supabaseUrl}/storage/v1/object/` +
        `${BUCKET}/${encodeStoragePath(storagePath)}`;

    let response: Response;

    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                apikey: config.anonKey,
                Authorization: `Bearer ${input.accessToken}`,
                "Content-Type": "application/pdf",
                "x-upsert": "false",
            },
            body: input.file,
            cache: "no-store",
        });
    } catch {
        throw new SupabaseStorageError(
            "STORAGE_NETWORK_ERROR",
            "Could not connect to Supabase Storage.",
            503,
        );
    }

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message =
            body && typeof body.message === "string"
                ? body.message
                : "The guideline PDF could not be uploaded.";

        throw new SupabaseStorageError(
            "PDF_UPLOAD_FAILED",
            message,
            response.status,
        );
    }

    return storagePath;
}

export async function deleteGuidelinePdf(input: {
    storagePath: string;
    accessToken: string;
}): Promise<void> {
    if (!input.accessToken) {
        throw new SupabaseStorageError(
            "AUTHENTICATION_REQUIRED",
            "An authenticated user token is required.",
            401,
        );
    }

    const config = getSupabaseServerConfig();

    if (!config.supabaseUrl || !config.anonKey) {
        throw new SupabaseStorageError(
            "STORAGE_NOT_CONFIGURED",
            "Supabase Storage is not configured.",
            503,
        );
    }

    const url =
        `${config.supabaseUrl}/storage/v1/object/` +
        `${BUCKET}/${encodeStoragePath(input.storagePath)}`;

    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            apikey: config.anonKey,
            Authorization: `Bearer ${input.accessToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new SupabaseStorageError(
            "PDF_DELETE_FAILED",
            "The guideline PDF could not be deleted.",
            response.status,
        );
    }
}
