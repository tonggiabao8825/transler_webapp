import type { JSX } from "react";
import { useWorkspace } from "./useWorkspace";
import { WorkspaceView } from "./WorkspaceView";

export function App(): JSX.Element {
  const workspace = useWorkspace();
  return <WorkspaceView workspace={workspace} />;
}
