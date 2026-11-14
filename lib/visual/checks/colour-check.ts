import sharp from "sharp";
import { hexToRgb, rgbToLab } from "../brand-context-adapter";
import type { VisualPipelineConfig } from "../config";
import type {
  ApprovedColorSpec,
  BrandVisualContext,
  ProcessedPage,
  VisualFinding,
  VisualObservation,
} from "../types";

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

/**
 * Sharma (2005) CIEDE2000 perceptual colour difference ΔE00.
 */
export function ciede2000(lab1: LabColor, lab2: LabColor): number {
  const deg2rad = (deg: number) => (deg * Math.PI) / 180;
  const rad2deg = (rad: number) => (rad * 180) / Math.PI;

  const C1 = Math.hypot(lab1.a, lab1.b);
  const C2 = Math.hypot(lab2.a, lab2.b);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1Prime = (1 + G) * lab1.a;
  const a2Prime = (1 + G) * lab2.a;

  const C1Prime = Math.hypot(a1Prime, lab1.b);
  const C2Prime = Math.hypot(a2Prime, lab2.b);

  const hPrimeFn = (bVal: number, aPrimeVal: number) => {
    if (bVal === 0 && aPrimeVal === 0) return 0;
    const angle = rad2deg(Math.atan2(bVal, aPrimeVal));
    return angle >= 0 ? angle : angle + 360;
  };

  const h1Prime = hPrimeFn(lab1.b, a1Prime);
  const h2Prime = hPrimeFn(lab2.b, a2Prime);

  const dLPrime = lab2.l - lab1.l;
  const dCPrime = C2Prime - C1Prime;

  let dhPrime = 0;
  if (C1Prime * C2Prime !== 0) {
    const diff = h2Prime - h1Prime;
    if (Math.abs(diff) <= 180) {
      dhPrime = diff;
    } else if (diff > 180) {
      dhPrime = diff - 360;
    } else {
      dhPrime = diff + 360;
    }
  }

  const dHPrime = 2 * Math.sqrt(C1Prime * C2Prime) * Math.sin(deg2rad(dhPrime / 2));

  const LbarPrime = (lab1.l + lab2.l) / 2;
  const CbarPrime = (C1Prime + C2Prime) / 2;

  let hbarPrime = h1Prime + h2Prime;
  if (C1Prime * C2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) <= 180) {
      hbarPrime = (h1Prime + h2Prime) / 2;
    } else if (h1Prime + h2Prime < 360) {
      hbarPrime = (h1Prime + h2Prime + 360) / 2;
    } else {
      hbarPrime = (h1Prime + h2Prime - 360) / 2;
    }
  }

  const T =
    1 -
    0.17 * Math.cos(deg2rad(hbarPrime - 30)) +
    0.24 * Math.cos(deg2rad(2 * hbarPrime)) +
    0.32 * Math.cos(deg2rad(3 * hbarPrime + 6)) -
    0.2 * Math.cos(deg2rad(4 * hbarPrime - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hbarPrime - 275) / 25, 2));
  const CbarPrime7 = Math.pow(CbarPrime, 7);
  const RC = 2 * Math.sqrt(CbarPrime7 / (CbarPrime7 + Math.pow(25, 7)));

  const LbarPrimeMinus50Sq = Math.pow(LbarPrime - 50, 2);
  const SL = 1 + (0.015 * LbarPrimeMinus50Sq) / Math.sqrt(20 + LbarPrimeMinus50Sq);
  const SC = 1 + 0.045 * CbarPrime;
  const SH = 1 + 0.015 * CbarPrime * T;
  const RT = -Math.sin(deg2rad(2 * dTheta)) * RC;

  const dE = Math.sqrt(
    Math.pow(dLPrime / SL, 2) +
      Math.pow(dCPrime / SC, 2) +
      Math.pow(dHPrime / SH, 2) +
      RT * (dCPrime / SC) * (dHPrime / SH),
  );

  return Math.round(dE * 100) / 100;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, "0").toUpperCase())
      .join("")
  );
}

export function findClosestApprovedColor(
  rgb: { r: number; g: number; b: number },
  palette: ApprovedColorSpec[],
): { closest: ApprovedColorSpec; deltaE: number } | null {
  if (palette.length === 0) return null;
  const lab = rgbToLab(rgb);
  let best: ApprovedColorSpec = palette[0]!;
  let bestDelta = ciede2000(lab, best.lab);

  for (let i = 1; i < palette.length; i++) {
    const candidate = palette[i]!;
    const delta = ciede2000(lab, candidate.lab);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }

  return { closest: best, deltaE: bestDelta };
}

interface ColorCluster {
  r: number;
  g: number;
  b: number;
  hex: string;
  pixelCount: number;
  share: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function isNeutralInkOrPaper(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  // Pure/near black text ink or pure/near white paper background
  return chroma < 14 && (max < 42 || min > 238);
}

/**
 * Analyses prominent colours in graphic/design regions (filtering out high-texture
 * photographic tiles so product photos don't generate false palette violations).
 */
export async function runColourCheck(
  page: ProcessedPage,
  brandContext: BrandVisualContext,
  config: VisualPipelineConfig,
): Promise<{
  findings: VisualFinding[];
  observations: VisualObservation[];
}> {
  if (page.status !== "ok" || page.pngBuffer.length === 0) {
    return { findings: [], observations: [] };
  }

  if (brandContext.approvedPalette.length === 0) {
    return {
      findings: [],
      observations: [
        {
          pageNumber: page.pageNumber,
          detector: "deterministic-colour",
          summary: "Skipped brand colour check: no approved colour palette provided in brand context.",
        },
      ],
    };
  }

  const sampleSize = 144;
  const { data, info } = await sharp(page.pngBuffer)
    .resize(sampleSize, sampleSize, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const gridCols = 6;
  const gridRows = 6;
  const tileW = Math.floor(w / gridCols);
  const tileH = Math.floor(h / gridRows);

  let graphicPixelCount = 0;
  let photographicTileCount = 0;

  // Quantization bucket map (24-step RGB quantization = ~11x11x11 bins)
  const buckets = new Map<
    string,
    {
      sumR: number;
      sumG: number;
      sumB: number;
      count: number;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }
  >();

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const startX = gx * tileW;
      const startY = gy * tileH;
      const endX = gx === gridCols - 1 ? w : startX + tileW;
      const endY = gy === gridRows - 1 ? h : startY + tileH;

      // Measure local pixel-to-pixel gradient variance to separate flat/vector graphics from complex photography
      let gradientSum = 0;
      let gradientSamples = 0;
      const uniqueBins = new Set<string>();

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * w + x) * 3;
          const r = data[idx]!;
          const g = data[idx + 1]!;
          const b = data[idx + 2]!;
          uniqueBins.add(`${r >> 4}-${g >> 4}-${b >> 4}`);

          if (x + 1 < endX) {
            const idxRight = (y * w + (x + 1)) * 3;
            const diff =
              Math.abs(r - data[idxRight]!) +
              Math.abs(g - data[idxRight + 1]!) +
              Math.abs(b - data[idxRight + 2]!);
            gradientSum += diff;
            gradientSamples++;
          }
        }
      }

      const avgGradient = gradientSamples > 0 ? gradientSum / gradientSamples : 0;
      const isPhotographicTile = avgGradient > 38 && uniqueBins.size > 55;
      if (isPhotographicTile) {
        photographicTileCount++;
        continue;
      }

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * w + x) * 3;
          const r = data[idx]!;
          const g = data[idx + 1]!;
          const b = data[idx + 2]!;
          graphicPixelCount++;

          if (isNeutralInkOrPaper(r, g, b)) continue;

          const qr = Math.floor(r / 20);
          const qg = Math.floor(g / 20);
          const qb = Math.floor(b / 20);
          const key = `${qr}-${qg}-${qb}`;

          const nx = x / w;
          const ny = y / h;
          const existing = buckets.get(key);
          if (existing) {
            existing.sumR += r;
            existing.sumG += g;
            existing.sumB += b;
            existing.count += 1;
            existing.minX = Math.min(existing.minX, nx);
            existing.minY = Math.min(existing.minY, ny);
            existing.maxX = Math.max(existing.maxX, nx);
            existing.maxY = Math.max(existing.maxY, ny);
          } else {
            buckets.set(key, {
              sumR: r,
              sumG: g,
              sumB: b,
              count: 1,
              minX: nx,
              minY: ny,
              maxX: nx,
              maxY: ny,
            });
          }
        }
      }
    }
  }

  const totalTiles = gridCols * gridRows;
  const mostlyPhotographic = photographicTileCount >= totalTiles * 0.75;

  // Merge nearby quantized buckets into coherent colour clusters
  const rawClusters: ColorCluster[] = [...buckets.values()]
    .filter((b) => b.count >= 12)
    .map((b) => {
      const r = Math.round(b.sumR / b.count);
      const g = Math.round(b.sumG / b.count);
      const bVal = Math.round(b.sumB / b.count);
      return {
        r,
        g,
        b: bVal,
        hex: rgbToHex(r, g, bVal),
        pixelCount: b.count,
        share: b.count / Math.max(1, graphicPixelCount),
        minX: b.minX,
        minY: b.minY,
        maxX: b.maxX,
        maxY: b.maxY,
      };
    })
    .sort((a, b) => b.pixelCount - a.pixelCount);

  const mergedClusters: ColorCluster[] = [];
  for (const cluster of rawClusters) {
    const cLab = rgbToLab(cluster);
    const match = mergedClusters.find(
      (existing) => ciede2000(cLab, rgbToLab(existing)) < 8.5,
    );
    if (match) {
      const total = match.pixelCount + cluster.pixelCount;
      match.r = Math.round((match.r * match.pixelCount + cluster.r * cluster.pixelCount) / total);
      match.g = Math.round((match.g * match.pixelCount + cluster.g * cluster.pixelCount) / total);
      match.b = Math.round((match.b * match.pixelCount + cluster.b * cluster.pixelCount) / total);
      match.hex = rgbToHex(match.r, match.g, match.b);
      match.pixelCount = total;
      match.share = total / Math.max(1, graphicPixelCount);
      match.minX = Math.min(match.minX, cluster.minX);
      match.minY = Math.min(match.minY, cluster.minY);
      match.maxX = Math.max(match.maxX, cluster.maxX);
      match.maxY = Math.max(match.maxY, cluster.maxY);
    } else {
      mergedClusters.push({ ...cluster });
    }
  }

  const prominentClusters = mergedClusters
    .filter((c) => c.share >= 0.03)
    .slice(0, 5);

  const colourRule =
    brandContext.rules.find((r) => r.category === "colour") ??
    brandContext.rules[0];
  const lowResolution =
    page.imageWidth < config.minReadableWidthPx ||
    page.imageHeight < config.minReadableHeightPx;

  const observations: VisualObservation[] = [
    {
      pageNumber: page.pageNumber,
      detector: "deterministic-colour",
      summary: `Analyzed ${prominentClusters.length} prominent graphic colour cluster(s) across ${totalTiles - photographicTileCount}/${totalTiles} non-photographic regions.`,
      metrics: {
        prominentClusterCount: prominentClusters.length,
        photographicTileCount,
        mostlyPhotographic,
        topColours: prominentClusters
          .map((c) => `${c.hex}(${Math.round(c.share * 100)}%)`)
          .join(", "),
      },
    },
  ];

  if (mostlyPhotographic && prominentClusters.length === 0) {
    return { findings: [], observations };
  }

  const findings: VisualFinding[] = [];
  const paletteSummary = brandContext.approvedPalette
    .map((p) => `${p.name} ${p.hex}`)
    .join(", ");

  for (const [idx, cluster] of prominentClusters.entries()) {
    const match = findClosestApprovedColor(cluster, brandContext.approvedPalette);
    if (!match) continue;

    const { closest, deltaE } = match;
    if (deltaE < config.colorDeltaEPossible) {
      continue;
    }

    const significant = deltaE >= config.colorDeltaESignificant;
    const isUncertain = lowResolution || mostlyPhotographic || !significant;
    const coveragePct = Math.round(cluster.share * 100);

    // Ensure non-zero bounding box
    const bx = Math.max(0, Math.min(0.95, cluster.minX));
    const by = Math.max(0, Math.min(0.95, cluster.minY));
    const bw = Math.max(0.05, Math.min(1 - bx, cluster.maxX - bx));
    const bh = Math.max(0.05, Math.min(1 - by, cluster.maxY - by));

    const confidence = isUncertain
      ? Math.min(0.68, Math.max(0.45, 0.55 + (deltaE - 10) / 80))
      : Math.min(0.96, 0.78 + Math.min(0.18, (deltaE - config.colorDeltaESignificant) / 100));

    findings.push({
      id: `vis-colour-p${page.pageNumber}-${idx + 1}`,
      ruleId: colourRule?.ruleId ?? "IMG-03",
      category: "colour",
      title: significant
        ? `Unapproved dominant colour ${cluster.hex} detected`
        : `Possible colour deviation ${cluster.hex} detected`,
      explanation: `Prominent graphic region (${coveragePct}% of non-photographic layout) uses ${cluster.hex}, which differs from the closest approved palette colour ${closest.name} (${closest.hex}) by CIEDE2000 ΔE00 = ${deltaE.toFixed(1)}.`,
      expectedValue: `Approved brand palette: ${paletteSummary}`,
      observedValue: `${cluster.hex} (~${coveragePct}% graphic area, ΔE00=${deltaE.toFixed(1)} vs ${closest.hex})`,
      sourceReference: {
        sourceId: closest.sourceId || colourRule?.sourceId || null,
        sourceVersion: closest.sourceVersion || colourRule?.sourceVersion || null,
        sourceTitle: closest.sourceTitle || colourRule?.sourceTitle || null,
        pageNumber: closest.pageNumber ?? colourRule?.pageNumber ?? null,
        excerpt: closest.excerpt || colourRule?.excerpt || null,
      },
      creativeEvidence: {
        assetId: page.originalAssetId,
        pageNumber: page.pageNumber,
        boundingBox: { x: bx, y: by, width: bw, height: bh },
        description: `Prominent graphic colour region (${coveragePct}% coverage) on page ${page.pageNumber} measured via CIEDE2000`,
      },
      confidence: Math.round(confidence * 100) / 100,
      reviewStatus: isUncertain ? "uncertain" : "candidate",
      severity: significant && !isUncertain ? "HIGH" : "MEDIUM",
      detector: "deterministic",
      classification: significant && !isUncertain ? "objective_mismatch" : "possible_mismatch",
      suggestedCorrection: `Replace prominent ${cluster.hex} graphic elements with ${closest.name} (${closest.hex}) or another approved palette colour.`,
    });
  }

  // Cap at top 3 colour findings per page to avoid noise
  return { findings: findings.slice(0, 3), observations };
}

export function parsePaletteHexes(hexList: string[]) {
  return hexList
    .map((h) => {
      const rgb = hexToRgb(h);
      return rgb ? { hex: h.toUpperCase(), rgb, lab: rgbToLab(rgb) } : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
}
