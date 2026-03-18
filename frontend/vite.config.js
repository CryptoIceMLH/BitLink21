import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env variables based on mode
  // This automatically loads .env, .env.local, and .env.[mode] files

  const backendPort = process.env.GS_BACKEND_PORT || '5000';
  const backendHost = process.env.GS_BACKEND_HOST || 'localhost';

  return {
    plugins: [react()],

    // Define custom environment variables
    define: {
      // Allow using GS_BACKEND_PORT directly without VITE_ prefix
      'import.meta.env.GS_BACKEND_PORT': JSON.stringify(process.env.GS_BACKEND_PORT || '5000'),
      'import.meta.env.GS_BACKEND_HOST': JSON.stringify(process.env.GS_BACKEND_HOST || 'localhost'),
    },

    // Explicitly set the public directory
    publicDir: 'public',

    // Server configuration for development
    server: {
      port: 5173,
      strictPort: true,
      host: true, // Listen on all addresses

      // Add proxy configuration
      proxy: {
        '/satimages': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/recordings': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/snapshots': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/decoded': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/audio': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/transcriptions': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/api': {  // For regular HTTP API requests
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/socket.io/': {  // For regular HTTP API requests
          target: `http://${backendHost}:${backendPort}`,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: `http://${backendHost}:5000`,
          ws: true,
          changeOrigin: true,
          secure: false,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        },
      },
    },

    // Build configuration
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode !== 'production', // Generate sourcemaps except in production

      // Optimize chunks
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            // Add more manual chunks as needed
          },
        },
      },
    },

    // Resolve configuration
    resolve: {
      alias: {
        '@': '/src', // Allow using @ as an alias for /src directory
      },
    },
  };
});