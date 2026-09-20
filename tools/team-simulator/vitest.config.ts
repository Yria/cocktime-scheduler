import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/team-simulator/*.test.ts'], reporters: ['default'], testTimeout: 60000 } });
