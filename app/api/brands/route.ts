import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BrandKnowledgeRepositoryError,
  CrossTenantBrandAccessError,
  createBrandKnowledgeRepository,
} from "@/lib/brand-context";
import { resolveServerApiTenantContext } from "@/lib/brand-context/server-api-auth";

const CreateBrandRequestSchema = z
  .object({
    brandId: z.string().trim().min(1).max(120).optional(),
    brandName: z
      .string()
      .trim()
      .min(2, "Brand name must be at least 2 characters.")
      .max(120, "Brand name must be under 120 characters."),
    organisationId: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    website: z.string().trim().max(300).optional(),
    profileSummary: z.string().trim().max(2000).optional(),
    voiceAndToneSummary: z.string().trim().max(1000).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const requestedOrgId = req.nextUrl.searchParams.get("organisationId");
    const requestedBrandId = req.nextUrl.searchParams.get("brandId");

    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: requestedOrgId,
      isMutation: false,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const repo = createBrandKnowledgeRepository();
    if (requestedBrandId) {
      const brand = await repo.getBrand(requestedBrandId, tenant.organisationId);
      if (!brand) {
        return NextResponse.json(
          { error: `Brand "${requestedBrandId}" was not found.` },
          { status: 404 },
        );
      }
      const snapshots = await repo.listVersionSnapshots(
        brand.brandId,
        tenant.organisationId,
      );
      return NextResponse.json({
        brand,
        snapshots,
        organisationId: tenant.organisationId,
      });
    }

    const brands = await repo.listBrands(tenant.organisationId);
    return NextResponse.json({
      brands,
      organisationId: tenant.organisationId,
    });
  } catch (err) {
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof BrandKnowledgeRepositoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      "Unhandled GET /api/brands error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to load brands." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const parsed = CreateBrandRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ||
            "Invalid brand creation request.",
        },
        { status: 400 },
      );
    }

    const tenant = await resolveServerApiTenantContext(req, {
      requestedOrganisationId: parsed.data.organisationId,
      isMutation: true,
    });
    if (!tenant.ok) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const repo = createBrandKnowledgeRepository();
    const brand = await repo.createBrand({
      brandId: parsed.data.brandId,
      organisationId: tenant.organisationId,
      brandName: parsed.data.brandName,
      description: parsed.data.description,
      website: parsed.data.website,
      profileSummary: parsed.data.profileSummary,
      voiceAndToneSummary: parsed.data.voiceAndToneSummary,
    });

    return NextResponse.json({ brand }, { status: 201 });
  } catch (err) {
    if (err instanceof CrossTenantBrandAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof BrandKnowledgeRepositoryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      "Unhandled POST /api/brands error:",
      err instanceof Error ? err.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Unable to create brand." },
      { status: 500 },
    );
  }
}
