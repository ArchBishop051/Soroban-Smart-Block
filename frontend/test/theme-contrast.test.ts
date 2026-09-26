import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * WCAG 2.2 AA / AAA Relative Luminance & Contrast Matrix Test
 * Verifies that all design tokens in frontend/src/styles/tokens.css
 * satisfy official W3C accessibility contrast guidelines.
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(clean.slice(0, 6), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function relativeLuminance({ r, g, b }: RGB): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseTokens(cssContent: string): Record<string, Record<string, string>> {
  const themes: Record<string, Record<string, string>> = {
    dark: {},
    light: {},
    "high-contrast": {},
  };
  let currentTheme: string | null = null;
  const lines = cssContent.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comment lines
    if (line.startsWith("/*") || line.startsWith("*")) continue;

    // Stop before @media print
    if (line.startsWith("@media print")) {
      currentTheme = null;
      break;
    }

    if (line.includes(":root") || line.includes('[data-theme="dark"]')) {
      currentTheme = "dark";
    } else if (line.includes('[data-theme="light"]')) {
      currentTheme = "light";
    } else if (line.includes('[data-theme="high-contrast"]')) {
      currentTheme = "high-contrast";
    } else if (line === "}" && currentTheme) {
      currentTheme = null;
    }

    if (currentTheme && line.startsWith("--")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx !== -1) {
        const prop = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).replace(";", "").trim();
        const hexMatch = val.match(/#[0-9a-fA-F]{3,8}\b/);
        if (hexMatch) {
          themes[currentTheme][prop] = hexMatch[0];
        }
      }
    }
  }

  return themes;
}

describe("WCAG 2.2 AA Contrast Compliance Matrix", () => {
  const tokensPath = path.resolve(__dirname, "../src/styles/tokens.css");
  const cssContent = fs.readFileSync(tokensPath, "utf-8");
  const tokens = parseTokens(cssContent);

  describe("Dark Theme Contrast Standards", () => {
    const dark = tokens.dark;

    it("ensures normal text has >= 4.5:1 contrast against bg and surface", () => {
      const onBg = contrastRatio(dark["--text-primary"], dark["--bg"]);
      const onSurface = contrastRatio(dark["--text-primary"], dark["--surface"]);

      expect(onBg).toBeGreaterThanOrEqual(4.5);
      expect(onSurface).toBeGreaterThanOrEqual(4.5);
      // Both exceed 14:1!
      expect(onBg).toBeGreaterThanOrEqual(14.0);
    });

    it("ensures secondary text has >= 4.5:1 contrast against surface", () => {
      const onSurface = contrastRatio(dark["--text-secondary"], dark["--surface"]);
      expect(onSurface).toBeGreaterThanOrEqual(4.5);
      expect(onSurface).toBeGreaterThanOrEqual(10.0);
    });

    it("ensures muted text has >= 4.5:1 contrast against surface", () => {
      const onSurface = contrastRatio(dark["--text-muted"], dark["--surface"]);
      expect(onSurface).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures accent and interactive elements satisfy >= 4.5:1 contrast", () => {
      const accentOnBg = contrastRatio(dark["--accent"], dark["--bg"]);
      const textOnAccent = contrastRatio(dark["--accent-contrast"], dark["--accent"]);

      expect(accentOnBg).toBeGreaterThanOrEqual(4.5);
      expect(textOnAccent).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures status indicators (success, warning, danger) satisfy >= 4.5:1 contrast against surface", () => {
      const success = contrastRatio(dark["--success"], dark["--surface"]);
      const warning = contrastRatio(dark["--warning"], dark["--surface"]);
      const danger = contrastRatio(dark["--danger"], dark["--surface"]);

      expect(success).toBeGreaterThanOrEqual(4.5);
      expect(warning).toBeGreaterThanOrEqual(4.5);
      expect(danger).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("Light Theme Contrast Standards", () => {
    const light = tokens.light;

    it("ensures normal text has >= 4.5:1 contrast against bg and surface", () => {
      const onBg = contrastRatio(light["--text-primary"], light["--bg"]);
      const onSurface = contrastRatio(light["--text-primary"], light["--surface"]);

      expect(onBg).toBeGreaterThanOrEqual(4.5);
      expect(onSurface).toBeGreaterThanOrEqual(4.5);
      expect(onSurface).toBeGreaterThanOrEqual(14.0);
    });

    it("ensures secondary text has >= 4.5:1 contrast against surface", () => {
      const onSurface = contrastRatio(light["--text-secondary"], light["--surface"]);
      expect(onSurface).toBeGreaterThanOrEqual(4.5);
      expect(onSurface).toBeGreaterThanOrEqual(10.0);
    });

    it("ensures muted text has >= 4.5:1 contrast against surface", () => {
      const onSurface = contrastRatio(light["--text-muted"], light["--surface"]);
      expect(onSurface).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures accent and interactive elements satisfy >= 4.5:1 contrast", () => {
      const accentOnSurface = contrastRatio(light["--accent"], light["--surface"]);
      const textOnAccent = contrastRatio(light["--accent-contrast"], light["--accent"]);

      expect(accentOnSurface).toBeGreaterThanOrEqual(4.5);
      expect(textOnAccent).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures status indicators (success, warning, danger) satisfy >= 4.5:1 contrast against surface", () => {
      const success = contrastRatio(light["--success"], light["--surface"]);
      const warning = contrastRatio(light["--warning"], light["--surface"]);
      const danger = contrastRatio(light["--danger"], light["--surface"]);

      expect(success).toBeGreaterThanOrEqual(4.5);
      expect(warning).toBeGreaterThanOrEqual(4.5);
      expect(danger).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("High Contrast (WCAG AAA) Standards", () => {
    const hc = tokens["high-contrast"];

    it("ensures primary text achieves WCAG AAA >= 7:1 contrast", () => {
      const onBg = contrastRatio(hc["--text-primary"], hc["--bg"]);
      const onSurface = contrastRatio(hc["--text-primary"], hc["--surface"]);

      expect(onBg).toBeGreaterThanOrEqual(7.0);
      expect(onSurface).toBeGreaterThanOrEqual(7.0);
      // Pure white on black achieves maximum 21:1!
      expect(onBg).toBeCloseTo(21.0, 0);
    });

    it("ensures UI borders and dividers achieve >= 4.5:1 contrast", () => {
      const borderOnBg = contrastRatio(hc["--border"], hc["--bg"]);
      expect(borderOnBg).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures accent and status colors achieve >= 7:1 contrast", () => {
      const accent = contrastRatio(hc["--accent"], hc["--bg"]);
      const success = contrastRatio(hc["--success"], hc["--bg"]);
      const warning = contrastRatio(hc["--warning"], hc["--bg"]);
      const danger = contrastRatio(hc["--danger"], hc["--bg"]);

      expect(accent).toBeGreaterThanOrEqual(7.0);
      expect(success).toBeGreaterThanOrEqual(7.0);
      expect(warning).toBeGreaterThanOrEqual(7.0);
      expect(danger).toBeGreaterThanOrEqual(7.0);
    });
  });

  describe("Categorical Chart Palette Contrast Standards", () => {
    it("ensures each categorical chart color is distinguishable from its background in dark mode", () => {
      const dark = tokens.dark;
      for (let i = 1; i <= 6; i++) {
        const color = dark[`--chart-${i}`];
        expect(color).toBeDefined();
        const ratio = contrastRatio(color, dark["--graph-bg"]);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      }
    });

    it("ensures each categorical chart color is distinguishable from its background in light mode", () => {
      const light = tokens.light;
      for (let i = 1; i <= 6; i++) {
        const color = light[`--chart-${i}`];
        expect(color).toBeDefined();
        const ratio = contrastRatio(color, light["--graph-bg"]);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      }
    });
  });
});
