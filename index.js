/**
 * dsh-big-coming — Host half.
 *
 * Sends the cheapest possible request to the official DeepSeek API on a timer
 * and remembers the "system fingerprint" of the answer. When the fingerprint,
 * the response envelope, or the model catalog moves, it records an event and
 * the browser half pops a meme.
 *
 * Everything that touches the network, the disk, or a credential happens here;
 * the Web UI is a thin view over `/dsh-big-coming/api`.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { json, readJsonBody, ROUTE } from './lib/http.js'
import {
  baseUrlOf,
  diffCycle,
  fetchCatalog,
  headlineOf,
  MAX_MODELS_PER_CYCLE,
  probeModel,
} from './lib/probe.js'
import {
  defaultSettings,
  normalizeSettings,
  StateStore,
  STATE_DIR,
  STATE_FILE,
} from './lib/store.js'

const BUNDLED_MEME_DIR = fileURLToPath(new URL('./memes/', import.meta.url))
const SOUND_FILE = fileURLToPath(new URL('./sounds/nuke.mp3', import.meta.url))
const KEY_FILE = join(STATE_DIR, 'api-key.txt')

const CREDENTIAL_KEY = 'dsh-big-coming/api-key'
const MEME_FILES = ['1.jpg', '2.jpg', '3.jpg', '4.jpg']

export const name = 'dsh-big-coming'
/** The probe needs an HTTP seat; without it the plugin stays inactive. */
export const inject = ['webServer']

function maskKey(value) {
  if (typeof value !== 'string' || value === '') return null
  if (value.length <= 10) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 5)}...${value.slice(-4)}`
}

export function apply(ctx, rowConfig = {}) {
  const store = new StateStore()
  const credentials = () => ctx.get('credentials')
  const connection = () => ctx.get('connection')

  let paused = false
  let running = false
  let timer = null
  let disposed = false

  function seedSettings() {
    return normalizeSettings(defaultSettings())
  }

  function currentSettings() {
    return normalizeSettings(store.state.settings ?? seedSettings())
  }

  function isLoopback(request) {
    const address = request.socket && request.socket.remoteAddress ? request.socket.remoteAddress : ''
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }

  /**
   * Two fences, both cheap:
   *
   * 1. A browser that sends `Origin` must be the same origin. That is the
   *    rebinding defence — `Host` (and therefore a forged `Origin`) is the one
   *    header a hostile page cannot set for its own requests, so a page on
   *    another origin cannot drive this route at all.
   * 2. A request from off the machine then has to pass the host's own request
   *    gate, and a host without one gets nothing.
   *
   * Loopback is otherwise admitted, which is what lets the page `dsh web`
   * serves talk to the plugin without an extra login hop.
   */
  function rejectionFor(request) {
    const origin = request.headers ? request.headers.origin : undefined
    if (typeof origin === 'string' && origin !== '') {
      const host = request.headers.host
      let originHost = ''
      try {
        originHost = new URL(origin).host
      } catch {
        return 403
      }
      if (typeof host !== 'string' || originHost !== host) return 403
    }

    if (isLoopback(request)) return undefined

    const link = connection()
    const reject = link && typeof link.requestRejection === 'function' ? link.requestRejection : undefined
    if (typeof reject !== 'function') return 403
    try {
      const status = reject.call(link, request)
      return typeof status === 'number' ? status : 403
    } catch {
      return 403
    }
  }

  async function readKey() {
    const vault = credentials()
    if (vault !== undefined) {
      try {
        const record = await vault.readRecord(CREDENTIAL_KEY)
        if (record !== null && typeof record === 'object' && typeof record.key === 'string' && record.key.trim() !== '') {
          return { value: record.key.trim(), source: 'credentials' }
        }
      } catch (error) {
        console.error('[dsh-big-coming] 读取凭据记录失败：', error)
      }
    }
    try {
      const text = (await readFile(KEY_FILE, 'utf8')).trim()
      if (text !== '') return { value: text, source: 'file' }
    } catch {
      /* no fallback file yet */
    }
    return null
  }

  async function writeKey(value) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('Key 不能为空')
    const trimmed = value.trim()
    // The private file keeps the probe alive in a profile that loads no
    // credential store; the record is the primary home when one exists.
    await mkdir(STATE_DIR, { recursive: true })
    await writeFile(KEY_FILE, trimmed, { encoding: 'utf8', mode: 0o600 })
    const vault = credentials()
    if (vault !== undefined) {
      await vault.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: trimmed }))
      return 'credentials'
    }
    return 'file'
  }

  async function clearKey() {
    const vault = credentials()
    if (vault !== undefined) await vault.deleteRecord(CREDENTIAL_KEY).catch(() => undefined)
    await writeFile(KEY_FILE, '', 'utf8').catch(() => undefined)
  }

  /** One probe cycle: catalog + one minimal completion per watched model. */
  /**
   * Copies the tokenizer fields from a fresh cycle into a baseline that predates
   * them. Returns true when the baseline was actually touched.
   */
  function backfillProbeFields(baseline, cycle) {
    let touched = false
    for (const [id, probe] of Object.entries(cycle?.probes ?? {})) {
      const stored = baseline?.probes?.[id]
      if (stored === undefined || !probe.ok) continue
      if (stored.probeText === undefined && probe.probeText !== undefined) {
        stored.probeText = probe.probeText
        stored.promptTokens = probe.promptTokens
        touched = true
      }
    }
    return touched
  }

  async function runCycle() {
    if (running) return { ok: false, busy: true, error: '正在探测中，请稍候' }
    running = true
    const startedAt = new Date().toISOString()
    try {
      await store.load()
      const settings = currentSettings()
      const keyHit = await readKey()

      if (keyHit === null) {
        await store.update((state) => ({
          ...state,
          stats: { ...state.stats, lastCheckAt: startedAt, lastError: '还没有填写 API Key' },
        }))
        return { ok: false, needsKey: true, error: '还没有填写 API Key' }
      }

      const baseUrl = baseUrlOf({ apiBaseUrl: settings.apiBaseUrl })
      const catalog = await fetchCatalog({ baseUrl, key: keyHit.value })

      if (!catalog.ok) {
        await store.update((state) => ({
          ...state,
          stats: {
            ...state.stats,
            failures: state.stats.failures + 1,
            lastCheckAt: startedAt,
            lastError: `目录请求失败：${catalog.error}`,
          },
        }))
        return { ok: false, error: `目录请求失败：${catalog.error}` }
      }

      const explicit = settings.watchModels.filter((id) => catalog.models[id] !== undefined)
      const targets = (explicit.length > 0 ? explicit : catalog.ids).slice(0, MAX_MODELS_PER_CYCLE)
      const probes = {}
      for (const id of targets) {
        probes[id] = await probeModel({ baseUrl, key: keyHit.value, model: id })
      }

      const cycle = { at: startedAt, models: catalog.models, ids: catalog.ids, probes }
      const baseline = store.state.baseline

      if (baseline === null || baseline.models === undefined) {
        await store.update((state) => ({
          ...state,
          baseline: cycle,
          stats: {
            ...state.stats,
            checks: state.stats.checks + 1,
            lastCheckAt: startedAt,
            lastError: null,
            lastHeadline: '基线已建立',
          },
        }))
        return { ok: true, action: 'baseline', cycle }
      }

      // A baseline written before the tokenizer fingerprint existed carries no
      // `promptTokens` / `probeText`, and the baseline only advances when
      // something changes — so without this it would never learn them and the
      // check would stay dormant forever. Fill them in quietly once; it is an
      // upgrade, not a change.
      if (backfillProbeFields(baseline, cycle)) {
        await store.update((state) => ({ ...state, baseline }))
      }

      const details = diffCycle(baseline, cycle)
      if (details.length === 0) {
        await store.update((state) => ({
          ...state,
          stats: { ...state.stats, checks: state.stats.checks + 1, lastCheckAt: startedAt, lastError: null },
        }))
        return { ok: true, action: 'unchanged', cycle }
      }

      const headline = headlineOf(details)
      const muted = settings.mutedMemeIds
      const pool = MEME_FILES.filter((file) => !muted.includes(file))
      const list = pool.length > 0 ? pool : MEME_FILES
      const meme = list[Math.floor(Math.random() * list.length)]

      const event = await store.pushEvent({
        at: startedAt,
        headline,
        details: details.slice(0, 40),
        meme,
        baselineAt: baseline.at ?? null,
        models: cycle.ids,
      })

      // The baseline advances with the event: one change, one popup.
      await store.update((state) => ({
        ...state,
        baseline: cycle,
        stats: {
          ...state.stats,
          checks: state.stats.checks + 1,
          changes: state.stats.changes + 1,
          lastCheckAt: startedAt,
          lastChangeAt: startedAt,
          lastHeadline: headline,
          lastError: null,
        },
      }))

      return { ok: true, action: 'changed', cycle, details, event }
    } catch (error) {
      const message = String(error?.message ?? error)
      await store
        .update((state) => ({
          ...state,
          stats: {
            ...state.stats,
            failures: state.stats.failures + 1,
            lastCheckAt: startedAt,
            lastError: message,
          },
        }))
        .catch(() => undefined)
      return { ok: false, error: message }
    } finally {
      running = false
    }
  }

  /**
   * One self-rescheduling timer instead of an interval, so a cycle changes the
   * interval without either a restart or a second overlapping chain.
   */
  function schedule(delayMs) {
    if (disposed) return
    const settings = currentSettings()
    const wait = typeof delayMs === 'number'
      ? delayMs
      : Math.max(60_000, settings.intervalMinutes * 60_000)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(async () => {
      timer = null
      if (!disposed && !paused && currentSettings().autoDetect) {
        try {
          await runCycle()
        } catch (error) {
          console.error('[dsh-big-coming] 定时探测失败：', error)
        }
      }
      schedule()
    }, wait)
    if (typeof timer.unref === 'function') timer.unref()
  }

  /**
   * Per-cycle token cost.
   *
   * `GET /models` is free. Each watched model costs one tiny completion: with
   * thinking disabled the prompt settles at ~5 tokens and the reply is capped
   * at 1. When the last cycle recorded real `usage`, that is preferred — the
   * figure shown is then what the account was actually billed, not a guess.
   */
  function costEstimate(state) {
    const settings = currentSettings()
    const baseline = state.baseline
    const watched = settings.watchModels.length > 0
      ? settings.watchModels
      : Object.keys(baseline?.models ?? {})

    let measured = 0
    let measuredModels = 0
    for (const id of watched) {
      const usage = baseline?.probes?.[id]?.usage
      if (usage && typeof usage.total_tokens === 'number') {
        measured += usage.total_tokens
        measuredModels += 1
      }
    }

    const PER_MODEL_FALLBACK = 6
    const modelCount = Math.max(1, watched.length)
    const exact = measuredModels === modelCount && measuredModels > 0
    const perCycle = exact ? measured : modelCount * PER_MODEL_FALLBACK
    const intervalMinutes = Math.max(1, settings.intervalMinutes)
    const perDay = Math.round((perCycle * 1440) / intervalMinutes)
    return {
      perCycle,
      perDay,
      perMonth: perDay * 30,
      models: modelCount,
      measured: exact,
      intervalMinutes,
    }
  }

  async function snapshot() {
    await store.load()
    const state = store.state
    const keyHit = await readKey()
    return {
      settings: currentSettings(),
      paused,
      running,
      key: {
        configured: keyHit !== null,
        hint: maskKey(keyHit?.value ?? null),
        source: keyHit?.source ?? null,
        store: credentials() === undefined ? 'file' : 'credentials',
      },
      baselineAt: state.baseline?.at ?? null,
      baselineModels: Object.keys(state.baseline?.models ?? {}),
      baselineFingerprints: Object.fromEntries(
        Object.entries(state.baseline?.probes ?? {}).map(([id, probe]) => [id, probe?.fingerprint ?? null]),
      ),
      history: state.history,
      stats: state.stats,
      // What one cycle will cost, so the settings page can state a number
      // instead of a vague "a few tokens". Measured from the last cycle when
      // one exists; otherwise the fixed request shape (a ~5-token prompt plus
      // one completion token per model) is used.
      cost: costEstimate(state),
      memes: MEME_FILES,
      stateFile: STATE_FILE,
      cadenceMs: Math.max(60_000, currentSettings().intervalMinutes * 60_000),
    }
  }

  /**
   * The "big one" blast. CC0 (public domain) from the Internet Archive's
   * USC/Sunset Editorial sound-effects library, trimmed to ~3.4s and
   * sub-bass boosted so it lands in the chest rather than the ears.
   */
  async function serveSound(res) {
    try {
      const bytes = await readFile(SOUND_FILE)
      res.writeHead(200, {
        'content-type': 'audio/mpeg',
        'cache-control': 'public, max-age=86400',
        'content-length': bytes.length,
      })
      res.end(bytes)
    } catch {
      json(res, 404, { ok: false, error: '音效文件缺失' })
    }
  }

  async function serveMeme(res, url) {
    const id = url.searchParams.get('id') ?? ''
    const file = MEME_FILES.includes(id) ? id : MEME_FILES[0]
    try {
      const bytes = await readFile(join(BUNDLED_MEME_DIR, file))
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=86400',
        'content-length': bytes.length,
      })
      res.end(bytes)
    } catch {
      json(res, 404, { ok: false, error: `表情包 ${file} 不存在` })
    }
  }

  async function handleGet(url, res) {
    const action = url.searchParams.get('action') ?? 'state'

    if (action === 'meme') return serveMeme(res, url)
    if (action === 'sound') return serveSound(res)
    if (action === 'state' || action === 'status') return json(res, 200, { ok: true, ...(await snapshot()) })

    if (action === 'poll') {
      await store.load()
      const history = store.state.history
      const latestId = history[0]?.id ?? null
      const since = url.searchParams.get('since') ?? ''
      let latest = null
      if (latestId !== null && latestId !== since) {
        if (since === '') {
          // First poll of a page: report the newest event, so a change that
          // landed while the page was closed still pops once.
          latest = history[0]
        } else {
          // `since` is a cursor into the history. When it is not found the
          // caller holds an id this history never had — a preview event, or a
          // record that fell off the end. Answering with the newest entry would
          // replay an old change as if it had just happened, so stay quiet.
          const index = history.findIndex((item) => item.id === since)
          latest = index > 0 ? history[index - 1] ?? null : null
        }
      }
      return json(res, 200, {
        ok: true,
        latest,
        latestId,
        running,
        paused,
        // Presentation settings ride along so the overlay can decide whether to
        // animate and make noise before the popup has anything to show.
        settings: currentSettings(),
        stats: store.state.stats,
      })
    }

    if (action === 'history') {
      await store.load()
      return json(res, 200, { ok: true, history: store.state.history })
    }

    return json(res, 400, { ok: false, error: `未知的 action：${action}` })
  }

  async function handlePost(body, res) {
    const action = typeof body.action === 'string' ? body.action : ''
    await store.load()

    if (action === 'saveKey') {
      try {
        const source = await writeKey(body.key)
        return json(res, 200, { ok: true, source, state: await snapshot() })
      } catch (error) {
        return json(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    }

    if (action === 'clearKey') {
      await clearKey()
      return json(res, 200, { ok: true, state: await snapshot() })
    }

    if (action === 'saveSettings') {
      const patch = body.settings !== null && typeof body.settings === 'object' ? body.settings : {}
      const next = normalizeSettings({ ...currentSettings(), ...patch })
      await store.update((state) => ({ ...state, settings: next }))
      schedule()
      return json(res, 200, { ok: true, settings: next, state: await snapshot() })
    }

    if (action === 'probeNow') {
      const result = await runCycle()
      return json(res, 200, { ok: result.ok !== false, ...result, state: await snapshot() })
    }

    if (action === 'rebaseline') {
      const settings = currentSettings()
      const keyHit = await readKey()
      if (keyHit === null) return json(res, 400, { ok: false, error: '还没有填写 API Key' })
      const baseUrl = baseUrlOf({ apiBaseUrl: settings.apiBaseUrl })
      const catalog = await fetchCatalog({ baseUrl, key: keyHit.value })
      if (!catalog.ok) return json(res, 400, { ok: false, error: `目录请求失败：${catalog.error}` })
      const explicit = settings.watchModels.filter((id) => catalog.models[id] !== undefined)
      const targets = (explicit.length > 0 ? explicit : catalog.ids).slice(0, MAX_MODELS_PER_CYCLE)
      const probes = {}
      for (const id of targets) probes[id] = await probeModel({ baseUrl, key: keyHit.value, model: id })
      const cycle = { at: new Date().toISOString(), models: catalog.models, ids: catalog.ids, probes }
      await store.update((state) => ({
        ...state,
        baseline: cycle,
        stats: { ...state.stats, lastCheckAt: cycle.at, lastError: null, lastHeadline: '基线已重新校准' },
      }))
      return json(res, 200, { ok: true, state: await snapshot() })
    }

    if (action === 'demo') {
      // A synthetic event for the "show me what it looks like" button: it never
      // touches the baseline, the history, or the counters.
      const details = [
        { kind: 'fingerprint', label: 'deepseek-flash · system_fingerprint', from: 'bc19ba97cbe016479903222bb1578db6', to: '7f31c0d5e8a24b6fa1d9c3e50b7a4421' },
        { kind: 'catalog', label: 'deepseek-v4-pro · context_window', from: '1048576', to: '2097152' },
        { kind: 'model-added', label: '模型 deepseek-v5', from: '不存在', to: 'DeepSeek-V5（新增）' },
      ]
      const meme = MEME_FILES[Math.floor(Math.random() * MEME_FILES.length)]
      return json(res, 200, {
        ok: true,
        demo: true,
        event: {
          id: `demo-${Date.now().toString(36)}`,
          at: new Date().toISOString(),
          headline: '官方动了点东西（样例）',
          details,
          meme,
          demo: true,
        },
      })
    }

    if (action === 'setPaused') {
      paused = body.paused === true
      schedule()
      return json(res, 200, { ok: true, paused, state: await snapshot() })
    }

    return json(res, 400, { ok: false, error: `未知的 action：${action}` })
  }

  async function handleRoute(req, res) {
    const rejection = rejectionFor(req)
    if (rejection !== undefined) {
      json(res, rejection, { ok: false, error: '请求未被宿主放行' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET') return handleGet(url, res)
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只支持 GET / POST' })
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
    return handlePost(body, res)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => handleRoute(req, res).catch((error) => {
      console.error('[dsh-big-coming] 路由处理失败：', error)
      if (!res.headersSent) json(res, 500, { ok: false, error: String(error?.message ?? error) })
      else res.end()
    }),
  }), 'dsh-big-coming: route')

  ctx.effect(() => {
    void (async () => {
      try {
        const existed = await stat(STATE_FILE).then(() => true).catch(() => false)
        await store.load()
        if (!existed) {
          // A fresh install: the row config (if any) seeds the durable settings.
          const seeded = normalizeSettings({ ...defaultSettings(), ...rowConfig })
          await store.update((state) => ({ ...state, settings: seeded }))
        }
        // No baseline yet and a key is on file: take one now so the first
        // interval is already meaningful. `runCycle` adopts it silently.
        const settings = currentSettings()
        if (settings.autoDetect && store.state.baseline === null && (await readKey()) !== null) {
          await runCycle()
        }
      } catch (error) {
        console.error('[dsh-big-coming] 初始化失败：', error)
      }
      schedule()
    })()
    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
  }, 'dsh-big-coming: scheduler')
}
