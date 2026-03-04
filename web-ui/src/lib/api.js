// API base URL — uses relative path so nginx reverse proxy handles routing.
// In production (Docker/Umbrel): nginx proxies /api/ to bitlink21-core:8021
// In dev (Vite): vite.config.js proxy handles /api/ to localhost:8021
// Can be overridden via localStorage['bitlink21_api_url'] for direct access
const getBaseURL = () => {
  const stored = typeof window !== 'undefined'
    ? localStorage.getItem('bitlink21_api_url')
    : null

  if (stored) return stored

  // Use relative path — works with both nginx proxy and Vite dev proxy
  return ''
}

// Get auth token from localStorage (only if present, no fallback)
const getAuthToken = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('bitlink21_token') || null
  }
  return null
}

const getHeaders = (extra = {}) => {
  const token = getAuthToken()
  const headers = {
    'Content-Type': 'application/json',
  }
  // Only add Authorization header if token exists (don't add 'test-token' fallback)
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return { ...headers, ...extra }
}

export const api = {
  async get(endpoint) {
    const baseUrl = getBaseURL()
    console.debug('[API] GET request', { endpoint, baseUrl })
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: getHeaders(),
      })
      console.debug('[API] GET response received', { endpoint, status: response.status, ok: response.ok })
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        console.error(`[API] GET error - ${response.status}: ${endpoint}`, error)
        throw error
      }
      const data = await response.json()
      console.debug('[API] GET response parsed', { endpoint, dataKeys: Object.keys(data || {}) })
      return data
    } catch (error) {
      console.error(`[API] GET error: ${endpoint}`, error)
      throw error
    }
  },

  async post(endpoint, data) {
    const baseUrl = getBaseURL()
    console.debug('[API] POST request', { endpoint, data })
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
      })
      console.debug('[API] POST response received', { endpoint, status: response.status, ok: response.ok })
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        console.error(`[API] POST error - ${response.status}: ${endpoint}`, error)
        throw error
      }
      // Handle 204 No Content (empty body)
      if (response.status === 204) {
        console.debug('[API] POST response 204 No Content')
        return {}
      }
      const responseData = await response.json()
      console.debug('[API] POST response parsed', { endpoint, dataKeys: Object.keys(responseData || {}) })
      return responseData
    } catch (error) {
      console.error(`[API] POST error: ${endpoint}`, error)
      throw error
    }
  },

  async put(endpoint, data) {
    const baseUrl = getBaseURL()
    console.debug('[API] PUT request', { endpoint, data })
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data),
      })
      console.debug('[API] PUT response received', { endpoint, status: response.status, ok: response.ok })
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        console.error(`[API] PUT error - ${response.status}: ${endpoint}`, error)
        throw error
      }
      // Handle 204 No Content
      if (response.status === 204) {
        return {}
      }
      const responseData = await response.json()
      console.debug('[API] PUT response parsed', { endpoint, dataKeys: Object.keys(responseData || {}) })
      return responseData
    } catch (error) {
      console.error(`[API] PUT error: ${endpoint}`, error)
      throw error
    }
  },

  async delete(endpoint, options = {}) {
    const baseUrl = getBaseURL()
    console.debug('[API] DELETE request', { endpoint, options })
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'DELETE',
        headers: getHeaders(),
        ...options,
      })
      console.debug('[API] DELETE response received', { endpoint, status: response.status, ok: response.ok })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      // Handle 204 No Content
      if (response.status === 204) {
        return {}
      }
      const data = await response.json()
      console.debug('[API] DELETE response parsed', { endpoint, dataKeys: Object.keys(data || {}) })
      return data
    } catch (error) {
      console.error(`[API] DELETE error: ${endpoint}`, error)
      throw error
    }
  },
}
