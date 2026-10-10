import { TranslerApi } from "../../shared/api/api";
import {
  type Document,
  type EditOperation,
  type Job,
} from "../../shared/api/contracts";
export type EditorProps = {
  api: TranslerApi;
  document: Document | null;
  artifactId: string | null;
  onChoose: () => void;
  onTools: () => void;
  onUpload: (file: File) => Promise<void>;
  onJob: (job: Job) => void;
};
export type Action = EditOperation["type"];
export const actions: readonly Action[] = [
  "replace_text",
  "add_text",
  "delete_text",
  "move_block",
  "resize_block",
  "crop_page",
  "rotate_page",
  "delete_page",
  "reorder_pages",
  "add_annotation",
  "retranslate_region",
];
