import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/server/vault-*.test.ts'],
    environment: 'node',
  },
})
