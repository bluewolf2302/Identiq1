import { getSupabaseServerConfig } from "../supabase/server";
import { FileBackedBrandKnowledgeRepository } from "./file-brand-repository";
import {
  HostedPersistenceUnavailableError,
  type MultiBrandKnowledgeRepository,
} from "./repository";
import { SupabaseBrandKnowledgeRepository } from "./supabase-brand-repository";

export interface PersistenceEnvironmentInfo {
  backend: "supabase" | "local_file" | "unavailable";
  hostedProduction: boolean;
  supabaseConfigured: boolean;
  hasServiceRoleKey: boolean;
  reason?: string;
}

export function isHostedProductionEnvironment(): boolean {
  if (process.env.IDENTIQ_ALLOW_LOCAL_FILE_STORE === "1") {
    return false;
  }
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview"
  );
}

export function getPersistenceEnvironmentInfo(): PersistenceEnvironmentInfo {
  const supabaseConfig = getSupabaseServerConfig();
  const forceLocal = process.env.IDENTIQ_FORCE_LOCAL_KNOWLEDGE_STORE === "1";
  const hostedProduction = isHostedProductionEnvironment();
  const hasServiceRoleKey = Boolean(supabaseConfig.serviceRoleKey);

  if (supabaseConfig.configured && hasServiceRoleKey && !forceLocal) {
    return {
      backend: "supabase",
      hostedProduction,
      supabaseConfigured: true,
      hasServiceRoleKey: true,
    };
  }

  if (hostedProduction && !forceLocal) {
    return {
      backend: "unavailable",
      hostedProduction: true,
      supabaseConfigured: supabaseConfig.configured,
      hasServiceRoleKey,
      reason:
        "Durable Supabase database and storage credentials (SUPABASE_SERVICE_ROLE_KEY) are not configured for this deployed environment. Local filesystem fallback is disabled in hosted deployments.",
    };
  }

  return {
    backend: "local_file",
    hostedProduction,
    supabaseConfigured: supabaseConfig.configured,
    hasServiceRoleKey,
  };
}

export function createBrandKnowledgeRepository(): MultiBrandKnowledgeRepository {
  const info = getPersistenceEnvironmentInfo();
  if (info.backend === "supabase") {
    return new SupabaseBrandKnowledgeRepository();
  }
  if (info.backend === "unavailable") {
    throw new HostedPersistenceUnavailableError(info.reason);
  }
  return new FileBackedBrandKnowledgeRepository();
}
