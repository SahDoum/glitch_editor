import type { JpegComponent, JpegInspection } from "../jpeg/inspect";
import type { JpegComponentLabel } from "../jpeg/color-model";
import type { ChoiceOption } from "./tool-controls";
import { RadioChoiceGroup } from "./tool-controls";

export function getChannelLabel(
  components: readonly JpegComponent[],
  index: number,
  labels?: readonly JpegComponentLabel[],
): string {
  const label = labels?.[index]?.label;
  if (label === "Blue chroma (Cb)") return "Color (Cb)";
  if (label === "Red chroma (Cr)") return "Color (Cr)";
  return (
    label ?? (components.length === 1 ? "Grayscale" : `Component ${index + 1}`)
  );
}

export function getComponentChoiceOptions(
  components: readonly JpegComponent[],
  componentLabels?: readonly JpegComponentLabel[],
): ChoiceOption<number>[] {
  return components.map((component, index) => {
    const componentHint = `ID ${component.id} · ${component.horizontalSampling}×${component.verticalSampling}`;
    return {
      value: index,
      label: getChannelLabel(components, index, componentLabels),
      hint: componentHint,
      tone: componentLabels?.[index]?.tone,
    };
  });
}

export function ComponentChoiceGroup({
  name,
  inspection,
  value,
  onChange,
  includeUnavailable = false,
  componentLabels,
}: {
  name: string;
  inspection: JpegInspection;
  value: number;
  onChange(value: number): void;
  includeUnavailable?: boolean;
  componentLabels?: readonly JpegComponentLabel[];
}) {
  if (inspection.components.length === 1) {
    const [component] = inspection.components;
    return (
      <p className="coefficient-note">
        Grayscale · ID {component?.id} · {component?.horizontalSampling}×
        {component?.verticalSampling}
      </p>
    );
  }

  const options = getComponentChoiceOptions(
    inspection.components,
    componentLabels,
  );

  if (includeUnavailable && !inspection.components[value]) {
    options.push({
      value,
      label: `Component ${value}`,
      hint: "Unavailable in this JPEG",
      disabled: true,
    });
  }

  return (
    <RadioChoiceGroup
      name={name}
      legend="Channel"
      value={value}
      options={options}
      onChange={onChange}
      layout="components"
    />
  );
}
