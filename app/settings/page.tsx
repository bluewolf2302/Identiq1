"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldCheck,
  Building2,
  LogOut,
  LogIn,
  Plus,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";

export default function SettingsPage() {
  const {
    settings,
    updateSettings,
    resetDemoWorkspace,
    user,
    session,
    organisationId,
    userRole,
    userOrganisations,
    persistenceMode,
    signOut,
    createOrganisation,
    switchOrganisation,
    reloadFromPersistence,
  } = useIdentiq();

  const [reviewerName, setReviewerName] = useState(settings.reviewerName);
  const [reviewerRole, setReviewerRole] = useState(settings.reviewerRole);
  const [autoFlagUnverified, setAutoFlagUnverified] = useState(settings.autoFlagUnverified);
  const [strictClaimsMode, setStrictClaimsMode] = useState(settings.strictClaimsMode);
  const [minimumApprovalScore, setMinimumApprovalScore] = useState(
    settings.minimumApprovalScore
  );

  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setCreatingOrg(true);
    await createOrganisation(newOrgName.trim());
    setNewOrgName("");
    setCreatingOrg(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      reviewerName: reviewerName.trim() || "Maya Lin",
      reviewerRole: reviewerRole.trim() || "Brand Governance Lead",
      autoFlagUnverified,
      strictClaimsMode,
      minimumApprovalScore,
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <div>
        <p className="text-xs font-medium text-[#6B6560] mb-1">
          Workspace Preferences & Integration Architecture
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Settings</h1>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white border border-[#E7E1DA] rounded-[26px] p-6 space-y-6"
      >
        <h2 className="text-base font-bold text-[#141414]">Reviewer Profile</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
              Active Reviewer Name
            </label>
            <input
              type="text"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
              Governance Role
            </label>
            <input
              type="text"
              value={reviewerRole}
              onChange={(e) => setReviewerRole(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414]"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-[#EFECE7] space-y-4">
          <h2 className="text-base font-bold text-[#141414]">Evidence & Approval Policies</h2>

          <label className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] cursor-pointer">
            <div>
              <p className="text-sm font-semibold text-[#141414]">
                Preserve Unverified vs. Conflicting Distinction
              </p>
              <p className="text-xs text-[#6B6560] mt-0.5">
                Flag claims lacking supporting Brand Knowledge Hub evidence as unverified rather than false.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoFlagUnverified}
              onChange={(e) => setAutoFlagUnverified(e.target.checked)}
              className="mt-1 w-4 h-4 accent-[#141414]"
            />
          </label>

          <label className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] cursor-pointer">
            <div>
              <p className="text-sm font-semibold text-[#141414]">
                Strict Substantiated Claims Mode
              </p>
              <p className="text-xs text-[#6B6560] mt-0.5">
                Automatically assign High Severity to absolute guarantees or prohibited terminology.
              </p>
            </div>
            <input
              type="checkbox"
              checked={strictClaimsMode}
              onChange={(e) => setStrictClaimsMode(e.target.checked)}
              className="mt-1 w-4 h-4 accent-[#141414]"
            />
          </label>

          <div className="p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#141414]">
                Minimum Recommended Approval Score
              </p>
              <p className="text-xs text-[#6B6560]">
                Target compliance score threshold for fast-track approval.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={60}
                max={95}
                value={minimumApprovalScore}
                onChange={(e) => setMinimumApprovalScore(Number(e.target.value))}
                className="accent-[#141414]"
              />
              <span className="font-mono tabular-nums text-sm font-bold text-[#141414] w-10">
                {minimumApprovalScore}%
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            type="submit"
            className="px-6 py-2.5 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B]"
          >
            Save Governance Settings
          </button>
        </div>
      </form>

      {/* Supabase Authentication & Multi-Tenancy Governance Card */}
      <div className="bg-white border border-[#E7E1DA] rounded-[26px] p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#141414] flex items-center gap-2">
              <Database className="w-4 h-4" />
              Supabase Authentication & Multi-Tenancy State
            </h2>
            <p className="text-xs text-[#6B6560] mt-0.5">
              Row-Level Security (RLS) enforcement and authenticated PostgreSQL session status.
            </p>
          </div>
          <span
            className={`self-start sm:self-auto px-3 py-1 rounded-full text-xs font-semibold ${
              persistenceMode === "AUTHENTICATED_SUPABASE"
                ? "bg-[#CDEEE0] text-[#14532D]"
                : persistenceMode === "SHARED_DEMO"
                ? "bg-[#DCFCE7] text-[#166534] border border-[#86EFAC]"
                : persistenceMode === "AUTHENTICATED_NO_ORGANISATION"
                ? "bg-[#FCE3D8] text-[#7C2D12]"
                : "bg-[#F3EDE8] text-[#524E4A]"
            }`}
          >
            {persistenceMode}
          </span>
        </div>

        {session && user ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] text-xs">
              <div>
                <p className="text-[#6B6560] font-medium">Authenticated User</p>
                <p className="text-[#141414] font-semibold mt-0.5 truncate">{user.email}</p>
                <p className="text-[10px] font-mono text-[#8C847D] truncate">UID: {user.id}</p>
              </div>
              <div>
                <p className="text-[#6B6560] font-medium">Active Organisation</p>
                <p className="text-[#141414] font-semibold mt-0.5 truncate">
                  {organisationId || "None assigned"}
                </p>
                <p className="text-[10px] text-[#8C847D]">
                  Role: <span className="font-semibold text-[#141414]">{userRole || "None"}</span>
                </p>
              </div>
              <div className="flex items-center sm:justify-end gap-2 pt-2 sm:pt-0">
                <button
                  type="button"
                  onClick={() => reloadFromPersistence()}
                  className="px-3 py-1.5 rounded-full bg-white border border-[#E7E1DA] text-[#141414] hover:bg-[#FAF8F6] text-xs font-semibold transition-colors"
                >
                  Sync DB
                </button>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="px-3 py-1.5 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-xs font-semibold transition-colors flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>

            {/* Organisation Selector / Creator */}
            {userOrganisations.length > 1 && (
              <div className="p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] space-y-2">
                <p className="text-xs font-semibold text-[#141414]">Switch Active Organisation</p>
                <div className="flex flex-wrap gap-2">
                  {userOrganisations.map((org) => (
                    <button
                      key={org.organisation_id}
                      type="button"
                      onClick={() => switchOrganisation(org.organisation_id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors border ${
                        organisationId === org.organisation_id
                          ? "bg-[#141414] text-white border-[#141414]"
                          : "bg-white text-[#3F3B37] border-[#E7E1DA] hover:bg-[#F3EDE8]"
                      }`}
                    >
                      {org.name || org.organisation_id.slice(0, 8)} ({org.role})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Create Additional Organisation Form */}
            <form
              onSubmit={handleCreateOrg}
              className="p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
            >
              <div className="flex-1 relative">
                <Building2 className="w-3.5 h-3.5 text-[#8C847D] absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="New Organisation name (e.g. Acme Studio)"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E7E1DA] bg-white text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
                />
              </div>
              <button
                type="submit"
                disabled={creatingOrg}
                className="px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] shrink-0 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Org
              </button>
            </form>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[#141414]">Not Authenticated</p>
              <p className="text-xs text-[#6B6560] mt-0.5">
                Currently running in demo local mode. Sign in to connect to Supabase PostgreSQL and synchronize reviews.
              </p>
            </div>
            <Link
              href="/login"
              className="px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] transition-colors shrink-0 flex items-center gap-1.5"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In to Supabase
            </Link>
          </div>
        )}
      </div>

      {/* Integration Boundaries Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#DDF0FA]/70 border border-[#CBE2EF] rounded-[24px] p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#141414]">
            <ShieldCheck className="w-4 h-4" />
            Server-Side AI Pipeline
          </div>
          <p className="text-xs text-[#3F3B37] leading-relaxed">
            Routed through <span className="font-mono">/api/analyze</span> with OpenRouter as primary provider, Gemini (<span className="font-mono">@google/genai</span>) as fallback, and structured output validation. Keys remain strictly server-side.
          </p>
          <p className="text-xs font-semibold text-[#14532D] inline-flex items-center gap-1 pt-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Mock & Live Pipeline Ready
          </p>
        </div>

        <div className="bg-[#CDEEE0]/70 border border-[#BAE0D0] rounded-[24px] p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#141414]">
            <Database className="w-4 h-4" />
            Supabase Integration Boundary
          </div>
          <p className="text-xs text-[#3F3B37] leading-relaxed">
            Workspace mutations persist locally in browser storage for immediate demo reliability and are abstracted in <span className="font-mono">lib/supabase/client.ts</span> for PostgreSQL, Auth, and Storage wiring.
          </p>
          <button
            type="button"
            onClick={resetDemoWorkspace}
            className="inline-flex items-center gap-1.5 mt-1 px-3.5 py-1.5 rounded-full bg-white border border-black/10 text-xs font-semibold text-[#141414] hover:bg-[#FAF8F6]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Demo Workspace Data
          </button>
        </div>
      </div>
    </div>
  );
}
