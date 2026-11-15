import type { Metadata } from "next";
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { IdentiqProvider } from "@/components/IdentiqProvider";
import { AppShell } from "@/components/AppShell";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Identiq — Evidence-Driven Brand Governance",
    template: "%s · Identiq",
  },
  description:
    "Audit campaign copy, visual creatives, and brand claims against approved guidelines with traceable evidence before release.",
  applicationName: "Identiq",
  openGraph: {
    type: "website",
    title: "Identiq — Evidence-Driven Brand Governance",
    description:
      "Review campaign copy, visual assets, and product claims side by side against verified brand guidelines.",
    siteName: "Identiq",
  },
  twitter: {
    card: "summary",
    title: "Identiq — Evidence-Driven Brand Governance",
    description:
      "Audit campaign copy, visual creatives, and brand claims against approved guidelines with traceable evidence.",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#FAF8F6] text-[#141414]">
        <IdentiqProvider>
          <AppShell>{children}</AppShell>
        </IdentiqProvider>
      </body>
    </html>
  );
}
