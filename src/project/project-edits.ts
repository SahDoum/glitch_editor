import type { JgeProjectSaveData } from "./project-file";

type ProjectEdits = Pick<
  JgeProjectSaveData,
  "operations" | "draftMask" | "scanCorruptionStages"
>;

export function projectEditsKey({
  operations,
  draftMask,
  scanCorruptionStages,
}: ProjectEdits): string {
  const area = draftMask && {
    width: draftMask.width,
    height: draftMask.height,
    shapes: draftMask.shapes,
  };
  return JSON.stringify({ operations, area, scanCorruptionStages });
}
