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
  Menu,
  X,
  Plus,
  ShieldCheck,
  LogOut,
  LogIn,
  RotateCcw,
} from "lucide-react";
import { useIdentiq } from "./IdentiqProvider";

interface NavItem {
  label: string;
  shortLabel: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", shortLabel: "Dashboard", href: "/", icon: LayoutDashboard },
  {
    label: "Brand Knowledge Hub",
    shortLabel: "Knowledge Hub",
    href: "/knowledge-hub",
    icon: BookOpen,
  },
  { label: "Asset Library", shortLabel: "Asset Library", href: "/assets", icon: Images },
  { label: "New Review", shortLabel: "New Review", href: "/reviews/new", icon: FilePlus2 },
  { label: "Review Studio", shortLabel: "Review Studio", href: "/studio", icon: ScanSearch },
  { label: "Approvals", shortLabel: "Approvals", href: "/approvals", icon: CheckSquare },
  { label: "Activity / History", shortLabel: "Activity", href: "/activity", icon: History },
  { label: "Reports & Export", shortLabel: "Reports", href: "/reports", icon: FileBarChart },
  { label: "Settings", shortLabel: "Settings", href: "/settings", icon: Settings },
];

const TOP_BAR_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Knowledge Hub", href: "/knowledge-hub" },
  { label: "Asset Library", href: "/assets" },
  { label: "Review Studio", href: "/studio" },
  { label: "Approvals", href: "/approvals" },
  { label: "Reports", href: "/reports" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { settings, reviews, user, persistenceMode, userRole, signOut, resetDemoWorkspace } = useIdentiq();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pendingApprovalsCount = reviews.filter(
    (r) => r.status === "Pending Approval" || r.status === "In Review"
  ).length;

  const isActiveRoute = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F6] text-[#141414]">
      {/* Reference 2 inspired sleek black top navigation bar (3-zone contract) */}
      <header className="sticky top-0 z-40 h-14 bg-[#111113] text-white border-b border-black/15 px-4 lg:px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark + mobile drawer button */}
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

        {/* Zone 2: 5 clean single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-[13px] font-medium">
          {TOP_BAR_LINKS.map((link) => {
            const active = isActiveRoute(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  active
                    ? "text-white border-white"
                    : "text-white/65 border-transparent hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary CTA + reviewer profile + auth status */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/reviews/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#111113] hover:bg-[#F3EDE8] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Review
          </Link>

          {persistenceMode === "AUTHENTICATED_SUPABASE" ? (
            <div className="flex items-center gap-2 pl-2 border-l border-white/15 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#CDEEE0]/20 text-[#CDEEE0] border border-[#CDEEE0]/30 text-[11px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#CDEEE0]" />
                {userRole || "Member"}
              </span>
              <Link
                href="/settings"
                title={user?.email || settings.reviewerName}
                className="hidden sm:flex items-center gap-2"
              >
                <img
                  src="/images/avatar_brand_lead.jpg"
                  alt={user?.email || settings.reviewerName}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-full object-cover border border-white/25"
                />
                <span className="text-xs font-medium text-white/90 max-w-[120px] truncate">
                  {user?.user_metadata?.full_name || user?.email?.split("@")[0] || settings.reviewerName}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => signOut()}
                title="Sign out of Supabase"
                className="p-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : persistenceMode === "SHARED_DEMO" ? (
            <div className="flex items-center gap-2 pl-2 border-l border-white/15 shrink-0">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#CDEEE0]/20 text-[#CDEEE0] border border-[#CDEEE0]/35 text-[11px] font-semibold">
                <span className="w-2 h-2 rounded-full bg-[#6EE7B7] animate-pulse" />
                Shared Demo Workspace — Hosted Database
              </span>
              <Link
                href="/login"
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-[11px] font-medium transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 pl-2 border-l border-white/15 shrink-0">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-[11px] font-medium transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{persistenceMode === "AUTHENTICATED_NO_ORGANISATION" ? "Create Org" : "Sign In"}</span>
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace Frame: Left Vertical Navigation Rail (Reference 1) + Content Canvas */}
      <div className="flex-1 flex min-w-0">
        {/* Desktop Vertical Left Navigation Rail */}
        <aside className="hidden lg:flex w-[228px] shrink-0 flex-col justify-between bg-[#F3EDE8] border-r border-[#E7E1DA] py-5 px-3.5">
          <div className="space-y-1.5">
            {NAV_ITEMS.map((item) => {
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
          </div>

          <div className="pt-4 mt-4 border-t border-[#E4DDD5] space-y-2">
            <Link
              href="/settings"
              className="flex items-center justify-between p-2 rounded-2xl hover:bg-white/60 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/images/avatar_brand_lead.jpg"
                  alt={user?.email || settings.reviewerName}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover border border-[#DED6CE] shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#141414] truncate">
                    {user?.user_metadata?.full_name || user?.email?.split("@")[0] || settings.reviewerName}
                  </p>
                  <p className="text-[11px] text-[#6B6560] truncate">
                    {persistenceMode === "AUTHENTICATED_SUPABASE"
                      ? `${userRole || "Member"} · Persisted`
                      : persistenceMode === "SHARED_DEMO"
                      ? "Shared Demo · Hosted Database"
                      : "Local Offline Demo"}
                  </p>
                </div>
              </div>
            </Link>

            {persistenceMode === "AUTHENTICATED_SUPABASE" ? (
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-[#E7E1DA] bg-white text-xs text-[#524E4A] hover:bg-[#FAF8F6] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            ) : persistenceMode === "SHARED_DEMO" ? (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => resetDemoWorkspace()}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-[#E7E1DA] bg-white text-xs font-medium text-[#524E4A] hover:bg-[#FAF8F6] transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#8C847D]" />
                  Reset Demo DB
                </button>
                <Link
                  href="/login"
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-[#141414] text-white text-xs font-medium hover:bg-[#2B2B2B] transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign In
                </Link>
              </div>
            ) : (
              <Link
                href="/login"
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-[#141414] text-white text-xs font-medium hover:bg-[#2B2B2B] transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                Connect Supabase
              </Link>
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
            <div className="relative w-72 max-w-[85vw] bg-[#F3EDE8] h-full flex flex-col justify-between p-5 shadow-2xl">
              <div>
                <div className="flex items-center justify-between mb-6">
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
                <nav className="space-y-1.5">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const active = isActiveRoute(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium ${
                          active
                            ? "bg-white text-[#141414] font-semibold"
                            : "text-[#524E4A] hover:bg-white/60"
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            active ? "bg-[#141414] text-white" : "bg-white text-[#3F3B37]"
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
              <div className="pt-4 border-t border-[#E4DDD5] flex items-center gap-3">
                <img
                  src="/images/avatar_brand_lead.jpg"
                  alt={settings.reviewerName}
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-full object-cover"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{settings.reviewerName}</p>
                  <p className="text-[11px] text-[#6B6560] truncate">
                    {settings.reviewerRole}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Active Page Canvas */}
        <div className="flex-1 min-w-0 overflow-x-hidden">{children}</div>
      </div>
    </div>
  );
}
