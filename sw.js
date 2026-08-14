/**
 * sw.js — gives QwenLoca cross-origin isolation on static hosts that cannot
 * set response headers (e.g. GitHub Pages).
 *
 * COOP/COEP enable SharedArrayBuffer, which lets ONNX Runtime Web use its
 * multithreaded WASM build (faster generation). Without this the app still
 * works — inference just runs on a single thread.
 *
 * This service worker only rewrites same-origin navigation responses to add
 * the two headers. It does NOT cache anything (no model files, no app assets),
 * keeping the site's "no persistence" promise intact.
 */
self.addEventListener('install', () => {
  self.skipWaiting(); // activate as soon as installed
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim()); // take control of open pages
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const isSameOriginNavigation =
    request.mode === 'navigate' && request.url.startsWith(self.location.origin);

  if (!isSameOriginNavigation) return; // leave everything else untouched

  event.respondWith(
    (async () => {
      const response = await fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })().catch(() => fetch(request)), // offline/edge cases: fall back to plain fetch
  );
});
