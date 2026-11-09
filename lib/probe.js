/**
 * "大的要来了" probe primitives.
 *
 * The probe is deliberately tiny: one `GET /models` (cheap) plus one
 * `POST /chat/completions` with `max_tokens: 1` per watched model, so a cycle
 * costs a few dozen tokens. The fingerprint we care about is the official
 * `system_fingerprint` field — plus the response envelope shape and the model
 * catalog metadata, which also move when the backend changes.
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const MAX_MODELS_PER_CYCLE = 4

const CATALOG_FIELDS = [
  'name',
  'owned_by',
  'context_window',
  'max_output_tokens',
  'input_modalities',
  'output_modalities',
  'effort',
  'api_capabilities',
]

const SHAPE_FIELDS = ['top', 'choice', 'message', 'usage']

/**
 * The prompt the probe sends. `prompt_tokens` for this exact string is a
 * side-channel fingerprint of the tokenizer: it is stable across calls and
 * changes when the vocabulary, the merge table, or the chat template's overhead
 * changes — none of which `system_fingerprint` necessarily reflects.
 *
 * Kept short so it stays cheap, but wide enough that a tokenizer swap is
 * unlikely to leave the count identical: it mixes Latin, CJK, an emoji run,
 * non-ASCII punctuation and source code.
 */
const PROBE_TEXT = 'hi'

/**
 * Fields whose *absence* is a request-shape artefact, not a backend change.
 * `usage.completion_tokens_details` only appears when the model actually
 * reasoned, so switching thinking off would otherwise register as one phantom
 * "response shape changed" event on the very next cycle.
 */
const SHAPE_IGNORED = {
  usage: ['completion_tokens_details', 'prompt_tokens_details'],
  // `reasoning_content` appears in `message` only when the model reasoned.
  message: ['reasoning_content'],
}

function nowIso() {
  return new Date().toISOString()
}

function pick(object, fields) {
  const out = {}
  if (object === null || typeof object !== 'object') return out
  for (const field of fields) {
    if (object[field] === undefined) continue
    out[field] = object[field]
  }
  return out
}

function keysOf(value, ignore) {
  if (value === null || typeof value !== 'object') return []
  const keys = Object.keys(value)
  return keys.filter((key) => ignore === undefined || !ignore.includes(key)).sort()
}

/** Applies SHAPE_IGNORED to a stored shape, which predates the filter. */
function sanitizeShape(shape) {
  const out = {}
  if (shape === null || typeof shape !== 'object') return out
  for (const field of SHAPE_FIELDS) {
    const ignore = SHAPE_IGNORED[field]
    const value = shape[field]
    out[field] = Array.isArray(value)
      ? value.filter((key) => ignore === undefined || !ignore.includes(key))
      : value
  }
  return out
}

function shortHash(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function messageOf(payload, fallback) {
  const error = payload && typeof payload === 'object' ? payload.error : undefined
  if (error && typeof error.message === 'string' && error.message !== '') return error.message
  if (payload && typeof payload.message === 'string' && payload.message !== '') return payload.message
  return fallback
}

async function requestText(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    return {
      status: response.status,
      ok: response.ok,
      text,
      durationMs: Date.now() - startedAt,
      headers: {
        trace: response.headers.get('x-ds-trace-id') ?? null,
      },
    }
  } catch (error) {
    const aborted = controller.signal.aborted
    return {
      status: 0,
      ok: false,
      text: '',
      error: aborted ? `请求超时（${Math.round(timeoutMs / 1000)}s）` : String(error?.message ?? error),
      durationMs: Date.now() - startedAt,
      headers: {},
    }
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(text) {
  if (typeof text !== 'string' || text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Normalizes one model entry from `GET /models` into the comparable slice. */
function catalogEntry(item) {
  return pick(item, CATALOG_FIELDS)
}

export function baseUrlOf(settings) {
  const raw = typeof settings?.apiBaseUrl === 'string' ? settings.apiBaseUrl.trim() : ''
  const base = raw === '' ? DEFAULT_BASE_URL : raw
  return base.replace(/\/+$/, '')
}

/** One `GET /models`; returns the catalog keyed by model id. */
export async function fetchCatalog({ baseUrl, key, timeoutMs = 20000 }) {
  const result = await requestText(`${baseUrl}/models`, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  }, timeoutMs)
  const payload = parseJson(result.text)
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error ?? messageOf(payload, `HTTP ${result.status}`),
      at: nowIso(),
    }
  }
  const list = Array.isArray(payload?.data) ? payload.data : []
  const models = {}
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id : null
    if (id === null || id === '') continue
    models[id] = catalogEntry(item)
  }
  return { ok: true, status: result.status, models, ids: Object.keys(models).sort(), at: nowIso() }
}

/**
 * One minimal completion for one model.
 *
 * `max_tokens: 1` caps the reply, and `thinking: { type: 'disabled' }` stops
 * the model from generating a reasoning trace first. Measured against the live
 * API, disabling thinking drops the prompt from 84 to 5 tokens on
 * deepseek-v4-pro (its default `effort` is `high`, which ships a reasoning
 * preamble) and from 31 to 5 on deepseek-flash — while `system_fingerprint`,
 * the served `model` field and the envelope shape stay identical, so the probe
 * still sees everything it actually compares.
 */
export async function probeModel({ baseUrl, key, model, timeoutMs = 40000 }) {
  const result = await requestText(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: PROBE_TEXT }],
      max_tokens: 1,
      stream: false,
      thinking: { type: 'disabled' },
    }),
  }, timeoutMs)

  const payload = parseJson(result.text)
  const at = nowIso()

  if (!result.ok) {
    return {
      ok: false,
      at,
      status: result.status,
      error: result.error ?? messageOf(payload, `HTTP ${result.status}`),
      trace: result.headers.trace,
    }
  }

  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined
  const message = choice?.message
  const shape = {
    top: keysOf(payload),
    choice: keysOf(choice),
    message: keysOf(message),
    usage: keysOf(payload?.usage, SHAPE_IGNORED.usage),
  }
  const fingerprint = typeof payload?.system_fingerprint === 'string' ? payload.system_fingerprint : null
  return {
    ok: true,
    at,
    status: result.status,
    trace: result.headers.trace,
    durationMs: result.durationMs,
    servedModel: typeof payload?.model === 'string' ? payload.model : null,
    fingerprint,
    shape,
    shapeHash: shortHash(JSON.stringify(shape)),
    usage: payload?.usage ?? null,
    // The tokenizer fingerprint. A fixed prompt must always cost the same;
    // otherwise the tokenizer behind the endpoint changed.
    promptTokens: typeof payload?.usage?.prompt_tokens === 'number' ? payload.usage.prompt_tokens : null,
    probeText: PROBE_TEXT,
  }
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function show(value) {
  if (value === null || value === undefined) return '（无）'
  if (typeof value === 'string') return value === '' ? '（空）' : value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Compares the stored baseline with a fresh cycle and returns human-readable
 * change rows. The caller decides what to do with them; this function is pure.
 */
export function diffCycle(baseline, cycle) {
  const details = []
  const baselineModels = baseline?.models ?? {}
  const nextModels = cycle?.models ?? {}

  // Catalog-level model set.
  const beforeIds = Object.keys(baselineModels).sort()
  const afterIds = Object.keys(nextModels).sort()
  for (const id of afterIds) {
    if (baselineModels[id] === undefined) {
      const entry = nextModels[id]
      details.push({
        kind: 'model-added',
        label: `模型 ${id}`,
        from: '不存在',
        to: entry?.name ? `${entry.name}（新增）` : '新增',
      })
    }
  }
  for (const id of beforeIds) {
    if (nextModels[id] === undefined) {
      details.push({ kind: 'model-removed', label: `模型 ${id}`, from: '存在', to: '消失' })
    }
  }

  // Catalog metadata per surviving model.
  for (const id of afterIds) {
    const before = baselineModels[id]
    const after = nextModels[id]
    if (before === undefined || after === undefined) continue
    for (const field of CATALOG_FIELDS) {
      if (sameValue(before[field], after[field])) continue
      details.push({
        kind: 'catalog',
        label: `${id} · ${field}`,
        from: show(before[field]),
        to: show(after[field]),
      })
    }
  }

  // Fingerprint and envelope shape per probed model.
  const baselineProbes = baseline?.probes ?? {}
  for (const [id, probe] of Object.entries(cycle?.probes ?? {})) {
    const before = baselineProbes[id]
    if (before === undefined) continue
    if (!probe.ok) continue
    if (!sameValue(before.fingerprint, probe.fingerprint)) {
      details.push({
        kind: 'fingerprint',
        label: `${id} · system_fingerprint`,
        from: show(before.fingerprint),
        to: show(probe.fingerprint),
      })
    }
    if (!sameValue(before.servedModel, probe.servedModel)) {
      details.push({
        kind: 'served-model',
        label: `${id} · 返回的 model 字段`,
        from: show(before.servedModel),
        to: show(probe.servedModel),
      })
    }
    // Tokenizer fingerprint. A baseline written before this field existed has
    // no `probeText`, so the comparison would fire on the upgrade itself; only
    // judge it once both sides measured the same prompt.
    if (before.probeText !== undefined && before.probeText === probe.probeText
        && !sameValue(before.promptTokens, probe.promptTokens)) {
      details.push({
        kind: 'tokenizer',
        label: `${id} · 分词器（固定输入的 prompt_tokens）`,
        from: show(before.promptTokens),
        to: show(probe.promptTokens),
      })
    }
    // Baselines written before the thinking switch still carry the keys that
    // only exist when a model reasons. Both sides get the same treatment, so
    // upgrading cannot masquerade as a backend change.
    const beforeShape = sanitizeShape(before.shape)
    const afterShape = sanitizeShape(probe.shape)
    if (!sameValue(beforeShape, afterShape)) {
      const changed = SHAPE_FIELDS.filter((field) => !sameValue(beforeShape[field], afterShape[field]))
      for (const field of changed) {
        details.push({
          kind: 'shape',
          label: `${id} · 响应结构 ${field}`,
          from: (beforeShape[field] ?? []).join(', ') || '（无）',
          to: (afterShape[field] ?? []).join(', ') || '（无）',
        })
      }
    }
  }

  return details
}

/** A short, meme-friendly headline for an aggregated change set. */
export function headlineOf(details) {
  const kinds = new Set(details.map((item) => item.kind))
  if (kinds.has('tokenizer')) return '分词器变了'
  if (kinds.has('fingerprint')) return '系统指纹变了'
  if (kinds.has('shape') || kinds.has('served-model')) return '响应结构变了'
  if (kinds.has('model-added')) return '新模型登场'
  if (kinds.has('model-removed')) return '模型下架了'
  if (kinds.has('catalog')) return '模型参数变了'
  return '官方动了点东西'
}
