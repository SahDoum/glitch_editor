import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const { VITE_GTM_CONTAINER_ID } = loadEnv(mode, process.cwd(), "VITE_");
  if (VITE_GTM_CONTAINER_ID && !/^GTM-[A-Z0-9]+$/.test(VITE_GTM_CONTAINER_ID)) {
    throw new Error(
      "VITE_GTM_CONTAINER_ID must be a container ID such as GTM-XXXXXXX.",
    );
  }
  return {
    plugins: [react()],
    test: {
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
      pool: "threads",
      maxWorkers: 1,
      fileParallelism: false,
    },
  };
});
