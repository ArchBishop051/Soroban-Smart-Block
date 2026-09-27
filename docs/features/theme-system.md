# Theme System & System-Preference Synchronization

## Overview
Soroban Smart Block Explorer features a robust, zero-flash design token and theming engine designed to satisfy **WCAG 2.2 AA and AAA accessibility guidelines** while providing seamless synchronization with user operating system preferences.

Implemented under **[Issue #804](https://github.com/Soroban-Smart-Block-Explorer/Soroban-Smart-Block/issues/804)**.

---

## Key Features

1. **4 Distinct Themes**:
   - **System**: Automatically tracks OS color scheme (`prefers-color-scheme: dark | light`) and detects high contrast preferences (`prefers-contrast: more`).
   - **Dark**: High-contrast, low-eyestrain dark palette tailored for blockchain exploration.
   - **Light**: Crisp, high-readability light palette with verified contrast ratios exceeding 4.5:1.
   - **High Contrast**: WCAG AAA compliant stark black/white palette with vivid status highlights for maximum visual accessibility.

2. **Zero-Flash Pre-Hydration Bootstrap**:
   - Executes an inline script in `<head>` before any DOM element renders.
   - Inspects `localStorage.getItem("sb-theme-preference")` and evaluates `window.matchMedia`.
   - Sets `document.documentElement.setAttribute("data-theme", resolvedTheme)` immediately to prevent Flash of Unstyled/Incorrect Theme (FOUT/FOIT).
   - Dynamically updates `<meta name="theme-color">` to match the resolved theme's surface color.

3. **React Theme Architecture (`ThemeContext` & `useTheme`)**:
   - Exposes `theme` (user preference), `resolvedTheme` (effective theme), `systemTheme` (live OS state), and `setTheme()`.
   - Listens to media query change events live when in `system` mode.
   - Cross-tab synchronization via `window.addEventListener("storage", ...)`.
   - Safe error handling for restricted `localStorage` environments (sandboxed iframes, private browsing).

4. **Accessible Theme Toggle (`ThemeToggle.tsx`)**:
   - WAI-ARIA compliant segmented dropdown menu.
   - Proper keyboard navigation: `Enter`/`Space` to open, `ArrowDown`/`ArrowUp` to navigate, `Enter` to select, `Escape` to close.
   - Informative `aria-label`, `aria-haspopup="menu"`, and `role="menuitemradio"`.

5. **Colorblind-Safe Categorical Chart & Graph Tokens**:
   - Semantic CSS custom properties `--chart-1` through `--chart-6` tailored per theme.
   - Dynamic integration for Cytoscape and 3D Force Graph via `getGraphColors()` in `frontend/src/utils/themeTokens.ts`.

6. **Print Mode Optimization**:
   - `@media print` rules enforce ink-saving clean white backgrounds, black text, and suppress navigation and interactive action buttons.

7. **Raw-Color CI Linting Gate**:
   - `scripts/check-raw-colors.mjs` scans stylesheets in `frontend/src/` to prevent raw `#hex` or `rgb()` color leaks.
   - Ensures all styling adheres strictly to design tokens defined in `frontend/src/styles/tokens.css`.

---

## Token Reference

| Token Name | Dark Value | Light Value | High Contrast Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--bg` | `#0d1117` | `#f6f8fa` | `#000000` | Canvas / Page background |
| `--surface` | `#161b22` | `#ffffff` | `#0a0a0a` | Container / Card surface |
| `--surface-raised` | `#21262d` | `#f3f4f6` | `#141414` | Elevated cards / popovers |
| `--surface-sunken` | `#090d13` | `#eaedf1` | `#000000` | Inset terminal / inputs |
| `--border` | `#30363d` | `#d0d7de` | `#ffffff` | Primary border line |
| `--border-strong` | `#8b949e` | `#57606a` | `#ffffff` | High-contrast divider |
| `--text-primary` | `#f0f6fc` | `#1f2328` | `#ffffff` | High-contrast body text |
| `--text-secondary` | `#c9d1d9` | `#32383f` | `#f0f0f0` | Secondary description text |
| `--text-muted` | `#8b949e` | `#59636e` | `#e6e6e6` | Muted hints & timestamps |
| `--accent` | `#58a6ff` | `#0969da` | `#40c4ff` | Primary link & action color |
| `--success` | `#3fb950` | `#1a7f37` | `#00ff66` | Success status & verified badges |
| `--warning` | `#e3b341` | `#9a6700` | `#ffff00` | Warning & pending indicators |
| `--danger` | `#f85149` | `#cf222e` | `#ff6b6b` | Danger & error indicators |
| `--chart-1` .. `--6` | Adaptive | Adaptive | Adaptive | Colorblind-safe chart palette |

---

## Verification & Testing

Run all theme verification suites:
```bash
# 1. Color linting gate
npm run lint:colors --prefix frontend

# 2. Theme context, system sync, and UI tests
npm test test/theme.test.tsx --prefix frontend

# 3. Automated WCAG 2.2 AA contrast matrix
npm test test/theme-contrast.test.ts --prefix frontend
```
