"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Lock,
  Mail,
  User,
  ArrowRight,
  Building2,
  AlertCircle,
  Loader2,
  Sparkles,
  BookOpen,
  FileCheck2,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import {
  DEMO_PERSONA_OPTIONS,
  type DemoPersona,
} from "@/lib/demo/teralune-demo-fixtures";

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    session,
    organisationId,
    signIn,
    signUp,
    signOut,
    createOrganisation,
    enterTeraluneDemo,
    demoPersona,
    setDemoPersona,
    notify,
  } = useIdentiq();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleTitle, setRoleTitle] = useState("Brand Governance Lead");
  const [orgName, setOrgName] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<DemoPersona>(demoPersona);
  const [loading, setLoading] = useState(false);
  const [enteringDemo, setEnteringDemo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Redirect to dashboard if already authenticated with an organisation
  useEffect(() => {
    if (session && organisationId) {
      router.push("/");
    }
  }, [session, organisationId, router]);

  const handleExploreDemo = async () => {
    if (enteringDemo) return;
    setEnteringDemo(true);
    try {
      setDemoPersona(selectedPersona);
      await enterTeraluneDemo({ persona: selectedPersona });
      router.push("/");
    } finally {
      setEnteringDemo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    if (!email || !password) {
      setErrorMsg("Please enter both email and password.");
      setLoading(false);
      return;
    }

    try {
      if (mode === "signin") {
        const res = await signIn(email, password);
        if (!res.success) {
          setErrorMsg(res.error || "Login failed. Check your credentials.");
        } else {
          if (organisationId) {
            router.push("/");
          }
        }
      } else {
        const res = await signUp(email, password, {
          full_name: fullName.trim() || undefined,
          role: roleTitle.trim() || undefined,
        });
        if (!res.success) {
          setErrorMsg(res.error || "Sign-up failed.");
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) {
      setErrorMsg("Organisation name is required.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await createOrganisation(orgName.trim());
      if (res.success) {
        notify(`Organisation created! Redirecting to dashboard...`);
        router.push("/");
      } else {
        setErrorMsg(res.error || "Failed to create organisation.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create organisation.");
    } finally {
      setLoading(false);
    }
  };

  // If user is authenticated but needs to create their first organisation
  if (session && !organisationId) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4 bg-[#FAF8F6]">
        <div className="w-full max-w-md bg-white border border-[#E7E1DA] rounded-[28px] p-8 shadow-sm space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[#E8E0F0] text-[#141414] flex items-center justify-center mx-auto">
              <Building2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#141414]">
              Create Your Organisation
            </h1>
            <p className="text-xs text-[#6B6560]">
              Signed in as <span className="font-semibold text-[#141414]">{user?.email}</span>. Create
              an organisation to organize your brand guidelines and review team.
            </p>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#F6D5DA]/60 border border-[#F6D5DA] text-xs text-[#7F1D1D]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleCreateOrg} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
                Organisation / Brand Company Name
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-[#8C847D] absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Brand Global"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating Organisation...
                </>
              ) : (
                <>
                  Establish Organisation &amp; Start
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => signOut()}
              className="text-xs text-[#6B6560] hover:text-[#141414] underline"
            >
              Sign out and return
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4 sm:p-6 bg-[#FAF8F6]">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Optional Sample Brand Sandbox Card */}
        <section className="lg:col-span-6 bg-[#F3EDE8] border border-[#E7E1DA] rounded-[28px] p-7 sm:p-8 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#14532D]">
                Optional Sample Brand
              </span>
              <span className="text-[11px] font-mono text-[#524E4A]">
                Teralune · v1.0
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#141414] text-balance">
                Try Identiq with Teralune
              </h1>
              <p className="text-sm text-[#3F3B37] leading-relaxed">
                Evaluate how Identiq reviews campaign copy and PDFs against a preloaded sample brand before connecting your own organisation.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="bg-white/80 border border-[#E7E1DA] rounded-2xl p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#141414]">
                  <BookOpen className="w-3.5 h-3.5 text-[#14532D]" />
                  <span>Published Guidelines</span>
                </div>
                <p className="text-[11px] text-[#524E4A] leading-snug">
                  Pre-loaded Teralune Brand Identity &amp; AI Guidelines (v1.0) and sample visual assets.
                </p>
              </div>
              <div className="bg-white/80 border border-[#E7E1DA] rounded-2xl p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#141414]">
                  <FileCheck2 className="w-3.5 h-3.5 text-[#14532D]" />
                  <span>Live Sample Ads</span>
                </div>
                <p className="text-[11px] text-[#524E4A] leading-snug">
                  Compare compliant and risky PDF campaigns through real multimodal analysis.
                </p>
              </div>
            </div>

            {/* Optional Non-Authoritative Workspace Perspective Selector */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#141414]">
                  Workspace Perspective
                </span>
                <span className="text-[11px] text-[#6B6560]">
                  Display preference · Non-authoritative
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Workspace perspective selector">
                {DEMO_PERSONA_OPTIONS.map((option) => {
                  const active = selectedPersona === option.persona;
                  return (
                    <button
                      key={option.persona}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelectedPersona(option.persona)}
                      className={`text-left rounded-2xl p-3 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141414] ${
                        active
                          ? "bg-white border-[#141414] text-[#141414]"
                          : "bg-white/60 border-[#E7E1DA] text-[#524E4A] hover:bg-white"
                      }`}
                    >
                      <p className="text-xs font-bold">{option.persona}</p>
                      <p className="text-[11px] text-[#6B6560] leading-snug mt-0.5">
                        {option.summary}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              disabled={enteringDemo}
              onClick={handleExploreDemo}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#141414]"
            >
              {enteringDemo ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Opening Sample Brand...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#CDEEE0]" />
                  Open Teralune Sample Brand
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            <p className="text-[11px] text-center text-[#6B6560]">
              Isolated sample sandbox — separate from customer organisation records.
            </p>
          </div>
        </section>

        {/* Workspace Sign-In / Create Account Card */}
        <section className="lg:col-span-6 bg-white border border-[#E7E1DA] rounded-[28px] p-7 sm:p-8 shadow-xs space-y-6">
          <div className="text-center space-y-2">
            <div className="w-11 h-11 rounded-2xl bg-[#141414] text-white flex items-center justify-center mx-auto">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-[#141414]">
              {mode === "signin" ? "Team Workspace Sign In" : "Create your Identiq account"}
            </h2>
            <p className="text-xs text-[#6B6560]">
              {mode === "signin"
                ? "Sign in with your organisation credentials"
                : "Register to manage brand evidence and approvals"}
            </p>
          </div>

          {/* Tab switch */}
          <div className="flex rounded-xl bg-[#FAF8F6] p-1 border border-[#E7E1DA]">
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setErrorMsg(null);
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === "signin"
                  ? "bg-white text-[#141414] shadow-xs"
                  : "text-[#6B6560] hover:text-[#141414]"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setErrorMsg(null);
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === "signup"
                  ? "bg-white text-[#141414] shadow-xs"
                  : "text-[#6B6560] hover:text-[#141414]"
              }`}
            >
              Create Account
            </button>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#F6D5DA]/60 border border-[#F6D5DA] text-xs text-[#7F1D1D]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#8C847D] absolute left-3.5 top-3" />
                    <input
                      type="text"
                      required
                      placeholder="Your full name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
                    Reviewer Role / Title
                  </label>
                  <input
                    type="text"
                    placeholder="Brand Governance Lead"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8C847D] absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8C847D] absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-[#FAF8F6] border border-[#E7E1DA] text-[#141414] text-xs font-semibold hover:bg-[#F3EDE8] transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mode === "signin" ? "Signing In..." : "Creating Account..."}
                </>
              ) : (
                <>
                  {mode === "signin" ? "Sign In to Workspace" : "Create Account & Continue"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
