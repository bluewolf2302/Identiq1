"use client";

import React, { useState } from "react";
import {
  AVATAR_PRESETS,
  getInitials,
  isSafeCustomAvatarDataUrl,
  PresetAvatarId,
} from "@/lib/viewer-profile";

interface ViewerAvatarProps {
  name: string;
  avatarId?: PresetAvatarId;
  customAvatarDataUrl?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<ViewerAvatarProps["size"]>, string> = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-7 h-7 text-[11px]",
  md: "w-9 h-9 text-xs",
  lg: "w-14 h-14 text-base",
  xl: "w-16 h-16 text-lg",
};

export function ViewerAvatar({
  name,
  avatarId = "obsidian",
  customAvatarDataUrl,
  size = "md",
  className = "",
}: ViewerAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const preset = AVATAR_PRESETS[avatarId] || AVATAR_PRESETS.obsidian;
  const initials = getInitials(name);
  const sizeClass = SIZE_CLASSES[size];

  const validCustomUrl =
    !imageFailed && isSafeCustomAvatarDataUrl(customAvatarDataUrl)
      ? customAvatarDataUrl
      : undefined;

  if (validCustomUrl) {
    return (
      <span
        className={`relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 border border-black/10 bg-[#F3EDE8] ${sizeClass} ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={validCustomUrl}
          alt={name || "Reviewer avatar"}
          onError={() => setImageFailed(true)}
          className="w-full h-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={name ? `${name} avatar` : "Reviewer avatar"}
      style={{
        backgroundColor: preset.bgHex,
        color: preset.fgHex,
        borderColor: preset.ringHex,
      }}
      className={`relative inline-flex items-center justify-center rounded-full shrink-0 border font-display font-bold tracking-tight select-none overflow-hidden ${sizeClass} ${className}`}
    >
      <svg
        viewBox="0 0 40 40"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
      >
        <circle cx="31" cy="9" r="9" fill={preset.accentHex} />
        <circle cx="8" cy="34" r="7" fill={preset.accentHex} />
      </svg>
      <span className="relative z-10 leading-none">{initials}</span>
    </span>
  );
}
