import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mkcert from "vite-plugin-mkcert";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true, // This allows your iPhone to connect via IP
    // REMOVE 'https: true' from here
  },
  plugins: [
    react(),
    mkcert(), // This plugin automatically enables HTTPS and handles the certificates
  ],
});
