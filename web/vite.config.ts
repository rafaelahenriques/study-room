import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Every `import 'three'` (including inside three/addons) resolves to the WebGPU build,
    // so there is a single copy of three.js in the bundle.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173 },
});
