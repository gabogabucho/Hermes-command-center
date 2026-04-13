import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fleetApiPlugin } from './server/probe/fleetApiPlugin.mjs';

export default defineConfig({
  plugins: [react(), fleetApiPlugin()],
});
