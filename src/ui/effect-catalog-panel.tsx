import type { EffectId, EffectMenuGroup } from "../features/effects/types";
import type { RegisteredEffect } from "../features/effects/registry";
import { EffectIcon } from "./effect-icon";

export interface EffectCatalogPanelProps {
  readonly groups: readonly EffectMenuGroup[];
  readonly registry: readonly RegisteredEffect[];
  readonly selectedEffectId: EffectId | null;
  readonly hasActiveMask: boolean;
  readonly onSelectEffect: (effectId: EffectId) => void;
}

export function EffectCatalogPanel({
  groups,
  registry,
  selectedEffectId,
  hasActiveMask,
  onSelectEffect,
}: EffectCatalogPanelProps) {
  return (
    <aside className="effects-catalog" aria-label="Effects">
      <header className="effects-catalog-header">
        <h2>Effects</h2>
      </header>
      {groups.map(({ heading, effectIds }) => (
        <section className="effects-category" key={heading}>
          <h3>{heading}</h3>
          <ul>
            {effectIds.map((effectId) => {
              const effect = registry.find(({ view }) => view.id === effectId);
              if (!effect) return null;
              const { view } = effect;
              const isSelected = selectedEffectId === view.id;
              const needsSelection =
                view.interaction === "mask" && !hasActiveMask;

              return (
                <li key={view.id}>
                  <button
                    className={`effect-catalog-item ${isSelected ? "is-selected" : ""} ${needsSelection ? "needs-selection" : ""}`}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectEffect(view.id)}
                  >
                    <EffectIcon
                      className="effect-catalog-icon"
                      paths={view.iconPaths}
                    />
                    <span className="effect-catalog-copy">
                      <span className="effect-catalog-name">{view.label}</span>
                      <span className="effect-catalog-description">
                        {view.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}
