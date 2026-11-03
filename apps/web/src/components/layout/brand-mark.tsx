/** Repère d'impression, signe de marque, suivi de la gamme de contrôle CMJN. */
export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        viewBox="0 0 24 24"
        className="size-6 shrink-0 text-sidebar-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 1.5v21M1.5 12h21" />
      </svg>
      <div className="min-w-0">
        <p className="text-[13px] leading-tight font-semibold tracking-wide text-sidebar-foreground">
          ARKSEN
        </p>
        <p className="text-[11px] leading-tight text-sidebar-muted">Print Manager</p>
      </div>
    </div>
  );
}

export function ControlStrip() {
  return (
    <div className="flex h-1" aria-hidden="true">
      <span className="flex-1 bg-[var(--ink-cyan)]" />
      <span className="flex-1 bg-[var(--ink-magenta)]" />
      <span className="flex-1 bg-[var(--ink-yellow)]" />
      <span className="flex-1 bg-[oklch(0.1_0_0)]" />
    </div>
  );
}
