const CACHE_NAME = 'budgetly-app-shell-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.ico', '/favicon-32.png', '/pwa-192.png', '/pwa-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  )
  self.clients.claim()
})

const isSafeStaticRequest = (request) => {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === self.location.origin && ['script', 'style', 'image', 'font'].includes(request.destination)
}

const isSupabaseRequest = (requestUrl) => {
  const host = requestUrl.hostname
  return host.includes('supabase.co') || host.includes('supabase.in')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (isSupabaseRequest(url)) return
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(async () => {
          const cachedShell = await caches.match('/index.html')
          return cachedShell || caches.match('/')
        })
    )
    return
  }

  if (isSafeStaticRequest(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
            }
            return response
          })
          .catch(() => cached)
        return cached || networkFetch
      })
    )
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// --- Web Push -------------------------------------------------------------
// Payloads are sent by the send-push Edge Function as JSON:
//   { title, body, tag, url, category, priority }
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch (_) { payload = { title: 'Budgetly', body: event.data ? event.data.text() : '' } }
  const title = payload.title || 'Budgetly'
  const options = {
    body: payload.body || '',
    tag: payload.tag || payload.category || 'budgetly',
    icon: '/pwa-192.png',
    badge: '/favicon-32.png',
    data: { url: payload.url || '/', category: payload.category || null },
    renotify: Boolean(payload.tag),
    requireInteraction: payload.priority === 'critical' || payload.priority === 'high',
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'budgetly:notification-click', url: targetUrl })
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})
