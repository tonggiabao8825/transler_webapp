import { defineConfig } from "@playwright/test";
import developmentConfig from "./playwright.config";

const { webServer, ...sharedConfig } = developmentConfig;
void webServer;

export default defineConfig({
  ...sharedConfig,
  use: { ...sharedConfig.use, baseURL: "http://127.0.0.1:8080" },
});
