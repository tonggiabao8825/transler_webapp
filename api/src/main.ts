import { readConfig } from "./config.js";
import { createApp } from "./server.js";
const config = readConfig();
const app = await createApp(config);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ port: config.TRANSLER_API_PORT, host: "0.0.0.0" });
