import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 相对资源路径配合 hash 导航，可直接由 Python 静态服务器托管在任意子目录。
export default defineConfig({
  plugins: [react()],
  base: "./",
});
