/**
 * Theme Token Utilities
 * Helpers for Canvas, Cytoscape, 3D Force Graph, and SVG charts to
 * dynamically read CSS custom property token values from the DOM.
 */

export function getCssToken(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

export function getGraphColors() {
  return {
    bg: getCssToken("--graph-bg", "#0d1117"),
    nodeContract: getCssToken("--graph-node-contract", "#bc8cff"),
    nodeWallet: getCssToken("--graph-node-wallet", "#58a6ff"),
    nodeText: getCssToken("--graph-node-text", "#f0f6fc"),
    edge: getCssToken("--graph-edge", "#484f58"),
    edgeHighlight: getCssToken("--graph-edge-highlight", "#79b8ff"),
    edgeText: getCssToken("--graph-edge-text", "#8b949e"),
  };
}

export function getChartPalette(): string[] {
  return [
    getCssToken("--chart-1", "#58a6ff"),
    getCssToken("--chart-2", "#3fb950"),
    getCssToken("--chart-3", "#e3b341"),
    getCssToken("--chart-4", "#bc8cff"),
    getCssToken("--chart-5", "#f0883e"),
    getCssToken("--chart-6", "#f85149"),
  ];
}
