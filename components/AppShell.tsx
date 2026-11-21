"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Images,
  FilePlus2,
  ScanSearch,
  CheckSquare,
  History,
  Settings,
  FileBarChart,
  Radar,
  Menu,
  X,
  Plus,
  ShieldCheck,
  LogOut,
  HelpCircle,
} from "lucide-react";
import { useIdentiq } from "./IdentiqProvider";
import { ViewerAvatar } from "./ViewerAvatar";
import { GuidedTourModal } from "./onboarding/GuidedTourModal";
import { resolveActiveActorIdentity } from "@/lib/viewer-profile";

interface NavItem {
  label: string;
  shortLabel: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SIDEBAR_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", shortLabel: "Dashboard", href: "/", icon: LayoutDashboard },
  {
    label: "Brand Knowledge Hub",
    shortLabel: "Knowledge Hub",
    href: "/knowledge-hub",
    icon: BookOpen,
  },
  { label: "Asset Library", shortLabel: "Asset Library", href: "/assets", icon: Images },
  { label: "Review Studio", shortLabel: "Review Studio", href: "/studio", icon: ScanSearch },
  { label: "Approvals", shortLabel: "Approvals", href: "/approvals", icon: CheckSquare },
  { label: "Activity & History", shortLabel: "Activity", href: "/activity", icon: History },
  { label: "Reports & Export", shortLabel: "Reports", href: "/reports", icon: FileBarChart },
  { label: "Brand Recall Radar", shortLabel: "Brand Recall Radar", href: "/brand-recall", icon: Radar },
  { label: "Settings", shortLabel: "Settings", href: "/settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    reviews,
    user,
    session,
    signOut,
    viewerProfile,
    profileHydrated,
    guidedTourOpen,
    markGuidedTourCompleted,
    replayGuidedTour,
  } = useIdentiq();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const actor = resolveActiveActorIdentity({
    viewerProfile,
    authUser: user,
  });

  const pendingApprovalsCount = reviews.filter(
    (r) => r.status === "Pending Approval" || r.status === "In Review"
  ).length;

  const isActiveRoute = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  // Hide workspace navigation chrome during first-visit Landing & Onboarding on "/"
  const hideWorkspaceShell =
    pathname === "/" && (!profileHydrated || !viewerProfile.onboardingCompleted);

  if (hideWorkspaceShell) {
    return <div className="min-h-screen bg-[#FAF8F6] text-[#141414]">{children}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F6] text-[#141414]">
      {/* Consolidated Top Bar: Brand Mark + Primary New Review CTA + Tour + Profile */}
      <header className="sticky top-0 z-40 h-14 bg-[#111113] text-white border-b border-black/15 px-4 lg:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            className="lg:hidden p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight whitespace-nowrap shrink-0"
          >
            <span className="w-7 h-7 rounded-lg bg-white text-[#111113] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <span>Identiq</span>
          </Link>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          <Link
            href="/reviews/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#111113] hover:bg-[#F3EDE8] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Review</span>
          </Link>

          <button
            type="button"
            onClick={() => replayGuidedTour()}
            aria-label="Open quick product tour"
            title="Quick Product Tour"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Quick Tour</span>
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-white/15 shrink-0">
            <Link
              href="/settings"
              title={`${actor.name} · Profile & Settings`}
              className="flex items-center gap-2 rounded-full py-0.5 pr-1 hover:bg-white/10 transition-colors"
            >
              <ViewerAvatar
                name={actor.name}
                avatarId={viewerProfile.avatarId}
                customAvatarDataUrl={viewerProfile.customAvatarDataUrl}
                size="sm"
              />
              <span className="hidden sm:inline text-xs font-medium text-white/90 max-w-[140px] truncate">
                {actor.name}
              </span>
            </Link>

            {session && (
              <button
                type="button"
                onClick={() => signOut()}
                aria-label="Sign out"
                title="Sign out"
                className="p-1.5 text-white/65 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex min-w-0">
        {/* Desktop Vertical Left Navigation Rail */}
        <aside className="hidden lg:flex w-[232px] shrink-0 flex-col justify-between bg-[#F3EDE8] border-r border-[#E7E1DA] py-5 px-3.5">
          <nav aria-label="Workspace navigation" className="space-y-1.5">
            {SIDEBAR_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActiveRoute(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-2xl text-[13px] font-medium transition-all ${
                    active
                      ? "bg-white text-[#141414] shadow-xs font-semibold"
                      : "text-[#524E4A] hover:bg-white/60 hover:text-[#141414]"
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        active
                          ? "bg-[#141414] text-white"
                          : "bg-white text-[#3F3B37] group-hover:bg-[#141414] group-hover:text-white"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="truncate">{item.shortLabel}</span>
                  </span>
                  {item.href === "/approvals" && pendingApprovalsCount > 0 && (
                    <span className="text-[11px] font-mono tabular-nums text-[#524E4A] pr-1">
                      {pendingApprovalsCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Clean Viewer Profile Footer */}
          <div className="pt-4 mt-4 border-t border-[#E4DDD5] space-y-2">
            <Link
              href="/settings"
              className="flex items-center gap-2.5 p-2 rounded-2xl hover:bg-white/60 transition-colors min-w-0"
            >
              <ViewerAvatar
                name={actor.name}
                avatarId={viewerProfile.avatarId}
                customAvatarDataUrl={viewerProfile.customAvatarDataUrl}
                size="md"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#141414] truncate">
                  {actor.name}
                </p>
                <p className="text-[11px] text-[#6B6560] truncate">{actor.role}</p>
              </div>
            </Link>

            {session && (
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-[#E7E1DA] bg-white text-xs text-[#524E4A] hover:bg-[#FAF8F6] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            )}
          </div>
        </aside>

        {/* Mobile Slide-Over Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/40"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-72 max-w-[85vw] bg-[#F3EDE8] h-full flex flex-col justify-between p-5 shadow-2xl overflow-y-auto">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-[#141414]">Identiq</span>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label="Close navigation menu"
                    className="p-1.5 rounded-lg hover:bg-black/5"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <Link
                  href="/reviews/new"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] transition-colors"
                >
                  <FilePlus2 className="w-4 h-4" />
                  <span>Start New Review</span>
                </Link>

                <nav aria-label="Mobile workspace navigation" className="space-y-1">
                  {SIDEBAR_NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const active = isActiveRoute(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium ${
                          active
                            ? "bg-white text-[#141414] font-semibold"
                            : "text-[#524E4A] hover:bg-white/60"
                        }`}
                      >
                        <span className="flex items-center gap-3 min-w-0">
                          <span
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                              active ? "bg-[#141414] text-white" : "bg-white text-[#3F3B37]"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.href === "/approvals" && pendingApprovalsCount > 0 && (
                          <span className="text-xs font-mono tabular-nums text-[#524E4A]">
                            {pendingApprovalsCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </nav>
              </div>

              <Link
                href="/settings"
                onClick={() => setMobileMenuOpen(false)}
                className="pt-4 mt-4 border-t border-[#E4DDD5] flex items-center gap-3 min-w-0"
              >
                <ViewerAvatar
                  name={actor.name}
                  avatarId={viewerProfile.avatarId}
                  customAvatarDataUrl={viewerProfile.customAvatarDataUrl}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#141414] truncate">{actor.name}</p>
                  <p className="text-[11px] text-[#6B6560] truncate">{actor.role}</p>
                </div>
              </Link>
            </div>
          </div>
        )}

        {/* Active Page Canvas */}
        <div className="flex-1 min-w-0 overflow-x-hidden">{children}</div>
      </div>

      {/* Optional Guided Product Tour Modal */}
      <GuidedTourModal
        isOpen={guidedTourOpen && viewerProfile.onboardingCompleted}
        viewerName={actor.name}
        onClose={markGuidedTourCompleted}
      />
    </div>
  );
}
