import type { JpegComponent, JpegInspection } from "../jpeg/inspect";
import type { JpegComponentLabel } from "../jpeg/color-model";
import type { ChoiceOption } from "./tool-controls";
import { RadioChoiceGroup } from "./tool-controls";

export function getComponentChoiceOptions(
  components: readonly JpegComponent[],
  componentLabels?: readonly JpegComponentLabel[],
): ChoiceOption<number>[] {
  return components.map((component, index) => {
    const componentHint = `ID ${component.id} · ${component.horizontalSampling}×${component.verticalSampling}`;
    return {
      value: index,
      label:
        componentLabels?.[index]?.label ??
        (components.length === 1 ? "Gray" : `Component ${index + 1}`),
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
      legend="JPEG component"
      value={value}
      options={options}
      onChange={onChange}
      layout="components"
    />
  );
}
