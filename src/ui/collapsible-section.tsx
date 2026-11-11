import type { ReactNode, Ref } from "react";

export function CollapsibleSection({
  id,
  title,
  kicker,
  count,
  className = "",
  detailsRef,
  initiallyOpen = true,
  children,
}: {
  id: string;
  title: string;
  kicker?: string;
  count?: number;
  className?: string;
  detailsRef?: Ref<HTMLDetailsElement>;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={`collapsible-section ${className}`}
      open={initiallyOpen}
      ref={detailsRef}
    >
      <summary className="collapsible-summary" aria-controls={`${id}-content`}>
        <span className="collapsible-heading">
          {kicker && <span className="section-kicker">{kicker}</span>}
          <span className="collapsible-title">{title}</span>
        </span>
        {count !== undefined && <span className="count-badge">{count}</span>}
        <span className="collapse-indicator" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="collapsible-content" id={`${id}-content`}>
        {children}
      </div>
    </details>
  );
}
