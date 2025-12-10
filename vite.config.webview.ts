import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Vite configuration for the webview (Browser environment)
 * This configuration enables hot module replacement (HMR) for live reloading during development
 */
export default defineConfig({
  build: {
    // Output directory
    outDir: 'dist',

    // Don't clean dist (extension also outputs here)
    emptyOutDir: false,

    // Library mode for proper bundling
    lib: {
      entry: resolve(__dirname, 'src/Web/Main.ts'),
      fileName: () => 'webview.js',
      formats: ['es'],
    },

    // Rollup-specific options
    rollupOptions: {
      output: {
        // Inline dynamic imports to avoid chunk splitting issues in webview
        inlineDynamicImports: true,
      },
    },

    // Target modern browsers (VS Code webview uses Chromium)
    target: 'es2020',

    // Source maps for debugging
    sourcemap: process.env.NODE_ENV === 'production' ? false : 'inline',

    // Minification - keep class names for message bus routing
    minify: process.env.NODE_ENV === 'production' ? 'esbuild' : false,
  },

  // Esbuild options to preserve class names (critical for message routing)
  esbuild: {
    keepNames: true, // Preserve class names in the bundle
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@Web': resolve(__dirname, 'src/Web'),
      '@Application': resolve(__dirname, 'src/Host/Application'),
      '@Infrastructure': resolve(__dirname, 'src/Host/Infrastructure'),
      '@Domain': resolve(__dirname, 'src/Host/Domain'),
      '@Presentation': resolve(__dirname, 'src/Host/Presentation'),
      '@Shared': resolve(__dirname, 'src/Shared'),
      '@Queries': resolve(__dirname, 'src/Shared/Features/Queries'),
      '@Commands': resolve(__dirname, 'src/Shared/Features/Commands'),
    },
    extensions: ['.ts', '.js', '.json'],
  },

  // Server configuration for HMR (Hot Module Replacement)
  server: {
    hmr: {
      // Use the same port as the old WebSocket server for compatibility
      port: 35729,
      protocol: 'ws',
      host: 'localhost',
    },
    // Port for the Vite dev server
    port: 5173,
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'tsyringe',
      'reflect-metadata',
      '@fluentui/web-components',
      'lit',
    ],
  },

  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
