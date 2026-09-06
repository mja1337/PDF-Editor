export function rewriteTesseractWorkerSource(source: string) {
  return source
    .replaceAll(
      'tesseract-core-relaxedsimd-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm.js',
    )
    .replaceAll('tesseract-core-relaxedsimd.wasm.js', 'tesseract-core-simd.wasm.js')
}
