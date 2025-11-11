self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// Basit network-first (QR sayfası çok hafif olduğu için agresif cache'e gerek yok)
self.addEventListener('fetch', () => {});
