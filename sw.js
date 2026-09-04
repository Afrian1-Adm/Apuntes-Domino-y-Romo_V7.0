const CORE_CACHE = 'club-domino-core-v75';
const RUNTIME_CACHE = 'club-domino-runtime-v75';

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
    './icon-192.png',
    './icon-512.png'
];

// Estos recursos mejoran la experiencia, pero si falta alguno no debe impedir
// que se instale una nueva versión del Service Worker.
const OPTIONAL_ASSETS = [
    './chiva.mp3'
];


/*
 * ============================================================
 * INSTALACIÓN
 * ============================================================
 */
self.addEventListener('install', event => {

    event.waitUntil(
        (async () => {

            const cache = await caches.open(CORE_CACHE);

            // Si falta un recurso esencial, no activamos una caché incompleta.
            // La versión anterior seguirá disponible hasta completar la actualización.
            await Promise.all(
                CORE_ASSETS.map(async asset => {
                    const request = new Request(asset, { cache: 'no-store' });
                    const response = await fetch(request);

                    if (!response || !response.ok) {
                        throw new Error(`No se pudo precargar ${asset}`);
                    }

                    await cache.put(asset, response.clone());
                })
            );

            await Promise.allSettled(
                OPTIONAL_ASSETS.map(async asset => {
                    const request = new Request(asset, { cache: 'no-store' });
                    const response = await fetch(request);
                    if (!response || !response.ok) return;
                    await cache.put(asset, response.clone());
                })
            );
            // La aplicación necesita esta librería incluso para leer la sesión
            // guardada localmente. Se almacena bajo la URL exacta usada por HTML.
            try {
                const sdkRequest = new Request(SUPABASE_SDK_URL, {
                    cache: 'no-store',
                    mode: 'cors'
                });
                const sdkResponse = await fetch(sdkRequest);
                if (sdkResponse && sdkResponse.ok) {
                    await cache.put(SUPABASE_SDK_URL, sdkResponse.clone());
                }
            } catch (error) {
                console.warn('[SW] No se pudo precargar Supabase JS:', error);
            }

            await self.skipWaiting();

        })()
    );

});


/*
 * ============================================================
 * ACTIVACIÓN
 * ============================================================
 */
self.addEventListener('activate', event => {

    event.waitUntil(
        (async () => {

            const allowedCaches = new Set([
                CORE_CACHE,
                RUNTIME_CACHE
            ]);

            const cacheNames = await caches.keys();

            await Promise.all(
                cacheNames.map(cacheName => {

                    if (
                        cacheName.startsWith('club-domino-') &&
                        !allowedCaches.has(cacheName)
                    ) {

                        console.log(
                            '[SW] Eliminando caché antigua:',
                            cacheName
                        );

                        return caches.delete(cacheName);
                    }

                    return Promise.resolve();

                })
            );

            await self.clients.claim();

        })()
    );

});


/*
 * ============================================================
 * UTILIDADES
 * ============================================================
 */

function normalizarClaveHTML(request) {

    const url = new URL(request.url);

    return new Request(
        url.origin + url.pathname,
        {
            method: 'GET'
        }
    );

}


function esRecursoActualizable(request, url) {

    const pathname = url.pathname.toLowerCase();

    return (
        request.mode === 'navigate' ||
        request.destination === 'document' ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        pathname.endsWith('.html') ||
        pathname.endsWith('.js') ||
        pathname.endsWith('.css') ||
        pathname.endsWith('.json') ||
        pathname.endsWith('.webmanifest')
    );

}


function esRecursoVisual(request, url) {

    const pathname = url.pathname.toLowerCase();

    return (
        request.destination === 'image' ||
        pathname.endsWith('.png') ||
        pathname.endsWith('.jpg') ||
        pathname.endsWith('.jpeg') ||
        pathname.endsWith('.webp') ||
        pathname.endsWith('.svg') ||
        pathname.endsWith('.ico')
    );

}


/*
 * ============================================================
 * NETWORK FIRST
 * ============================================================
 */
async function networkFirst(request) {

    const url = new URL(request.url);

    const esHTML =
        request.mode === 'navigate' ||
        request.destination === 'document' ||
        url.pathname.toLowerCase().endsWith('.html') ||
        url.pathname.endsWith('/');

    const cacheKey = esHTML
        ? normalizarClaveHTML(request)
        : request;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {

        const networkRequest = new Request(
            request,
            {
                cache: 'no-store',
                signal: controller.signal
            }
        );

        const networkResponse =
            await fetch(networkRequest);

        if (
            networkResponse &&
            networkResponse.ok
        ) {

            const cache =
                await caches.open(RUNTIME_CACHE);

            await cache.put(
                cacheKey,
                networkResponse.clone()
            );

            return networkResponse;
        }

        // Los errores temporales del servidor usan la última copia válida.
        if (networkResponse && networkResponse.status < 500) {
            return networkResponse;
        }

        throw new Error(`Respuesta temporal no disponible (${networkResponse?.status || 0})`);

    } catch (error) {

        const runtimeCache =
            await caches.open(RUNTIME_CACHE);

        const runtimeResponse =
            await runtimeCache.match(cacheKey);

        if (runtimeResponse) {
            return runtimeResponse;
        }

        const coreCache =
            await caches.open(CORE_CACHE);

        const coreResponse =
            await coreCache.match(cacheKey);

        if (coreResponse) {
            return coreResponse;
        }

        if (esHTML) {

            const indexResponse =
                await coreCache.match('./index.html');

            if (indexResponse) {
                return indexResponse;
            }

            return new Response(
                `
                <!DOCTYPE html>
                <html lang="es">

                <head>

                    <meta charset="UTF-8">

                    <meta
                        name="viewport"
                        content="width=device-width, initial-scale=1.0"
                    >

                    <title>
                        Sin conexión
                    </title>

                    <style>

                        body{
                            font-family:
                                system-ui,
                                sans-serif;

                            max-width:600px;

                            margin:60px auto;

                            padding:20px;

                            color:#0f172a;
                        }

                    </style>

                </head>

                <body>

                    <h2>
                        Sin conexión
                    </h2>

                    <p>
                        No hay conexión a Internet
                        y esta página todavía no está
                        disponible sin conexión.
                    </p>

                </body>

                </html>
                `,
                {
                    status:503,

                    headers:{
                        'Content-Type':
                            'text/html; charset=utf-8'
                    }
                }
            );
        }

        throw error;

    } finally {

        clearTimeout(timeoutId);

    }

}


/*
 * ============================================================
 * STALE WHILE REVALIDATE
 *
 * Para imágenes:
 * muestra caché rápidamente,
 * pero actualiza en segundo plano.
 * ============================================================
 */
async function staleWhileRevalidate(request) {

    const cache =
        await caches.open(RUNTIME_CACHE);

    const cachedResponse =
        await cache.match(request);

    const networkPromise =
        fetch(
            new Request(
                request,
                {
                    cache:'no-store'
                }
            )
        )

        .then(async networkResponse => {

            if (
                networkResponse &&
                networkResponse.ok
            ) {

                await cache.put(
                    request,
                    networkResponse.clone()
                );

            }

            return networkResponse;

        })

        .catch(() => null);


    if (cachedResponse) {

        networkPromise.catch(() => {});

        return cachedResponse;

    }


    const networkResponse =
        await networkPromise;


    if (networkResponse) {
        return networkResponse;
    }


    return new Response(
        '',
        {
            status:504,
            statusText:'Sin conexión'
        }
    );

}

/*
 * ============================================================
 * CACHÉ PRIMERO PARA LA APLICACIÓN
 *
 * Devuelve inmediatamente la última versión local de HTML/JS/CSS
 * y actualiza silenciosamente el recurso para la próxima entrada.
 * ============================================================
 */
async function cacheFirstApp(request, fetchEvent) {
    const url = new URL(request.url);
    const esHTML =
        request.mode === 'navigate' ||
        request.destination === 'document' ||
        url.pathname.toLowerCase().endsWith('.html') ||
        url.pathname.endsWith('/');
    const cacheKey = esHTML ? normalizarClaveHTML(request) : request;
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    const coreCache = await caches.open(CORE_CACHE);
    const cachedResponse =
        await runtimeCache.match(cacheKey) ||
        await coreCache.match(cacheKey);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const networkPromise = fetch(new Request(request, {
        cache: 'no-store',
        signal: controller.signal
    }))
        .then(async response => {
            if (response && response.ok) {
                await runtimeCache.put(cacheKey, response.clone());
            }
            return response;
        })
        .catch(() => null)
        .finally(() => clearTimeout(timeoutId));

    if (cachedResponse) {
        // La respuesta local sale de inmediato, pero mantenemos vivo el
        // service worker hasta guardar la versión nueva para la próxima visita.
        if (fetchEvent) {
            fetchEvent.waitUntil(networkPromise.then(() => undefined));
        } else {
            networkPromise.catch(() => {});
        }
        return cachedResponse;
    }

    const networkResponse = await networkPromise;
    if (networkResponse) return networkResponse;

    if (esHTML) {
        const fallback = await coreCache.match('./index.html');
        if (fallback) return fallback;
    }

    return new Response('', {
        status: 504,
        statusText: 'Sin conexión'
    });
}

async function cacheFirstExternal(request) {
    const cache = await caches.open(CORE_CACHE);
    const cached = await cache.match(SUPABASE_SDK_URL);
    if (cached) return cached;

    const response = await fetch(request);
    if (response && response.ok) {
        await cache.put(SUPABASE_SDK_URL, response.clone());
    }
    return response;
}


/*
 * ============================================================
 * PETICIONES
 * ============================================================
 */
self.addEventListener('fetch', event => {

    const request = event.request;

    const url =
        new URL(request.url);


    /*
     * Nunca interceptar POST,
     * PUT, PATCH o DELETE.
     */
    if (request.method !== 'GET') {
        return;
    }

    if (url.href === SUPABASE_SDK_URL) {
        event.respondWith(cacheFirstExternal(request));
        return;
    }


    /*
     * Nunca interceptar Supabase.
     */
    if (
        url.hostname.includes('supabase.co') ||
        url.hostname.includes('supabase.in')
    ) {
        return;
    }


    /*
     * No cachear recursos externos.
     *
     * Ej:
     * jsDelivr
     * Google
     * etc.
     */
    if (
        url.origin !==
        self.location.origin
    ) {
        return;
    }


    /*
     * HTML / JS / CSS / JSON
     *
     * CACHÉ PRIMERO + actualización silenciosa.
     */
    if (
        esRecursoActualizable(
            request,
            url
        )
    ) {

        event.respondWith(
            cacheFirstApp(request, event)
        );

        return;
    }


    /*
     * IMÁGENES
     *
     * CACHÉ + actualización.
     */
    if (
        esRecursoVisual(
            request,
            url
        )
    ) {

        event.respondWith(
            staleWhileRevalidate(request)
        );

        return;
    }


    /*
     * Cualquier otro GET local.
     */
    event.respondWith(
        networkFirst(request)
    );

});


/*
 * ============================================================
 * MENSAJES
 * ============================================================
 */
self.addEventListener('message', event => {

    if (
        event.data &&
        event.data.type === 'SKIP_WAITING'
    ) {

        self.skipWaiting();

    }

});


/*
 * ============================================================
 * NOTIFICACIONES
 * ============================================================
 */
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const destino = event.notification?.data?.url || 'lobby.html';
    const scope = self.registration.scope;
    let urlDestino;

    try {
        const candidata = new URL(destino, scope);
        const origenApp = new URL(scope).origin;
        urlDestino = candidata.origin === origenApp ? candidata.href : new URL('lobby.html', scope).href;
    } catch (_) {
        urlDestino = new URL('lobby.html', scope).href;
    }

    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

            for (const client of windows) {
                try {
                    if ('navigate' in client) {
                        const navigated = await client.navigate(urlDestino);
                        if (navigated && 'focus' in navigated) return navigated.focus();
                    }
                } catch (_) {
                    // Si esa ventana no admite navegación, probamos la siguiente.
                }

                try {
                    if ('focus' in client && client.url === urlDestino) return client.focus();
                } catch (_) {}
            }

            return self.clients.openWindow ? self.clients.openWindow(urlDestino) : null;
        })()
    );
});

// Deja preparado el service worker para una futura entrega Web Push.
// Los avisos actuales llegan por Supabase Realtime mientras la app está conectada.
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
