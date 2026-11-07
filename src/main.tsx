import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startAnalytics } from "./analytics";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element was not found.");
}

startAnalytics(import.meta.env.VITE_GTM_CONTAINER_ID);

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
