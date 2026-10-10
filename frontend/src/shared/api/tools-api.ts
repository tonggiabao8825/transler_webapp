import { request } from "./http";
import {
  toolSettingSchema,
  toolSettingsSchema,
  type ToolId,
  type ToolSetting,
} from "./tool-contracts";
export class ToolsApi {
  async tools(): Promise<ToolSetting[]> {
    return request("/v1/tools", "GET", null, toolSettingsSchema);
  }

  async updateTool(id: ToolId, enabled: boolean): Promise<ToolSetting> {
    return request(
      `/v1/admin/tools/${id}`,
      "PUT",
      { enabled },
      toolSettingSchema,
    );
  }
}
