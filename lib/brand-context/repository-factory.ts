import { getSupabaseServerConfig } from "../supabase/server";
import { FileBackedBrandKnowledgeRepository } from "./file-brand-repository";
import type { MultiBrandKnowledgeRepository } from "./repository";
import { SupabaseBrandKnowledgeRepository } from "./supabase-brand-repository";

export function createBrandKnowledgeRepository(): MultiBrandKnowledgeRepository {
  const supabaseConfig = getSupabaseServerConfig();
  if (supabaseConfig.configured && process.env.IDENTIQ_FORCE_LOCAL_KNOWLEDGE_STORE !== "1") {
    return new SupabaseBrandKnowledgeRepository();
  }
  return new FileBackedBrandKnowledgeRepository();
}
