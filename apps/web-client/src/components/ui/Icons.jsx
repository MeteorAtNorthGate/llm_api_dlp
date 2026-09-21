/**
 * Icons — the app's shared monochrome outline icon set.
 *
 * Every icon is stroke-only (`fill="none"`) and paints with `currentColor`, so
 * the call site picks the shade with a text-* class (e.g. `text-base-content/50`)
 * and the same glyph works in both themes. Geometry follows Feather/Lucide so
 * the set reads as one family; nothing here carries its own colour or emoji.
 *
 * Icons are decorative: they are `aria-hidden`, so a button whose only content
 * is an icon still needs its own aria-label / title.
 */

function Icon({ size = 16, className = '', children, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Navigation / disclosure ───────────────────────────────────────── */

export function ChevronRight(props) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

/* ── Actions ───────────────────────────────────────────────────────── */

export function Search(props) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </Icon>
  );
}

export function Close(props) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

export function Check(props) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

/* ── Status / meaning ──────────────────────────────────────────────── */

export function AlertTriangle(props) {
  return (
    <Icon {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

export function Lock(props) {
  return (
    <Icon {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  );
}

export function Key(props) {
  return (
    <Icon {...props}>
      <path d="m21 2-2 2" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
      <path d="m15.5 7.5-3.5 3.5" />
      <path d="M11.39 11.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777Z" />
    </Icon>
  );
}

export function Paperclip(props) {
  return (
    <Icon {...props}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Icon>
  );
}

/* ── Files ─────────────────────────────────────────────────────────── */

export function FileText(props) {
  return (
    <Icon {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </Icon>
  );
}

export function FileSpreadsheet(props) {
  return (
    <Icon {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </Icon>
  );
}

/**
 * Picks an outline icon for a file extension.
 *
 * Outline sets don't carry the per-format granularity emoji did, so this
 * collapses to two shapes — spreadsheet vs. everything else — with a
 * paperclip for unknown types. The filename is always rendered alongside,
 * so the extension stays visible.
 */
const FILE_ICONS = {
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  pdf: FileText,
  docx: FileText,
  doc: FileText,
  txt: FileText,
  csv: FileText,
  md: FileText,
};

export function FileTypeIcon({ ext, ...props }) {
  const Glyph = FILE_ICONS[String(ext || '').toLowerCase()] || Paperclip;
  return <Glyph {...props} />;
}
