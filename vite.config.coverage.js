import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config.js';
import istanbul from 'vite-plugin-istanbul';

export default mergeConfig(baseConfig, defineConfig({
  plugins: [
    istanbul({
      include: 'src/*',
      exclude: ['node_modules'],
      extension: ['.js'],
    }),
  ],
}));
