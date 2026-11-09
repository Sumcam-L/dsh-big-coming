/**
 * Small HTTP helpers shared by the plugin's single route.
 *
 * The Host half owns every operation that touches the network or the disk, so
 * the browser half is a thin view: `GET <route>?action=…` for reads,
 * `POST <route>` for writes. One route, one handler, so unload cleanly removes
 * everything.
 */

export const ROUTE = '/dsh-big-coming/api'

export function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export async function readJsonBody(req, limit = 32 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}
