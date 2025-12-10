import { defineConfig } from 'vite';
import { resolve } from 'path';
import { builtinModules } from 'module';

/**
 * Vite configuration for the VS Code extension (Node.js environment)
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/Host/Presentation/Program.ts'),
      fileName: () => 'extension.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      output: {
        exports: 'named',
      },
      external: ['vscode', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
    target: 'node22',
    sourcemap: process.env.NODE_ENV === 'production' ? false : 'inline',
    minify: process.env.NODE_ENV === 'production' ? 'esbuild' : false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
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

  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
