const COMPONENT_MATRICES: Readonly<
  Record<"Y" | "Cb" | "Cr" | "R" | "G" | "B", string>
> = {
  Y: [
    "0.299 0.587 0.114 0 0",
    "0.299 0.587 0.114 0 0",
    "0.299 0.587 0.114 0 0",
    "0 0 0 1 0",
  ].join(" "),
  Cb: [
    "-0.037122 -0.072879 0.11 0 0.59",
    "-0.016874 -0.033126 0.05 0 0.61",
    "0.026998 0.053002 -0.08 0 0.6",
    "0 0 0 1 0",
  ].join(" "),
  Cr: [
    "0.11 -0.092111 -0.017869 0 0.59",
    "-0.08 0.06699 0.01301 0 0.6",
    "-0.025 0.020934 0.004066 0 0.525",
    "0 0 0 1 0",
  ].join(" "),
  R: ["1 0 0 0 0", "0 0 0 0 0", "0 0 0 0 0", "0 0 0 1 0"].join(" "),
  G: ["0 0 0 0 0", "0 1 0 0 0", "0 0 0 0 0", "0 0 0 1 0"].join(" "),
  B: ["0 0 0 0 0", "0 0 0 0 0", "0 0 1 0 0", "0 0 0 1 0"].join(" "),
};

export function ComponentPreview({
  imageUrl,
  component,
}: {
  imageUrl: string | null;
  component: "Y" | "Cb" | "Cr" | "R" | "G" | "B";
}) {
  const filterId = `jpeg-component-${component.toLowerCase()}`;
  if (!imageUrl) return null;

  return (
    <figure className="component-preview">
      <svg className="component-preview-filters" aria-hidden="true">
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={COMPONENT_MATRICES[component]} />
        </filter>
      </svg>
      <img
        src={imageUrl}
        alt={`Approximate ${component} view derived from the current JPEG preview`}
        style={{ filter: `url(#${filterId})` }}
      />
      <figcaption>
        Approximate {component} view from decoded pixels, not JPEG samples
      </figcaption>
    </figure>
  );
}
