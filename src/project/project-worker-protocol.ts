import type { Result } from "../shared/result";
import type { JgeProjectData } from "./project-file";

export interface ProjectReadWorkerRequest {
  readonly file: File;
}
export type ProjectReadWorkerResponse =
  | { readonly type: "progress"; readonly progress: string }
  | { readonly type: "result"; readonly result: Result<JgeProjectData> };
