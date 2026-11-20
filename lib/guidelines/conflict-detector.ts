import type { ManagedKnowledgeEntry } from "@/lib/brand-context";
import type {
  KnowledgeProposal,
  ProposalConflictMatch,
} from "./document-repository";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "brand",
  "must",
  "should",
  "always",
  "never",
  "rule",
  "guideline",
  "approved",
  "only",
  "all",
  "use",
  "not",
  "are",
  "will",
  "can",
  "per",
  "via",
]);

function tokenizeSubject(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function tokenJaccardOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) {
    if (setB.has(t)) shared += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? shared / union : 0;
}

function sharedTopicKeywords(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return [...new Set(a.filter((t) => setB.has(t)))];
}

function extractPrices(text: string): Array<{
  raw: string;
  currency: string;
  amount: number;
}> {
  const matches: Array<{ raw: string; currency: string; amount: number }> = [];
  const regex = /(₹|\$|£|€|USD|EUR|GBP|INR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const rawSym = m[1]!.toUpperCase();
    const currency =
      rawSym === "$"
        ? "USD"
        : rawSym === "£"
          ? "GBP"
          : rawSym === "€"
            ? "EUR"
            : rawSym === "₹"
              ? "INR"
              : rawSym;
    const amount = Number(m[2]!.replace(/,/g, ""));
    if (Number.isFinite(amount)) {
      matches.push({ raw: `${m[1]}${m[2]}`, currency, amount });
    }
  }
  return matches;
}

function extractDates(text: string): string[] {
  const found = new Set<string>();
  const isoRegex = /\b\d{4}-\d{2}-\d{2}\b/g;
  const namedRegex = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi;
  for (const m of text.match(isoRegex) ?? []) found.add(m.trim());
  for (const m of text.match(namedRegex) ?? []) found.add(m.trim());
  return [...found];
}

function extractHexCodes(text: string, explicit?: string[]): string[] {
  const set = new Set<string>(
    (explicit ?? []).map((h) => h.toUpperCase()),
  );
  for (const h of text.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
    set.add(h.toUpperCase());
  }
  return [...set];
}

function inferColourRole(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bprimary\b/.test(lower)) return "primary";
  if (/\bsecondary\b/.test(lower)) return "secondary";
  if (/\baccent\b/.test(lower)) return "accent";
  if (/\bbackground\b|\bsurface\b/.test(lower)) return "background";
  if (/\btext\b|\bbody\b|\bheading\b/.test(lower)) return "text";
  return null;
}

function polarity(text: string): "prohibitive" | "affirmative" | "neutral" {
  const lower = text.toLowerCase();
  const neg = /\b(?:never|must not|do not|don't|prohibited|forbidden|banned|cannot|avoid|restricted|disallow(?:ed)?)\b/.test(
    lower,
  );
  const pos = /\b(?:always|must include|approved|allowed|permitted|required|recommended|use)\b/.test(
    lower,
  );
  if (neg && !pos) return "prohibitive";
  if (pos && !neg) return "affirmative";
  if (neg) return "prohibitive";
  return "neutral";
}

function normalizePhrase(value: string | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/["'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeConflictMatch(
  entry: ManagedKnowledgeEntry,
  proposal: KnowledgeProposal,
  opts: {
    severity: "conflict" | "possible_conflict";
    category: ProposalConflictMatch["category"];
    reason: string;
  },
): ProposalConflictMatch {
  return {
    existingEntryId: entry.id,
    existingTitle: entry.title,
    existingContent: entry.content,
    existingSection: entry.section,
    existingStatus: "published",
    existingVersionId: entry.versionId,
    existingSourceDocumentId: entry.sourceDocumentId,
    existingSourceTitle: entry.sourceTitle,
    ...(entry.sourceDocumentVersion
      ? { existingSourceDocumentVersion: entry.sourceDocumentVersion }
      : {}),
    ...(entry.pageNumber === undefined
      ? {}
      : { existingPageNumber: entry.pageNumber }),
    ...(entry.sectionRef ? { existingSectionRef: entry.sectionRef } : {}),
    severity: opts.severity,
    category: opts.category,
    reason: opts.reason,
    proposalStatement: `${proposal.title}: ${proposal.content}`.slice(0, 320),
    existingStatement: `${entry.title}: ${entry.content}`.slice(0, 320),
  };
}

export function detectProposalConflicts(
  proposal: KnowledgeProposal,
  existingEntries: ManagedKnowledgeEntry[],
): {
  conflictStatus: "conflict" | "possible_conflict" | "no_conflict";
  matches: ProposalConflictMatch[];
} {
  const publishedEntries = existingEntries.filter(
    (e) =>
      e.publicationStatus === "published" &&
      e.brandId === proposal.brandId &&
      e.id !== proposal.publishedEntryId,
  );

  if (publishedEntries.length === 0) {
    return { conflictStatus: "no_conflict", matches: [] };
  }

  const matches: ProposalConflictMatch[] = [];
  const proposalText = `${proposal.title} ${proposal.content}`;
  const proposalTokens = tokenizeSubject(proposalText);
  const proposalPrices =
    proposal.structuredFacts?.numericPrice !== undefined
      ? [
          {
            raw:
              proposal.structuredFacts.price ||
              String(proposal.structuredFacts.numericPrice),
            currency: proposal.structuredFacts.currency || "USD",
            amount: proposal.structuredFacts.numericPrice,
          },
        ]
      : extractPrices(proposalText);
  const proposalDates = [
    ...(proposal.structuredFacts?.validFrom
      ? [proposal.structuredFacts.validFrom]
      : []),
    ...(proposal.structuredFacts?.validUntil
      ? [proposal.structuredFacts.validUntil]
      : []),
    ...extractDates(proposalText),
  ].filter((v, idx, arr) => arr.indexOf(v) === idx);
  const proposalHex = extractHexCodes(proposalText, proposal.hexCodes);
  const proposalColourRole = inferColourRole(proposalText);

  for (const entry of publishedEntries) {
    const entryText = `${entry.title} ${entry.content}`;
    const entryTokens = tokenizeSubject(entryText);
    const shared = sharedTopicKeywords(proposalTokens, entryTokens);
    const overlap = tokenJaccardOverlap(proposalTokens, entryTokens);

    const sameProduct =
      Boolean(proposal.structuredFacts?.productName) &&
      Boolean(entry.structuredFacts?.productName) &&
      normalizePhrase(proposal.structuredFacts?.productName) ===
        normalizePhrase(entry.structuredFacts?.productName);

    // 1. Price / numeric fact conflict
    const entryPrices =
      entry.structuredFacts?.numericPrice !== undefined
        ? [
            {
              raw:
                entry.structuredFacts.price ||
                String(entry.structuredFacts.numericPrice),
              currency: entry.structuredFacts.currency || "USD",
              amount: entry.structuredFacts.numericPrice,
            },
          ]
        : extractPrices(entryText);

    if (
      proposalPrices.length > 0 &&
      entryPrices.length > 0 &&
      (sameProduct || shared.length >= 1)
    ) {
      const pPrice = proposalPrices[0]!;
      const ePrice = entryPrices[0]!;
      if (
        pPrice.currency !== ePrice.currency ||
        Math.abs(pPrice.amount - ePrice.amount) > 0.001
      ) {
        matches.push(
          makeConflictMatch(entry, proposal, {
            severity: "conflict",
            category: "price",
            reason: `Published pricing states ${ePrice.raw} (${ePrice.currency}) while the new proposal states ${pPrice.raw} (${pPrice.currency}) for related subject (${shared.join(", ") || entry.title}).`,
          }),
        );
        continue;
      }
    }

    // 2. Date / promotional period conflict
    const entryDates = [
      ...(entry.structuredFacts?.validFrom
        ? [entry.structuredFacts.validFrom]
        : []),
      ...(entry.structuredFacts?.validUntil
        ? [entry.structuredFacts.validUntil]
        : []),
      ...extractDates(entryText),
    ].filter((v, idx, arr) => arr.indexOf(v) === idx);

    if (
      proposalDates.length > 0 &&
      entryDates.length > 0 &&
      (sameProduct || shared.length >= 2)
    ) {
      const sameDates =
        proposalDates.length === entryDates.length &&
        proposalDates.every((d) => entryDates.includes(d));
      if (!sameDates) {
        matches.push(
          makeConflictMatch(entry, proposal, {
            severity: "conflict",
            category: "date",
            reason: `Published effective/promo window (${entryDates.join(" – ")}) differs from the proposed window (${proposalDates.join(" – ")}).`,
          }),
        );
        continue;
      }
    }

    // 3. Colour hex conflict for the same role (primary, secondary, accent, etc.) or shared colour subject
    const entryHex = extractHexCodes(entryText, entry.hexCodes);
    const entryColourRole = inferColourRole(entryText);
    if (
      proposalHex.length > 0 &&
      entryHex.length > 0 &&
      ((proposalColourRole &&
        entryColourRole &&
        proposalColourRole === entryColourRole) ||
        shared.filter((w) => !["colour", "color", "palette"].includes(w)).length >= 2)
    ) {
      const disjoint = !proposalHex.some((h) => entryHex.includes(h));
      if (disjoint) {
        matches.push(
          makeConflictMatch(entry, proposal, {
            severity: "conflict",
            category: "colour",
            reason: `Published ${entryColourRole ?? "brand"} palette specifies ${entryHex.join(", ")} while this proposal specifies ${proposalHex.join(", ")}.`,
          }),
        );
        continue;
      }
    }

    // 4. Prohibited vs Preferred / Approved terminology contradiction
    const pAvoid = normalizePhrase(
      proposal.avoidTerm || proposal.structuredFacts?.restrictedTerm,
    );
    const pPrefer = normalizePhrase(
      proposal.preferredTerm || proposal.structuredFacts?.preferredTerm,
    );
    const eAvoid = normalizePhrase(
      entry.avoidTerm || entry.structuredFacts?.restrictedTerm,
    );
    const ePrefer = normalizePhrase(
      entry.preferredTerm || entry.structuredFacts?.preferredTerm,
    );

    const pApprovedText = normalizePhrase(
      proposal.structuredFacts?.approvedClaim || proposalText,
    );
    const eApprovedText = normalizePhrase(
      entry.structuredFacts?.approvedClaim || entryText,
    );

    const terminologyConflict =
      (pPrefer && eAvoid && (pPrefer === eAvoid || pPrefer.includes(eAvoid))) ||
      (ePrefer && pAvoid && (ePrefer === pAvoid || ePrefer.includes(pAvoid))) ||
      (proposal.category !== "prohibited" &&
        entry.section === "prohibited" &&
        eAvoid &&
        pApprovedText.includes(eAvoid)) ||
      (proposal.category === "prohibited" &&
        entry.section !== "prohibited" &&
        pAvoid &&
        eApprovedText.includes(pAvoid));

    if (terminologyConflict) {
      matches.push(
        makeConflictMatch(entry, proposal, {
          severity: "conflict",
          category: "terminology",
          reason: `Terminology or claim rules contradict each other between "${entry.title}" and this proposal.`,
        }),
      );
      continue;
    }

    // 5. Direct inverse rule polarity on closely overlapping topic
    const pPol = polarity(proposalText);
    const ePol = polarity(entryText);
    if (
      ((pPol === "affirmative" && ePol === "prohibitive") ||
        (pPol === "prohibitive" && ePol === "affirmative")) &&
      shared.length >= 2 &&
      overlap >= 0.2
    ) {
      matches.push(
        makeConflictMatch(entry, proposal, {
          severity: overlap >= 0.35 ? "conflict" : "possible_conflict",
          category: "inverse_rule",
          reason: `Opposite rule polarity detected on shared topic (${shared.slice(0, 4).join(", ")}): existing published rule is ${ePol} while proposal is ${pPol}.`,
        }),
      );
    }
  }

  const hasDefinite = matches.some((m) => m.severity === "conflict");
  const conflictStatus =
    matches.length === 0
      ? "no_conflict"
      : hasDefinite
        ? "conflict"
        : "possible_conflict";

  return { conflictStatus, matches };
}

export function attachConflictsToProposals(
  proposals: KnowledgeProposal[],
  existingEntries: ManagedKnowledgeEntry[],
): KnowledgeProposal[] {
  return proposals.map((proposal) => {
    if (proposal.status === "published" || proposal.status === "discarded") {
      return proposal;
    }
    const { conflictStatus, matches } = detectProposalConflicts(
      proposal,
      existingEntries,
    );
    return {
      ...proposal,
      conflictStatus,
      conflictMatches: matches,
    };
  });
}
