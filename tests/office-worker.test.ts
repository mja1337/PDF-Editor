import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertOffice, stopOfficeConversion } from '../src/office/conversion'

class StalledWorker extends EventTarget {
  static last: StalledWorker
  terminated = false
  constructor() {
    super()
    StalledWorker.last = this
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'loaded' } })))
  }
  postMessage(message: { type: string; id: number }) {
    if (message.type === 'init') {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready', id: message.id } })))
    } else if (message.type === 'convert') {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
        data: { type: 'progress', id: message.id, progress: { percent: 30, message: 'Loading document...' } },
      })))
    }
  }
  terminate() { this.terminated = true }
}

afterEach(() => {
  stopOfficeConversion()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function setup() {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', StalledWorker)
  vi.stubGlobal('crossOriginIsolated', true)
  vi.stubGlobal('location', { origin: 'http://localhost' })
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const controller = new AbortController()
  const progress = vi.fn()
  const promise = convertOffice(new File(['fixture'], 'slides.pptx'), { name: 'slides.pdf', quality: 90, pages: '' }, controller.signal, progress)
  return { controller, progress, promise }
}

describe('a stalled Office import', () => {
  it('reports the import stage, then terminates the worker with a useful timeout error', async () => {
    const { progress, promise } = setup()
    const failure = expect(promise).rejects.toThrow('while loading the document pages / slides')
    await vi.advanceTimersByTimeAsync(1)
    expect(progress).toHaveBeenLastCalledWith('Loading document pages / slides…')
    await vi.advanceTimersByTimeAsync(180000)
    await failure
    expect(StalledWorker.last.terminated).toBe(true)
  })

  it('can be cancelled immediately while the engine is stuck importing slides', async () => {
    const { controller, promise } = setup()
    const failure = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await failure
    expect(StalledWorker.last.terminated).toBe(true)
  })
})
