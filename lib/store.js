/**
 * Durable state for dsh-big-coming: the baseline fingerprint snapshot, the
 * settings the user edits in the Web UI, and a bounded history of detected
 * changes.
 *
 * Only facts that cannot live in the plugin's configuration are stored here.
 * The file lives under `~/.dsh/dsh-big-coming/`, so it survives profile edits
 * and plugin upgrades. Every write goes through one queued `flush()`.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const STATE_DIR = join(homedir(), '.dsh', 'dsh-big-coming')
export const STATE_FILE = join(STATE_DIR, 'state.json')
export const MEME_DIR = STATE_DIR

export const HISTORY_LIMIT = 60

export const MIN_INTERVAL_MINUTES = 1
export const MAX_INTERVAL_MINUTES = 10080

export const MOTION_MODES = ['adaptive', 'full', 'off']

export function defaultSettings() {
  return {
    apiBaseUrl: 'https://api.deepseek.com',
    intervalMinutes: 60,
    autoDetect: true,
    watchModels: [],
    mutedMemeIds: [],
    // Presentation. `full` ignores the OS reduced-motion preference; `adaptive`
    // honours it (fading instead of moving); `off` stays completely still.
    //
    // `full` is the default because the whole point of this plugin is the
    // spectacle: a machine with animations disabled system-wide — which is
    // common on Windows — would otherwise never see the thing it was built for.
    motion: 'full',
    sound: true,
    volume: 0.55,
  }
}

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function normalizeSettings(raw) {
  const base = defaultSettings()
  const input = asObject(raw)

  const parsed = Number(input.intervalMinutes)
  const intervalMinutes = Number.isFinite(parsed)
    ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(parsed)))
    : base.intervalMinutes

  const watchModels = Array.isArray(input.watchModels)
    ? input.watchModels
        .filter((item) => typeof item === 'string' && item.trim() !== '')
        .map((item) => item.trim())
        .slice(0, 8)
    : []

  const mutedMemeIds = Array.isArray(input.mutedMemeIds)
    ? input.mutedMemeIds.filter((item) => typeof item === 'string').slice(0, 16)
    : []

  const volumeRaw = Number(input.volume)
  const volume = Number.isFinite(volumeRaw) ? Math.min(1, Math.max(0, volumeRaw)) : base.volume

  return {
    apiBaseUrl: typeof input.apiBaseUrl === 'string' && input.apiBaseUrl.trim() !== ''
      ? input.apiBaseUrl.trim()
      : base.apiBaseUrl,
    intervalMinutes,
    autoDetect: input.autoDetect === undefined ? base.autoDetect : input.autoDetect !== false,
    watchModels,
    mutedMemeIds,
    motion: MOTION_MODES.includes(input.motion) ? input.motion : base.motion,
    sound: input.sound === undefined ? base.sound : input.sound !== false,
    volume,
  }
}

export function defaultState() {
  return {
    version: 1,
    settings: defaultSettings(),
    baseline: null,
    history: [],
    stats: {
      checks: 0,
      changes: 0,
      failures: 0,
      lastCheckAt: null,
      lastChangeAt: null,
      lastError: null,
      lastHeadline: null,
    },
  }
}

export function normalizeState(raw) {
  const base = defaultState()
  const input = asObject(raw)
  return {
    version: 1,
    settings: normalizeSettings(input.settings),
    baseline: asObject(input.baseline).at === undefined ? null : input.baseline,
    history: Array.isArray(input.history)
      ? input.history.filter((item) => asObject(item).id !== undefined).slice(0, HISTORY_LIMIT)
      : base.history,
    stats: { ...base.stats, ...asObject(input.stats) },
  }
}

function shortHash(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export class StateStore {
  #state = defaultState()
  #queue = Promise.resolve()
  #loaded = false

  get state() {
    return this.#state
  }

  async load() {
    if (this.#loaded) return this.#state
    this.#loaded = true
    try {
      const text = await readFile(STATE_FILE, 'utf8')
      this.#state = normalizeState(JSON.parse(text))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('[dsh-big-coming] 读取状态失败，改用默认值：', error)
      }
    }
    return this.#state
  }

  update(mutate) {
    const draft = mutate(this.#state)
    this.#state = normalizeState(draft === undefined ? this.#state : draft)
    return this.flush()
  }

  /** Serialized durable write; resolves once the file replacement is done. */
  flush() {
    const snapshot = JSON.stringify(this.#state, null, 2)
    this.#queue = this.#queue
      .then(async () => {
        await mkdir(dirname(STATE_FILE), { recursive: true })
        const tmp = `${STATE_FILE}.${process.pid}.tmp`
        await writeFile(tmp, snapshot, 'utf8')
        await rename(tmp, STATE_FILE)
      })
      .catch((error) => {
        console.error('[dsh-big-coming] 写入状态失败：', error)
      })
    return this.#queue
  }

  /** Appends one change event and returns it with a stable id. */
  async pushEvent(event) {
    const id = `${Date.now().toString(36)}-${shortHash(JSON.stringify(event))}`
    const entry = { ...event, id, at: event.at ?? new Date().toISOString() }
    await this.update((state) => ({
      ...state,
      history: [entry, ...state.history].slice(0, HISTORY_LIMIT),
    }))
    return entry
  }
}
