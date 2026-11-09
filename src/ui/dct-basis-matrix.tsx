import {
  DCT_FREQUENCY_BAND_RANGES,
  type DctFrequencyBand,
} from "../operations/dct";

export type DctMatrixTarget =
  | { readonly kind: "dc" }
  | { readonly kind: "band"; readonly band: DctFrequencyBand }
  | { readonly kind: "low-pass"; readonly cutoff: number }
  | { readonly kind: "ringing" }
  | {
      readonly kind: "engraving";
      readonly direction: "horizontal" | "vertical";
    }
  | null;

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

export function isDctCoefficientTargeted(
  u: number,
  v: number,
  target: DctMatrixTarget,
): boolean {
  if (!target) return false;
  if (target.kind === "dc") return u === 0 && v === 0;
  if (target.kind === "band") {
    const { minimum, maximum } = DCT_FREQUENCY_BAND_RANGES[target.band];
    return u + v >= minimum && u + v <= maximum;
  }
  if (target.kind === "low-pass") return u + v > target.cutoff;
  if (target.kind === "ringing") return u + v >= 3;
  if (target.kind === "engraving") {
    return target.direction === "horizontal" ? v > 0 : u > 0;
  }
  return false;
}

export function DctBasisMatrix({
  target,
  selectedChoice,
  availableChoices,
  onSelect,
}: {
  target: DctMatrixTarget;
  selectedChoice: DctFrequencyChoice | null;
  availableChoices: readonly DctFrequencyChoice[];
  onSelect?(choice: DctFrequencyChoice): void;
}) {
  const interactive = onSelect !== undefined;
  const targetLabel =
    target?.kind === "band"
      ? `AC ${target.band}`
      : target?.kind === "dc"
        ? "DC"
        : target?.kind === "low-pass"
          ? `AC cutoff ${target.cutoff}`
          : target?.kind === "ringing"
            ? "Ringing"
            : target?.kind === "engraving"
              ? `Engraving · ${target.direction}`
              : "No frequency target";

  return (
    <section className="dct-basis-panel" aria-label="DCT frequency selector">
      <div className="dct-basis-heading">
        <div>
          <h3>8×8 DCT basis</h3>
          <p>
            {interactive
              ? "Click a cell to select its DC / AC frequency zone."
              : "The highlighted cells show the operation's frequency target."}
          </p>
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
          const isTargeted = isDctCoefficientTargeted(u, v, target);
          return (
            <button
              className={[
                "dct-frequency-cell",
                isAvailable ? "is-available" : "is-inactive",
                isSelected ? "is-selected" : "",
                !interactive && isTargeted ? "is-targeted" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${u}-${v}`}
              type="button"
              role="gridcell"
              aria-label={`u ${u}, v ${v}, ${choice === "dc" ? "DC" : `AC ${choice}`}`}
              aria-pressed={interactive ? isSelected : undefined}
              disabled={!isAvailable || !interactive}
              onClick={() => onSelect?.(choice)}
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
