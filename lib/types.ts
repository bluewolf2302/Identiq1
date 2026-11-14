export type FindingSeverity = "high" | "medium" | "low";

export type EvidenceStatus = "supported" | "conflicting" | "unverified";

export type FindingCategory =
  | "Brand Claims"
  | "Terminology"
  | "Tone & Voice"
  | "Visual Identity"
  | "Legal & Usage";

export interface ReviewComment {
  id: string;
  author: string;
  role: string;
  text: string;
  createdAt: string;
}

export interface ReviewFinding {
  id: string;
  category: FindingCategory;
  title: string;
  description: string;
  severity: FindingSeverity;
  evidenceStatus: EvidenceStatus;
  detectedValue: string;
  expectedValue: string;
  sourceReference: string;
  recommendation: string;
  affectedContent: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  editedCorrection?: string;
  comments: ReviewComment[];
  evidenceReferences?: import("./contracts").EvidenceReference[];
  sourceVersionIds?: string[];
  location?: import("./contracts").FindingLocation;
  confidence?: number;
  detector?: import("./contracts").FindingDetector;
  ruleId?: string | null;
  requiresHumanReview?: boolean;
  sourceDomain?: "text" | "visual";
}

export type ReviewStatus =
  | "Pending Approval"
  | "In Review"
  | "Changes Requested"
  | "Approved";

export type ContentType =
  | "Campaign Copy"
  | "Social Creative"
  | "Product Sheet"
  | "Press Release"
  | "Landing Page";

export type PastelTheme =
  | "pink"
  | "peach"
  | "lavender"
  | "mint"
  | "blue"
  | "yellow";

export interface ReviewSubmission {
  id: string;
  title: string;
  contentType: ContentType;
  guidelineCollection: string;
  submittedBy: string;
  submittedAt: string;
  status: ReviewStatus;
  complianceScore: number;
  textContent: string;
  assetUrl?: string;
  assetName?: string;
  findings: ReviewFinding[];
  pastelTheme: PastelTheme;
  reviewerNotes?: string;
  providerUsed?: string;
  fallbackUsed?: boolean;
  analysisStatus?: "COMPLETED" | "PARTIAL" | "FAILED";
  analysisRunId?: string;
  ocrBlocks?: import("./contracts").OcrBlockContract[];
  visualSummary?: import("./contracts").VisualAnalysisSummary;
}

export type KnowledgeSection =
  | "guidelines"
  | "facts"
  | "terminology"
  | "prohibited"
  | "voice"
  | "visual"
  | "policies";

export interface KnowledgeEntry {
  id: string;
  section: KnowledgeSection;
  title: string;
  content: string;
  preferredTerm?: string;
  avoidTerm?: string;
  hexCodes?: string[];
  fontFamily?: string;
  status: "Approved" | "Pending Review";
  updatedAt: string;
  owner: string;
}

export type AssetCategory =
  | "Logos"
  | "Brand Images"
  | "Marketing Assets"
  | "Icons & Marks";

export interface BrandAsset {
  id: string;
  name: string;
  category: AssetCategory;
  format: string;
  dimensions: string;
  status: "Approved" | "Pending Review";
  previewUrl?: string;
  colorTone: PastelTheme;
  usageNote: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  reviewId?: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  type:
    | "submitted"
    | "resolved"
    | "approved"
    | "changes_requested"
    | "knowledge_updated"
    | "asset_uploaded"
    | "correction_applied"
    | "comment_added"
    | "manual_finding_added";
}

export interface AnalysisRequestPayload {
  title: string;
  contentType: ContentType;
  guidelineCollection: string;
  textContent: string;
  submissionId?: string;
  assetName?: string;
  assetBase64?: string;
  assetMimeType?: string;
  knowledgeSummary?: string[];
}

export interface AnalysisResponsePayload {
  complianceScore: number;
  providerUsed: string;
  summary: string;
  findings: ReviewFinding[];
  submissionId?: string;
  analysisRunId?: string;
  analysisStatus?: "COMPLETED" | "PARTIAL" | "FAILED";
  fallbackUsed?: boolean;
  ocrBlocks?: import("./contracts").OcrBlockContract[];
  visualSummary?: import("./contracts").VisualAnalysisSummary;
}
