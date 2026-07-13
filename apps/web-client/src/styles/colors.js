/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LLM Platform — Color Palette & Theme Configuration
 *
 *  This is the single source of truth for the daisyUI theme colors.
 *  Edit this file to change the look & feel of the entire application.
 *  Changes take effect on next build / dev-server restart.
 *
 *  Naming convention (daisyUI v4 semantic tokens):
 *    primary      = main brand color (buttons, links, active states)
 *    secondary    = accent color for secondary elements
 *    accent       = highlight / focus color
 *    neutral      = text, borders, subtle backgrounds
 *    base-100     = page background
 *    base-200     = card / panel background
 *    base-300     = border color
 *    base-content = main text color
 *    info         = informational alerts
 *    success      = success alerts / badges
 *    warning      = warning alerts / badges
 *    error        = error alerts / badges
 * ═══════════════════════════════════════════════════════════════════════
 */

export const lightTheme = {
  /* ── Brand Colors ─────────────────────────────────────────────────── */
  'primary':           '#466be5',  /* Indigo 600 — main brand */
  'primary-content':   '#ffffff',  /* Text on primary bg */

  'secondary':         '#4c3aed',  /* Violet 600 — secondary elements */
  'secondary-content': '#ffffff',

  'accent':            '#06b6d4',  /* Cyan 500 — highlights, focus rings */
  'accent-content':    '#ffffff',

  /* ── Neutral / Surface Colors ─────────────────────────────────────── */
  'neutral':           '#f1f5f9',  /* Slate 50 — assistant bubble bg */
  'neutral-content':   '#1e293b',  /* Slate 800 — on neutral bg */

  'base-100':          '#ffffff',  /* Page background */
  'base-200':          '#f1f5f9',  /* Card / panel / sidebar bg */
  'base-300':          '#e2e8f0',  /* Borders, dividers */
  'base-content':      '#1e293b',  /* Main text color */

  /* ── Semantic Colors ──────────────────────────────────────────────── */
  'info':              '#3b82f6',  /* Blue 500 */
  'info-content':      '#ffffff',
  'success':           '#10b981',  /* Emerald 500 */
  'success-content':   '#ffffff',
  'warning':           '#f59e0b',  /* Amber 500 */
  'warning-content':   '#ffffff',
  'error':             '#ef4444',  /* Red 500 */
  'error-content':     '#ffffff',

  /* ── Spacing & Radius Tokens ──────────────────────────────────────── */
  '--rounded-box':     '0.5rem',   /* Card / modal border radius */
  '--rounded-btn':     '0.5rem',   /* Button border radius */
  '--rounded-badge':   '1.9rem',   /* Badge border radius */

  /* ── Animation ────────────────────────────────────────────────────── */
  '--animation-btn':   '0.25s',
  '--animation-input': '0.2s',
  '--btn-focus-scale': '0.97',
};

export const darkTheme = {
  /* ── Brand Colors — VS Code Dark+ inspired ────────────────────────── */
  'primary':           '#007acc',  /* VS Code blue — active states */
  'primary-content':   '#ffffff',

  'secondary':         '#3794ff',  /* Link / selection blue */
  'secondary-content': '#ffffff',

  'accent':            '#4ec9b0',  /* Teal highlight — syntax accent */
  'accent-content':    '#1e1e1e',

  /* ── Neutral / Surface Colors — VS Code Dark+ inspired ────────────── */
  'neutral':           '#2d2d2d',  /* Subtle bubble / input bg */
  'neutral-content':   '#cccccc',

  'base-100':          '#1e1e1e',  /* Editor / page background */
  'base-200':          '#252526',  /* Sidebar / panel background */
  'base-300':          '#3c3c3c',  /* Borders, dividers */
  'base-content':      '#d4d4d4',  /* Main text color */

  /* ── Semantic Colors — VS Code Dark+ inspired ─────────────────────── */
  'info':              '#3794ff',
  'info-content':      '#ffffff',
  'success':           '#89d185',
  'success-content':   '#1e1e1e',
  'warning':           '#cca700',
  'warning-content':   '#1e1e1e',
  'error':             '#f14c4c',
  'error-content':     '#ffffff',

  /* ── Spacing & Radius Tokens ──────────────────────────────────────── */
  '--rounded-box':     '0.5rem',
  '--rounded-btn':     '0.5rem',
  '--rounded-badge':   '1.9rem',

  /* ── Animation ────────────────────────────────────────────────────── */
  '--animation-btn':   '0.25s',
  '--animation-input': '0.2s',
  '--btn-focus-scale': '0.97',
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Preset Swatches — replace lightTheme with one of these to try
 *  different color schemes
 * ═══════════════════════════════════════════════════════════════════════

export const blueTheme = {
  'primary':           '#2563eb',
  'primary-content':   '#ffffff',
  'secondary':         '#0891b2',
  'secondary-content': '#ffffff',
  'accent':            '#06b6d4',
  'accent-content':    '#ffffff',
  'neutral':           '#1e293b',
  'neutral-content':   '#f8fafc',
  'base-100':          '#ffffff',
  'base-200':          '#f1f5f9',
  'base-300':          '#e2e8f0',
  'base-content':      '#1e293b',
  'info':              '#3b82f6',
  'info-content':      '#ffffff',
  'success':           '#10b981',
  'success-content':   '#ffffff',
  'warning':           '#f59e0b',
  'warning-content':   '#ffffff',
  'error':             '#ef4444',
  'error-content':     '#ffffff',
  '--rounded-box':     '0.5rem',
  '--rounded-btn':     '0.5rem',
  '--rounded-badge':   '1.9rem',
  '--animation-btn':   '0.25s',
  '--animation-input': '0.2s',
  '--btn-focus-scale': '0.97',
};

// To use a preset, replace `...lightTheme` with `...blueTheme` (or
// another preset) in tailwind.config.js
 */