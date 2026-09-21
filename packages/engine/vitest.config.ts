import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // e2e-real 依赖外部书源服务可用性，手动运行：npx vitest run tests/e2e-real.test.ts
    exclude: ['tests/e2e-real.test.ts', '**/node_modules/**']
  }
})
