'use strict'

const Module = require('module')
const originalLoad = Module._load

Module._load = function load(request, parent, isMain) {
  const exported = originalLoad(request, parent, isMain)
  if (request !== 'wasm-feature-detect') return exported
  return {
    ...exported,
    simd: async () => true,
    relaxedSimd: async () => false,
  }
}
