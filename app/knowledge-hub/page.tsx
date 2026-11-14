"use client";

import React, { useMemo, useState } from "react";
import {
  Ban,
  BookOpen,
  CheckCircle2,
  Clock,
  Edit3,
  FileCheck2,
  MessageSquareQuote,
  Palette,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { GuidelinePdfReviewPanel } from "@/components/GuidelinePdfReviewPanel";
import { KnowledgeEntry, KnowledgeSection } from "@/lib/types";

const SECTIONS: Array<{
  id: KnowledgeSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
}> = [
  {
    id: "guidelines",
    label: "Brand Guidelines",
    description: "Core positioning rules, visual layout standards, and editorial structure.",
    icon: BookOpen,
    tint: "bg-[#DDF0FA]",
  },
  {
    id: "facts",
    label: "Approved Brand Facts",
    description: "Verified statistics, market availability, and audited product metrics.",
    icon: FileCheck2,
    tint: "bg-[#CDEEE0]",
  },
  {
    id: "terminology",
    label: "Terminology & Wording",
    description: "Preferred product nomenclature and deprecated phrases to avoid.",
    icon: MessageSquareQuote,
    tint: "bg-[#E2DBFB]",
  },
  {
    id: "prohibited",
    label: "Restricted Claims",
    description: "Prohibited guarantees, unsubstantiated medical or security superlatives.",
    icon: Ban,
    tint: "bg-[#F6D5DA]",
  },
  {
    id: "voice",
    label: "Brand Voice & Tone",
    description: "Editorial warmth, precision, and cadence standards across channels.",
    icon: ShieldCheck,
    tint: "bg-[#F9DEC0]",
  },
  {
    id: "visual",
    label: "Colours & Typography",
    description: "Approved hex palettes, surface tokens, and font hierarchy rules.",
    icon: Palette,
    tint: "bg-[#FAF0C8]",
  },
  {
    id: "policies",
    label: "Usage Policies",
    description: "Co-branding, creator disclosure, and legal attribution requirements.",
    icon: CheckCircle2,
    tint: "bg-[#CDEEE0]",
  },
];

export default function KnowledgeHubPage() {
  const { knowledge, upsertKnowledgeEntry, deleteKnowledgeEntry, toggleKnowledgeStatus, settings } =
    useIdentiq();

  const [activeView, setActiveView] = useState<"knowledge" | "guidelines">("knowledge");
  const [activeSection, setActiveSection] = useState<KnowledgeSection>("guidelines");
  const [statusFilter, setStatusFilter] = useState<"All" | "Approved" | "Pending Review">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);

  // Form fields
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formSection, setFormSection] = useState<KnowledgeSection>("guidelines");
  const [formPreferred, setFormPreferred] = useState("");
  const [formAvoid, setFormAvoid] = useState("");
  const [formStatus, setFormStatus] = useState<"Approved" | "Pending Review">("Pending Review");
  const [formError, setFormError] = useState("");

  const currentSectionMeta = SECTIONS.find((s) => s.id === activeSection)!;

  const filteredEntries = useMemo(() => {
    return knowledge.filter((entry) => {
      const matchesSection = entry.section === activeSection;
      const matchesStatus = statusFilter === "All" || entry.status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        entry.title.toLowerCase().includes(q) ||
        entry.content.toLowerCase().includes(q) ||
        (entry.preferredTerm || "").toLowerCase().includes(q) ||
        (entry.avoidTerm || "").toLowerCase().includes(q);
      return matchesSection && matchesStatus && matchesSearch;
    });
  }, [knowledge, activeSection, statusFilter, searchQuery]);

  const openCreateModal = () => {
    setEditingEntry(null);
    setFormSection(activeSection);
    setFormTitle("");
    setFormContent("");
    setFormPreferred("");
    setFormAvoid("");
    setFormStatus("Pending Review");
    setFormError("");
    setModalOpen(true);
  };

  const openEditModal = (entry: KnowledgeEntry) => {
    setEditingEntry(entry);
    setFormSection(entry.section);
    setFormTitle(entry.title);
    setFormContent(entry.content);
    setFormPreferred(entry.preferredTerm || "");
    setFormAvoid(entry.avoidTerm || "");
    setFormStatus(entry.status);
    setFormError("");
    setModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim()) {
      setFormError("Please enter both a rule title and guidance description.");
      return;
    }

    const nextEntry: KnowledgeEntry = {
      id: editingEntry ? editingEntry.id : `kb-${Date.now()}`,
      section: formSection,
      title: formTitle.trim(),
      content: formContent.trim(),
      preferredTerm: formPreferred.trim() || undefined,
      avoidTerm: formAvoid.trim() || undefined,
      hexCodes: editingEntry?.hexCodes,
      fontFamily: editingEntry?.fontFamily,
      status: formStatus,
      updatedAt: new Date().toISOString().split("T")[0],
      owner: editingEntry?.owner || settings.reviewerName,
    };

    upsertKnowledgeEntry(nextEntry);
    setActiveSection(formSection);
    setModalOpen(false);
  };

  const approvedCount = knowledge.filter((k) => k.status === "Approved").length;
  const pendingCount = knowledge.filter((k) => k.status === "Pending Review").length;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1 tabular-nums">
            {approvedCount} Approved Rules · {pendingCount} Pending Review
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Brand Knowledge Hub
          </h1>
        </div>
        {activeView === "knowledge" && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#141414] text-white hover:bg-[#2A2A2A] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Knowledge Entry
          </button>
        )}
      </div>

      <div
        aria-label="Knowledge Hub sections"
        className="inline-flex items-center gap-1.5 rounded-2xl border border-[#E7E1DA] bg-[#F3EDE8] p-1.5"
      >
        <button
          type="button"
          aria-pressed={activeView === "knowledge"}
          onClick={() => setActiveView("knowledge")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
            activeView === "knowledge"
              ? "bg-white text-[#141414] shadow-xs"
              : "text-[#524E4A] hover:bg-white/60"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          Knowledge entries
        </button>
        <button
          type="button"
          aria-pressed={activeView === "guidelines"}
          onClick={() => setActiveView("guidelines")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
            activeView === "guidelines"
              ? "bg-white text-[#141414] shadow-xs"
              : "text-[#524E4A] hover:bg-white/60"
          }`}
        >
          <FileCheck2 className="h-4 w-4" />
          Guideline PDFs
        </button>
      </div>

      {activeView === "guidelines" ? (
        <GuidelinePdfReviewPanel />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Section Navigation */}
        <div className="lg:col-span-4 xl:col-span-3 bg-[#F3EDE8] border border-[#E7E1DA] rounded-[24px] p-3 space-y-1">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const count = knowledge.filter((k) => k.section === sec.id).length;
            const active = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-2xl text-left text-xs font-medium transition-colors ${
                  active
                    ? "bg-white text-[#141414] font-semibold shadow-xs"
                    : "text-[#524E4A] hover:bg-white/60 hover:text-[#141414]"
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                      active ? sec.tint : "bg-white"
                    } text-[#141414]`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="truncate">{sec.label}</span>
                </span>
                <span className="text-[11px] font-mono tabular-nums text-[#6B6560]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main Knowledge Entries Area */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-5">
          {/* Active Section Banner + Filters */}
          <div className={`${currentSectionMeta.tint} border border-black/10 rounded-[24px] p-5`}>
            <h2 className="text-lg font-bold text-[#141414]">{currentSectionMeta.label}</h2>
            <p className="text-xs text-[#3F3B37] mt-1">{currentSectionMeta.description}</p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-4 border-t border-black/10">
              <div className="flex items-center gap-1.5 bg-white/75 p-1 rounded-xl w-fit">
                {(["All", "Approved", "Pending Review"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      statusFilter === status
                        ? "bg-[#141414] text-white"
                        : "text-[#524E4A] hover:text-[#141414]"
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-[#6B6560] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search rules or terms..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-black/10 text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
                />
              </div>
            </div>
          </div>

          {/* Entries List */}
          {filteredEntries.length === 0 ? (
            <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-8 text-center">
              <p className="text-sm font-semibold text-[#141414]">
                No entries in {currentSectionMeta.label} match this filter
              </p>
              <p className="text-xs text-[#6B6560] mt-1 mb-4">
                Add a new guideline or switch the approval filter.
              </p>
              <button
                type="button"
                onClick={openCreateModal}
                className="px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold"
              >
                Add Entry
              </button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredEntries.map((entry) => {
                const isApproved = entry.status === "Approved";
                return (
                  <div
                    key={entry.id}
                    className="bg-white border border-[#E7E1DA] rounded-[22px] p-5 flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <button
                            type="button"
                            onClick={() => toggleKnowledgeStatus(entry.id)}
                            className={`inline-flex items-center gap-1.5 font-semibold ${
                              isApproved ? "text-[#166534]" : "text-[#92400E]"
                            }`}
                          >
                            {isApproved ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <Clock className="w-3.5 h-3.5" />
                            )}
                            {entry.status}
                          </button>
                          <span className="text-[#8E8780]">·</span>
                          <span className="text-[#6B6560]">{entry.owner}</span>
                          <span className="text-[#8E8780]">·</span>
                          <span className="text-[#6B6560] tabular-nums">
                            Updated {entry.updatedAt}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-[#141414]">{entry.title}</h3>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleKnowledgeStatus(entry.id)}
                          className="px-3 py-1.5 rounded-lg border border-[#E7E1DA] text-xs font-medium text-[#3F3B37] hover:bg-[#FAF8F6] transition-colors whitespace-nowrap"
                        >
                          {isApproved ? "Mark Pending" : "Approve Rule"}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(entry)}
                          aria-label={`Edit ${entry.title}`}
                          className="p-2 rounded-lg border border-[#E7E1DA] text-[#3F3B37] hover:bg-[#FAF8F6] transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteKnowledgeEntry(entry.id)}
                          aria-label={`Delete ${entry.title}`}
                          className="p-2 rounded-lg border border-[#E7E1DA] text-[#991B1B] hover:bg-[#F6D5DA]/40 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-sm text-[#3F3B37] leading-relaxed">{entry.content}</p>

                    {(entry.preferredTerm || entry.avoidTerm) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                        {entry.preferredTerm && (
                          <div className="bg-[#CDEEE0]/45 border border-[#BAE0D0] rounded-xl px-3.5 py-2.5">
                            <p className="text-[11px] font-semibold text-[#14532D]">
                              Preferred Wording
                            </p>
                            <p className="text-xs font-medium text-[#141414] mt-0.5">
                              {entry.preferredTerm}
                            </p>
                          </div>
                        )}
                        {entry.avoidTerm && (
                          <div className="bg-[#F6D5DA]/45 border border-[#EBC3CA] rounded-xl px-3.5 py-2.5">
                            <p className="text-[11px] font-semibold text-[#7F1D1D]">
                              Avoid Using
                            </p>
                            <p className="text-xs font-medium text-[#141414] mt-0.5">
                              {entry.avoidTerm}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {entry.hexCodes && entry.hexCodes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        {entry.hexCodes.map((hex) => (
                          <div
                            key={hex}
                            className="flex items-center gap-2 bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl px-2.5 py-1.5"
                          >
                            <span
                              className="w-4 h-4 rounded-md border border-black/15"
                              style={{ backgroundColor: hex }}
                            />
                            <span className="text-xs font-mono text-[#141414]">{hex}</span>
                          </div>
                        ))}
                        {entry.fontFamily && (
                          <span className="text-xs text-[#524E4A] font-medium">
                            Typeface: {entry.fontFamily}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {activeView === "knowledge" && modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white border border-[#E7E1DA] rounded-[26px] max-w-lg w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#141414]">
                {editingEntry ? "Edit Knowledge Entry" : "Add Brand Knowledge Entry"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-[#FAF8F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              {formError && (
                <p className="text-xs text-[#991B1B] bg-[#F6D5DA]/50 px-3 py-2 rounded-xl">
                  {formError}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Section
                  </label>
                  <select
                    value={formSection}
                    onChange={(e) => setFormSection(e.target.value as KnowledgeSection)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-xs text-[#141414]"
                  >
                    {SECTIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Approval Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) =>
                      setFormStatus(e.target.value as "Approved" | "Pending Review")
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-xs text-[#141414]"
                  >
                    <option value="Approved">Approved</option>
                    <option value="Pending Review">Pending Review</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Rule or Fact Title
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Q4 Sustainability Packaging Claim"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Detailed Guidance / Evidence
                </label>
                <textarea
                  rows={4}
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Describe the approved rule, fact source, or prohibited claim boundary..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Preferred Wording (Optional)
                  </label>
                  <input
                    type="text"
                    value={formPreferred}
                    onChange={(e) => setFormPreferred(e.target.value)}
                    placeholder="e.g., Northstar Obsidian Reserve"
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Avoid Wording (Optional)
                  </label>
                  <input
                    type="text"
                    value={formAvoid}
                    onChange={(e) => setFormAvoid(e.target.value)}
                    placeholder="e.g., Northstar Black"
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#E7E1DA] text-xs font-semibold text-[#3F3B37] hover:bg-[#FAF8F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B]"
                >
                  {editingEntry ? "Save Changes" : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
