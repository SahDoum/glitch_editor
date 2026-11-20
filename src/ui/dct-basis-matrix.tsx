import type { DctFrequencyBand } from "../operations/dct";

export type DctFrequencyChoice = "dc" | DctFrequencyBand;

export function getDctFrequencyChoice(
  u: number,
  v: number,
): DctFrequencyChoice {
  if (u === 0 && v === 0) return "dc";
  const sum = u + v;
  if (sum <= 2) return "low";
  if (sum <= 5) return "mid";
  return "high";
}

export function DctBasisMatrix({
  selectedChoice,
  availableChoices,
  onSelect,
}: {
  selectedChoice: DctFrequencyChoice | null;
  availableChoices: readonly DctFrequencyChoice[];
  onSelect(choice: DctFrequencyChoice): void;
}) {
  const targetLabel =
    selectedChoice === "dc"
      ? "DC"
      : selectedChoice
        ? `AC ${selectedChoice}`
        : "No frequency target";

  return (
    <section className="dct-basis-panel" aria-label="DCT frequency selector">
      <div className="dct-basis-heading">
        <div>
          <h3>8×8 DCT basis</h3>
          <p>Click a cell to select its DC / AC frequency zone.</p>
        </div>
        <span className="dct-target-label" aria-live="polite">
          {targetLabel}
        </span>
      </div>
      <div
        className="dct-frequency-grid"
        role="grid"
        aria-label="DCT frequency bands"
      >
        {Array.from({ length: 64 }, (_, index) => {
          const u = index % 8;
          const v = Math.floor(index / 8);
          const choice = getDctFrequencyChoice(u, v);
          const isAvailable = availableChoices.includes(choice);
          const isSelected =
            selectedChoice === choice ||
            (selectedChoice === "all" && choice !== "dc");
          return (
            <button
              className={[
                "dct-frequency-cell",
                isAvailable ? "is-available" : "is-inactive",
                isSelected ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${u}-${v}`}
              type="button"
              role="gridcell"
              aria-label={`u ${u}, v ${v}, ${choice === "dc" ? "DC" : `AC ${choice}`}`}
              aria-pressed={isSelected}
              disabled={!isAvailable}
              onClick={() => onSelect(choice)}
            />
          );
        })}
      </div>
      <p className="coefficient-note">
        DC is (0, 0). AC low: u+v 1–2 · mid: 3–5 · high: 6–14.
      </p>
    </section>
  );
}
