import React from "react";
import ReactDOM from "react-dom/client";
import { LanguageProvider } from "./i18n";
import { ToolAvailability } from "./ToolAvailability";
import { App } from "./App";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Transler application root is missing.");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <LanguageProvider>
      <ToolAvailability>
        <App />
      </ToolAvailability>
    </LanguageProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js").catch((error: Error) =>
    console.error("Transler desktop integration registration failed", {
      error: error.message,
    }),
  );
}
