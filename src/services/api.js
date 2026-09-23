/**
 * MariFindX API client.
 *
 * Talks to the FastAPI backend. There is no mock fallback: if the backend
 * or the trained checkpoint is missing, the UI must say so rather than
 * render invented predictions.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  let response
  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })
  } catch (cause) {
    throw new ApiError(
      `Cannot reach the MariFindX backend at ${BASE_URL}. Start it with: uvicorn backend.main:app --reload`,
      0,
      { cause: String(cause) },
    )
  }

  if (!response.ok) {
    let detail = null
    try {
      const body = await response.json()
      detail = body.detail ?? body
    } catch {
      detail = await response.text().catch(() => null)
    }
    const message =
      (detail && (detail.message || detail.error)) ||
      `Request failed (${response.status})`
    throw new ApiError(message, response.status, detail)
  }

  return response.json()
}

export const api = {
  health: () => request('/api/health'),

  modelStatus: () => request('/api/model/status'),

  modelMetrics: () => request('/api/model/metrics'),

  runDemo: () => request('/api/investigation/demo', { method: 'POST' }),

  createInvestigation: (payload) =>
    request('/api/investigation/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listInvestigations: () => request('/api/investigation/list'),

  getInvestigation: (id) => request(`/api/investigation/${id}`),

  getResult: (id) => request(`/api/investigation/${id}/result`),

  geojsonUrl: (id, layer) =>
    `${BASE_URL}/api/investigation/${id}/geojson/${layer}`,

  runDrift: (payload) =>
    request('/api/drift/run', { method: 'POST', body: JSON.stringify(payload) }),

  loadAis: (payload) =>
    request('/api/ais/load', { method: 'POST', body: JSON.stringify(payload) }),

  runCorrelation: (payload) =>
    request('/api/correlation/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  async uploadScene(file) {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(`${BASE_URL}/api/investigation/upload`, {
      method: 'POST',
      body: form,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new ApiError(
        body?.detail?.message || `Upload failed (${response.status})`,
        response.status,
        body?.detail,
      )
    }
    return response.json()
  },
}

export default api
