const CORE_CACHE = 'club-domino-core-v85';
const RUNTIME_CACHE = 'club-domino-runtime-v85';

const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const CORE_ASSETS = [
    './',
    './index.html',
    './login.html',
    './lobby.html',
    './apunte.html',
    './mesa.html',
    './perfil.html',
    './galardones.html',
    './admin.html',
    './historial.html',
    './consultas.html',
    './torneos.html',
    './tombola.html',
    './logo.png',
    './manifest.json',
    './cache.js',
    './offline-mode.js',
    './vista-app.js',
    './app-notifications.js',
    './legacy-ranking.js',
    './statistics-integrity.js',
    './elo-runtime.js',
    './summary-stats-runtime.js',
    './admin-summary-runtime.js',
    './icon-192.png',
    './icon-512.png'
];

const OPTIONAL_ASSETS = ['./chiva.mp3'];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CORE_CACHE);

        // Los recursos esenciales se instalan como una unidad. Así nunca queda
        // activa una versión nueva a la que le falten las reglas estadísticas.
        await Promise.all(CORE_ASSETS.map(async asset => {
            const response = await fetch(new Request(asset, { cache: 'no-store' }));
            if (!response?.ok) throw new Error(`No se pudo precargar ${asset}`);
            await cache.put(asset, response.clone());
        }));

        await Promise.allSettled(OPTIONAL_ASSETS.map(async asset => {
            const response = await fetch(new Request(asset, { cache: 'no-store' }));
            if (response?.ok) await cache.put(asset, response.clone());
        }));

        try {
            const sdkRequest = new Request(SUPABASE_SDK_URL, { cache: 'no-store', mode: 'cors' });
            const sdkResponse = await fetch(sdkRequest);
            if (sdkResponse?.ok) await cache.put(SUPABASE_SDK_URL, sdkResponse.clone());
        } catch (error) {
            console.warn('[SW] No se pudo precargar Supabase JS:', error);
        }

        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const permitidas = new Set([CORE_CACHE, RUNTIME_CACHE]);
        const nombres = await caches.keys();
        await Promise.all(nombres.map(nombre => {
            if (nombre.startsWith('club-domino-') && !permitidas.has(nombre)) {
                return caches.delete(nombre);
            }
            return Promise.resolve();
        }));
        await self.clients.claim();
    })());
});

function claveSinQuery(request) {
    const url = new URL(request.url);
    return new Request(url.origin + url.pathname, { method: 'GET' });
}

function esHTML(request, url) {
    return request.mode === 'navigate' ||
        request.destination === 'document' ||
        url.pathname.toLowerCase().endsWith('.html') ||
        url.pathname.endsWith('/');
}

function esRecursoActualizable(request, url) {
    const pathname = url.pathname.toLowerCase();
    return esHTML(request, url) ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        pathname.endsWith('.js') ||
        pathname.endsWith('.css') ||
        pathname.endsWith('.json') ||
        pathname.endsWith('.webmanifest');
}

function esRecursoVisual(request, url) {
    const pathname = url.pathname.toLowerCase();
    return request.destination === 'image' ||
        pathname.endsWith('.png') ||
        pathname.endsWith('.jpg') ||
        pathname.endsWith('.jpeg') ||
        pathname.endsWith('.webp') ||
        pathname.endsWith('.svg') ||
        pathname.endsWith('.ico');
}

async function buscarCacheLocal(request, cachePrincipal, cacheSecundaria = null) {
    const exacta = await cachePrincipal.match(request);
    if (exacta) return exacta;

    // Los scripts se cargan con ?v=... para invalidación. La precarga del core
    // usa la ruta limpia; este fallback permite utilizarlos también sin Internet.
    const limpia = claveSinQuery(request);
    const normalizada = await cachePrincipal.match(limpia);
    if (normalizada) return normalizada;

    if (cacheSecundaria) {
        return await cacheSecundaria.match(request) || await cacheSecundaria.match(limpia);
    }
    return null;
}

async function networkFirst(request) {
    const url = new URL(request.url);
    const html = esHTML(request, url);
    const cacheKey = html ? claveSinQuery(request) : request;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(new Request(request, {
            cache: 'no-store',
            signal: controller.signal
        }));

        if (response?.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(cacheKey, response.clone());
            return response;
        }

        if (response && response.status < 500) return response;
        throw new Error(`Respuesta temporal no disponible (${response?.status || 0})`);
    } catch (error) {
        const runtime = await caches.open(RUNTIME_CACHE);
        const core = await caches.open(CORE_CACHE);
        const cached = await buscarCacheLocal(cacheKey, runtime, core);
        if (cached) return cached;

        if (html) {
            const index = await core.match('./index.html');
            if (index) return index;
            return new Response(
                '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title><body style="font-family:system-ui;max-width:600px;margin:60px auto;padding:20px"><h2>Sin conexión</h2><p>Esta página todavía no está disponible sin conexión.</p></body></html>',
                { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    const networkPromise = fetch(new Request(request, { cache: 'no-store' }))
        .then(async response => {
            if (response?.ok) await cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    if (cached) {
        networkPromise.catch(() => {});
        return cached;
    }

    const response = await networkPromise;
    return response || new Response('', { status: 504, statusText: 'Sin conexión' });
}

async function cacheFirstApp(request, fetchEvent) {
    const url = new URL(request.url);
    const html = esHTML(request, url);
    const cacheKey = html ? claveSinQuery(request) : request;
    const runtime = await caches.open(RUNTIME_CACHE);
    const core = await caches.open(CORE_CACHE);
    const cached = await buscarCacheLocal(cacheKey, runtime, core);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const networkPromise = fetch(new Request(request, {
        cache: 'no-store',
        signal: controller.signal
    }))
        .then(async response => {
            if (response?.ok) {
                await runtime.put(cacheKey, response.clone());
                // Conservamos además la ruta limpia para que ?v=... tenga un
                // fallback inequívoco en la próxima apertura sin conexión.
                await runtime.put(claveSinQuery(request), response.clone());
            }
            return response;
        })
        .catch(() => null)
        .finally(() => clearTimeout(timeoutId));

    if (cached) {
        if (fetchEvent) fetchEvent.waitUntil(networkPromise.then(() => undefined));
        else networkPromise.catch(() => {});
        return cached;
    }

    const response = await networkPromise;
    if (response) return response;

    if (html) {
        const index = await core.match('./index.html');
        if (index) return index;
    }

    return new Response('', { status: 504, statusText: 'Sin conexión' });
}

async function cacheFirstExternal(request) {
    const cache = await caches.open(CORE_CACHE);
    const cached = await cache.match(SUPABASE_SDK_URL);
    if (cached) return cached;

    const response = await fetch(request);
    if (response?.ok) await cache.put(SUPABASE_SDK_URL, response.clone());
    return response;
}

async function inyectarRuntimeMesa(response, url) {
    if (!response?.ok) return response;
    if (!url.pathname.toLowerCase().endsWith('/mesa.html')) return response;

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return response;

    const html = await response.clone().text();
    if (html.includes('elo-runtime.js')) return response;

    const etiqueta = '<script src="./elo-runtime.js?v=85"></script>';
    const htmlFinal = html.includes('</head>')
        ? html.replace('</head>', `    ${etiqueta}\n</head>`)
        : `${etiqueta}\n${html}`;

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'text/html; charset=utf-8');

    return new Response(htmlFinal, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

async function inyectarRuntimeResumen(response, url) {
    if (!response?.ok) return response;

    const pathname = url.pathname.toLowerCase();
    if (!pathname.endsWith('/perfil.html') && !pathname.endsWith('/galardones.html')) {
        return response;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return response;

    const html = await response.clone().text();
    if (html.includes('summary-stats-runtime.js')) return response;

    const etiqueta = '<script src="./summary-stats-runtime.js?v=85"></script>';
    const htmlFinal = html.includes('</head>')
        ? html.replace('</head>', `    ${etiqueta}\n</head>`)
        : `${etiqueta}\n${html}`;

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'text/html; charset=utf-8');

    return new Response(htmlFinal, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

async function inyectarRuntimeAdmin(response, url) {
    if (!response?.ok) return response;
    if (!url.pathname.toLowerCase().endsWith('/admin.html')) return response;

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return response;

    const html = await response.clone().text();
    if (html.includes('admin-summary-runtime.js')) return response;

    const etiqueta = '<script src="./admin-summary-runtime.js?v=85"></script>';
    const htmlFinal = html.includes('</head>')
        ? html.replace('</head>', `    ${etiqueta}\n</head>`)
        : `${etiqueta}\n${html}`;

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'text/html; charset=utf-8');

    return new Response(htmlFinal, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    if (url.href === SUPABASE_SDK_URL) {
        event.respondWith(cacheFirstExternal(request));
        return;
    }

    if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) return;
    if (url.origin !== self.location.origin) return;

    if (esRecursoActualizable(request, url)) {
        event.respondWith((async () => {
            const response = await cacheFirstApp(request, event);
            if (!esHTML(request, url)) return response;
            const conRuntimeMesa = await inyectarRuntimeMesa(response, url);
            const conRuntimeResumen = await inyectarRuntimeResumen(conRuntimeMesa, url);
            return inyectarRuntimeAdmin(conRuntimeResumen, url);
        })());
        return;
    }

    if (esRecursoVisual(request, url)) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    event.respondWith(networkFirst(request));
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const destino = event.notification?.data?.url || 'lobby.html';
    const scope = self.registration.scope;
    let urlDestino;

    try {
        const candidata = new URL(destino, scope);
        const origenApp = new URL(scope).origin;
        urlDestino = candidata.origin === origenApp
            ? candidata.href
            : new URL('lobby.html', scope).href;
    } catch (_) {
        urlDestino = new URL('lobby.html', scope).href;
    }

    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            try {
                if ('navigate' in client) {
                    const navigated = await client.navigate(urlDestino);
                    if (navigated && 'focus' in navigated) return navigated.focus();
                }
            } catch (_) {}
            try {
                if ('focus' in client && client.url === urlDestino) return client.focus();
            } catch (_) {}
        }
        return self.clients.openWindow ? self.clients.openWindow(urlDestino) : null;
    })());
});

self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (_) {
        payload = { body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'Club Dominó y Romo';
    const options = {
        body: payload.body || 'Tienes un aviso nuevo.',
        icon: new URL('icon-192.png', self.registration.scope).href,
        badge: new URL('icon-192.png', self.registration.scope).href,
        tag: payload.tag || 'club-domino',
        renotify: true,
        vibrate: [220, 100, 220],
        requireInteraction: payload.tipo === 'mesa_iniciada' || payload.tipo === 'tombola_seleccion',
        data: { url: payload.url || 'lobby.html' }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});