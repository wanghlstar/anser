import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
  // CI 机器比本地慢很多，分页/导航/窗口用例需要更宽裕的超时（默认 5s 会误报超时）。
  test: { testTimeout: 120000, hookTimeout: 120000 },
});
