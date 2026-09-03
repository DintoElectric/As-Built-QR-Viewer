import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pdfjs-dist ships a worker as an ESM file; Vite bundles it via the ?url import
// used in DrawingViewer.jsx, so no extra config is needed here.
export default defineConfig({
  plugins: [react()],
  build: {
    // The 3000px backdrop render and pdf.js keep memory sensible; no special
    // chunking needed, but raise the warning limit so pdf.js doesn't nag.
    chunkSizeWarningLimit: 1200,
  },
});
