import { describe, it, expect } from 'vitest'
import { ENGINE_NAME } from '../src/index.js'

describe('engine smoke', () => {
  it('loads', () => {
    expect(ENGINE_NAME).toBe('book-source-engine')
  })
})
