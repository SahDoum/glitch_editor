import { useState } from "react";
import type { EffectId, EffectMenuGroup } from "../features/effects/types";
import type { RegisteredEffect } from "../features/effects/registry";
import { EffectIcon } from "./effect-icon";
import { examplePhotoUrl } from "./example-photo";

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
  const [showAll, setShowAll] = useState(false);

  return (
    <aside className="effects-catalog" aria-label="Effects">
      <header className="effects-catalog-header">
        <h2>Effects</h2>
        <button
          className="tool-toggle toggle-effects"
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((visible) => !visible)}
        >
          All effects
        </button>
      </header>
      {groups.map(({ heading, effectIds }, groupIndex) => {
        const quick = groupIndex === 0;
        if (
          !quick &&
          !showAll &&
          !(selectedEffectId && effectIds.includes(selectedEffectId))
        )
          return null;
        return (
          <section
            className={`effects-category ${quick ? "quick-effects" : ""}`}
            key={heading}
          >
            {!quick && <h3>{heading}</h3>}
            <ul>
              {effectIds.map((effectId) => {
                const effect = registry.find(
                  ({ view }) => view.id === effectId,
                );
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
                      data-effect-id={view.id}
                      aria-pressed={isSelected}
                      onClick={() => onSelectEffect(view.id)}
                    >
                      {quick ? (
                        <img
                          className="effect-catalog-thumbnail"
                          src={examplePhotoUrl(view.id)}
                          alt=""
                          width="92"
                          height="64"
                        />
                      ) : (
                        <EffectIcon
                          className="effect-catalog-icon"
                          paths={view.iconPaths}
                        />
                      )}
                      <span className="effect-catalog-copy">
                        <span className="effect-catalog-name">
                          {view.label}
                        </span>
                        {!quick && (
                          <span className="effect-catalog-description">
                            {view.description}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
