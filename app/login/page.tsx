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
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";

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
    enterSharedDemoMode,
    enterLocalDemoMode,
    notify,
  } = useIdentiq();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleTitle, setRoleTitle] = useState("Brand Governance Lead");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Redirect to dashboard if already authenticated with an organisation
  useEffect(() => {
    if (session && organisationId) {
      router.push("/");
    }
  }, [session, organisationId, router]);

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
                  Establish Organisation & Start
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
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4 bg-[#FAF8F6]">
      <div className="w-full max-w-md bg-white border border-[#E7E1DA] rounded-[28px] p-8 shadow-sm space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#141414] text-white flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#141414]">
            {mode === "signin" ? "Team Workspace Sign In" : "Create your Identiq account"}
          </h1>
          <p className="text-xs text-[#6B6560]">
            {mode === "signin"
              ? "Sign in to access your shared brand governance workspace"
              : "Register to manage brand evidence, reviews, and compliance records"}
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

        {/* Error Banner */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#F6D5DA]/60 border border-[#F6D5DA] text-xs text-[#7F1D1D]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form */}
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
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] transition-colors disabled:opacity-50"
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

        {/* Demo Mode Options */}
        <div className="pt-2 border-t border-[#EFECE7] space-y-2.5">
          <button
            type="button"
            onClick={async () => {
              await enterSharedDemoMode();
              router.push("/");
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full bg-[#CDEEE0]/50 border border-[#BAE0D0] text-xs font-semibold text-[#14532D] hover:bg-[#CDEEE0] transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#14532D]" />
            Continue in Shared Demo Workspace
          </button>

          <button
            type="button"
            onClick={() => {
              enterLocalDemoMode();
              router.push("/");
            }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-full bg-[#FAF8F6] border border-[#E7E1DA] text-xs font-medium text-[#524E4A] hover:bg-[#F3EDE8] transition-colors"
          >
            Continue in Browser Session Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
