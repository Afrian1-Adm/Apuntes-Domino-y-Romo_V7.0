(function () {
    'use strict';

    if (window.AppOffline) return;

    const LAST_PAGE_KEY = 'club_domino_ultima_pagina';
    const OFFLINE_QUEUE_SELECTOR = '[data-offline-write-queue="true"]';
    const APP_PAGES = new Set([
        'lobby.html',
        'apunte.html',
        'mesa.html',
        'perfil.html',
        'galardones.html',
        'admin.html',
        'historial.html',
        'consultas.html',
        'torneos.html',
        'tombola.html'
    ]);

    const WRITE_WORDS = /(?:guardar|crear|registrar|anotar|eliminar|borrar|rechazar|aprobar|añadir|agregar|inscribir|retirar|editar|reiniciar|finalizar|subir|importar|sortear|rotar|reanudar|buscar\s+reemplazo|elegir\s+retadores|iniciar\s+mesa|cerrar\s+(?:mesa|jornada|sesión|sesion)|abrir\s+(?:otra\s+)?mesa|cambiar\s+contraseña|actualizar\s+(?:perfil|nombres|meta|contraseña|password)|guardar\s+cambios)/i;
    const WRITE_CALLS = /(?:insert|upsert|update|delete|signOut|guardar|crear|registrar|anotar|eliminar|borrar|aprobar|rechazar|retirar|inscribir|iniciarMesa|cerrarMesa|abrirMesa|rotar|sortear|finalizar|reiniciar|reanudarMesa|completarMesa)/i;

    // Supabase limita por defecto las lecturas REST grandes. Paginar de forma
    // transparente las consultas completas de manos evita truncar el historial
    // cuando el club supera 1,000 registros. Se conserva como fallback para
    // módulos administrativos que todavía necesitan las manos individuales.
    const nativeFetch = window.fetch.bind(window);
    const SUPABASE_PAGE_SIZE = 1000;
    const SUPABASE_MAX_PAGES = 100;

    function debePaginarManosSupabase(request, url) {
        if (request.method !== 'GET') return false;
        if (!(url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in'))) return false;
        if (!/^\/rest\/v1\/manos\/?$/.test(url.pathname)) return false;
        if (request.headers.has('range')) return false;
        if (url.searchParams.has('limit') || url.searchParams.has('offset')) return false;

        const accept = String(request.headers.get('accept') || '').toLowerCase();
        return !(
            accept.includes('application/vnd.pgrst.object') ||
            accept.includes('application/vnd.pgrst.object+json')
        );
    }

    async function fetchSupabaseConPaginacion(input, init) {
        let request;
        try {
            request = new Request(input, init);
        } catch (_) {
            return nativeFetch(input, init);
        }

        let url;
        try {
            url = new URL(request.url, location.href);
        } catch (_) {
            return nativeFetch(request);
        }

        if (!debePaginarManosSupabase(request, url)) return nativeFetch(request);

        const primeraRespuesta = await nativeFetch(request.clone());
        if (!primeraRespuesta?.ok) return primeraRespuesta;

        const contentType = String(primeraRespuesta.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) return primeraRespuesta;

        let primeraPagina;
        try {
            primeraPagina = await primeraRespuesta.clone().json();
        } catch (_) {
            return primeraRespuesta;
        }

        if (!Array.isArray(primeraPagina) || primeraPagina.length < SUPABASE_PAGE_SIZE) {
            return primeraRespuesta;
        }

        const datos = [...primeraPagina];
        let desde = SUPABASE_PAGE_SIZE;
        let pagina = 1;

        while (pagina < SUPABASE_MAX_PAGES) {
            const headers = new Headers(request.headers);
            headers.set('Range-Unit', 'items');
            headers.set('Range', `${desde}-${desde + SUPABASE_PAGE_SIZE - 1}`);

            const pageResponse = await nativeFetch(new Request(request, { headers }));
            if (!pageResponse.ok) {
                throw new Error(`No se pudo completar la lectura paginada de manos (${pageResponse.status}).`);
            }

            const pageData = await pageResponse.json();
            if (!Array.isArray(pageData)) {
                throw new Error('Supabase devolvió un formato inesperado al paginar las manos.');
            }

            datos.push(...pageData);
            if (pageData.length < SUPABASE_PAGE_SIZE) break;
            desde += SUPABASE_PAGE_SIZE;
            pagina += 1;
        }

        if (pagina >= SUPABASE_MAX_PAGES) {
            throw new Error('Se alcanzó el límite de seguridad al paginar el historial de manos.');
        }

        const headersFinales = new Headers(primeraRespuesta.headers);
        headersFinales.delete('content-length');
        headersFinales.set('content-type', 'application/json; charset=utf-8');
        headersFinales.set('content-range', datos.length ? `0-${datos.length - 1}/*` : '*/0');

        return new Response(JSON.stringify(datos), {
            status: 200,
            statusText: 'OK',
            headers: headersFinales
        });
    }

    window.fetch = fetchSupabaseConPaginacion;

    // Admin todavía construye su historial a partir de las manos completas para
    // conservar la edición ronda por ronda. Tras esa carga filtramos únicamente
    // partidas que sí alcanzaron la meta. Así una mesa activa con una o más manos
    // nunca aparece como si ya fuera parte del historial cerrado.
    function instalarHistorialAdminSoloCerrado() {
        const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
        if (pagina !== 'admin.html') return;

        document.addEventListener('DOMContentLoaded', () => {
            try {
                if (typeof cargarHistorialCerradoAdmin !== 'function') return;
                if (cargarHistorialCerradoAdmin.__soloPartidasFinalizadas) return;

                const original = cargarHistorialCerradoAdmin;
                const envuelta = async function (...args) {
                    const resultado = await original.apply(this, args);

                    if (Array.isArray(cachePartidasCerradas)) {
                        const soloFinalizadas = cachePartidasCerradas.filter(partida => partida?.finalizada === true);
                        if (soloFinalizadas.length !== cachePartidasCerradas.length) {
                            cachePartidasCerradas = soloFinalizadas;
                            try {
                                localStorage.setItem(
                                    'domino_cache_admin_historial_v1',
                                    JSON.stringify(cachePartidasCerradas)
                                );
                            } catch (_) {}

                            try { firmaHistorialAdmin = ''; } catch (_) {}
                            if (typeof renderizarHistorialLocal === 'function') {
                                renderizarHistorialLocal();
                            }
                        }
                    }

                    return resultado;
                };

                envuelta.__soloPartidasFinalizadas = true;
                cargarHistorialCerradoAdmin = envuelta;
            } catch (error) {
                console.warn('[ADMIN] No se pudo instalar el filtro de historial cerrado:', error);
            }
        }, { once: true });
    }

    instalarHistorialAdminSoloCerrado();

    // Historial público: usa una fila persistente por partida cerrada en lugar
    // de descargar todas las manos y reconstruirlas en el teléfono.
    function instalarHistorialDesdeResumenServidor() {
        const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
        if (pagina !== 'historial.html') return;

        document.addEventListener('DOMContentLoaded', () => {
            try {
                if (typeof cargarHistorialCompleto !== 'function') return;
                if (cargarHistorialCompleto.__resumenServidor) return;

                const original = cargarHistorialCompleto;
                const cliente = window.supabaseClient;
                if (!cliente) return;

                const cargarDesdeResumen = async function () {
                    const { data, error } = await cliente
                        .from('partidas_resumen')
                        .select('mesa_id,mesa_created_at,fecha_final,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,puntos_pareja1,puntos_pareja2,rondas,ganador,es_lisa,diferencial,clutch_winner_team')
                        .order('fecha_final', { ascending: false })
                        .order('mesa_id', { ascending: false });

                    if (error) {
                        console.warn('[RESUMEN] Historial vuelve temporalmente a manos crudas:', error);
                        return original();
                    }

                    const nuevasPartidas = (data || []).map(resumen => {
                        const mesaBase = cacheMesas?.[resumen.mesa_id] || {};
                        const mesa = {
                            ...mesaBase,
                            id: resumen.mesa_id,
                            created_at: resumen.mesa_created_at || resumen.fecha_final,
                            estado: 'cerrada',
                            limite_puntos: Number(resumen.limite_puntos || 200),
                            jugador1_id: resumen.jugador1_id,
                            jugador2_id: resumen.jugador2_id,
                            jugador3_id: resumen.jugador3_id,
                            jugador4_id: resumen.jugador4_id,
                            cuenta_tabla_general: resumen.cuenta_tabla_general !== false,
                            torneo_v2_id: resumen.torneo_v2_id || null
                        };

                        return {
                            mesa_id: resumen.mesa_id,
                            mesas: mesa,
                            puntos_pareja1: Number(resumen.puntos_pareja1 || 0),
                            puntos_pareja2: Number(resumen.puntos_pareja2 || 0),
                            rondas: Number(resumen.rondas || 0),
                            created_at: resumen.fecha_final,
                            finalizada: true,
                            ganador: Number(resumen.ganador || 0),
                            es_lisa: resumen.es_lisa === true,
                            diferencial: Number(resumen.diferencial || 0),
                            clutch_winner_team: Number(resumen.clutch_winner_team || 0)
                        };
                    });

                    const payloadToCache = {
                        partidas: nuevasPartidas,
                        perfiles: cachePerfiles,
                        mesas: cacheMesas
                    };
                    const firmaNueva = typeof firmaDatosHistorial === 'function'
                        ? firmaDatosHistorial(payloadToCache)
                        : JSON.stringify(payloadToCache);

                    if (firmaNueva !== firmaHistorialRenderizada) {
                        cachePartidas = nuevasPartidas;
                        firmaHistorialRenderizada = firmaNueva;
                        try {
                            localStorage.setItem('cache_historial_domino_v1', JSON.stringify(payloadToCache));
                        } catch (_) {}
                        if (typeof aplicarFiltros === 'function') aplicarFiltros();
                    }
                };
                cargarDesdeResumen.__resumenServidor = true;
                cargarHistorialCompleto = cargarDesdeResumen;

                let timer = null;
                try {
                    cliente
                        .channel('historial-partidas-resumen')
                        .on('postgres_changes', {
                            event: '*', schema: 'public', table: 'partidas_resumen'
                        }, () => {
                            clearTimeout(timer);
                            timer = setTimeout(() => cargarDesdeResumen().catch(error => {
                                console.warn('[RESUMEN] No se pudo refrescar Historial:', error);
                            }), 250);
                        })
                        .subscribe();
                } catch (errorRealtime) {
                    console.warn('[RESUMEN] Realtime de Historial no disponible:', errorRealtime);
                }
            } catch (error) {
                console.warn('[RESUMEN] No se pudo instalar Historial resumido:', error);
            }
        }, { once: true });
    }

    instalarHistorialDesdeResumenServidor();

    function currentFile() {
        return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    }

    function rememberPage() {
        const file = currentFile();
        if (!APP_PAGES.has(file)) return;
        try {
            localStorage.setItem(LAST_PAGE_KEY, file + location.search + location.hash);
        } catch (_) {}
    }

    function isOffline() {
        return navigator.onLine === false;
    }

    function supportsQueuedWrites() {
        return Boolean(document.querySelector(OFFLINE_QUEUE_SELECTOR));
    }

    function isReadOnly() {
        return isOffline() && !supportsQueuedWrites();
    }

    function ensureStyles() {
        if (document.getElementById('app-offline-styles')) return;
        const style = document.createElement('style');
        style.id = 'app-offline-styles';
        style.textContent = `
            #app-offline-banner {
                position: fixed;
                left: 50%;
                bottom: calc(14px + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%);
                z-index: 2147483647;
                width: max-content;
                max-width: calc(100vw - 28px);
                padding: 10px 15px;
                border: 1px solid #f59e0b;
                border-radius: 999px;
                background: #111827;
                color: #fff;
                box-shadow: 0 12px 35px rgba(0,0,0,.32);
                font: 800 13px/1.25 system-ui, sans-serif;
                text-align: center;
            }
            #app-offline-toast {
                position: fixed;
                left: 50%;
                bottom: calc(68px + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%);
                z-index: 2147483647;
                width: min(440px, calc(100vw - 28px));
                padding: 12px 16px;
                border-radius: 12px;
                background: #7c2d12;
                color: #fff;
                box-shadow: 0 12px 35px rgba(0,0,0,.32);
                font: 700 14px/1.35 system-ui, sans-serif;
                text-align: center;
            }
            [data-app-offline-blocked="true"] {
                opacity: .55 !important;
                cursor: not-allowed !important;
                filter: grayscale(.25);
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showToast(message) {
        ensureStyles();
        let toast = document.getElementById('app-offline-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-offline-toast';
            toast.setAttribute('role', 'alert');
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.remove(), 3600);
    }

    function showBanner() {
        ensureStyles();
        let banner = document.getElementById('app-offline-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'app-offline-banner';
            banner.setAttribute('role', 'status');
            document.body.appendChild(banner);
        }
        banner.textContent = supportsQueuedWrites()
            ? '📴 Sin conexión · los puntos se guardarán y sincronizarán al volver'
            : '📴 Sin conexión · modo de solo lectura';
    }

    function hideBanner() {
        document.getElementById('app-offline-banner')?.remove();
        document.getElementById('app-offline-toast')?.remove();
    }

    function signature(element) {
        return [
            element.id,
            element.className,
            element.getAttribute('name'),
            element.getAttribute('value'),
            element.getAttribute('title'),
            element.getAttribute('aria-label'),
            element.getAttribute('onclick'),
            element.textContent
        ].filter(Boolean).join(' ');
    }

    function isWriteControl(element) {
        if (!(element instanceof Element)) return false;
        if (element.closest(OFFLINE_QUEUE_SELECTOR)) return false;
        if (element.closest('[data-offline-allow]')) return false;
        if (element.closest('[data-offline-write]')) return true;

        const anchor = element.closest('a[href]');
        if (anchor && !/^javascript:/i.test(anchor.getAttribute('href') || '')) return false;

        const control = element.closest('button, input[type="button"], input[type="submit"], [role="button"], [onclick]');
        if (!control) return false;
        if (control.matches('input[type="submit"], button[type="submit"]')) return true;

        const text = signature(control);
        return WRITE_WORDS.test(text) || WRITE_CALLS.test(control.getAttribute('onclick') || '');
    }

    function markWriteControls(root) {
        if (!isOffline()) return;
        const scope = root instanceof Element || root instanceof Document ? root : document;
        const candidates = scope.matches?.('button, input[type="button"], input[type="submit"], [role="button"], [onclick]')
            ? [scope]
            : [];
        candidates.push(...scope.querySelectorAll?.('button, input[type="button"], input[type="submit"], [role="button"], [onclick]') || []);
        candidates.forEach(control => {
            if (!isWriteControl(control)) return;
            if (!control.hasAttribute('data-app-original-title')) {
                control.setAttribute('data-app-original-title', control.getAttribute('title') || '');
            }
            control.setAttribute('data-app-offline-blocked', 'true');
            control.setAttribute('aria-disabled', 'true');
            control.setAttribute('title', 'No disponible sin conexión');
        });
    }

    function restoreControls() {
        document.querySelectorAll('[data-app-offline-blocked="true"]').forEach(control => {
            control.removeAttribute('data-app-offline-blocked');
            control.removeAttribute('aria-disabled');
            const oldTitle = control.getAttribute('data-app-original-title') || '';
            if (oldTitle) control.setAttribute('title', oldTitle);
            else control.removeAttribute('title');
            control.removeAttribute('data-app-original-title');
        });
    }

    function assertWritable(message) {
        if (!isOffline()) return true;
        showToast(message || 'Sin conexión: puedes consultar y navegar, pero no guardar cambios.');
        return false;
    }

    function applyState() {
        if (isOffline()) {
            showBanner();
            markWriteControls(document);
        } else {
            hideBanner();
            restoreControls();
        }

        window.dispatchEvent(new CustomEvent('app:connectionchange', {
            detail: {
                offline: isOffline(),
                readOnly: isReadOnly(),
                queuedWrites: isOffline() && supportsQueuedWrites()
            }
        }));
    }

    window.AppOffline = {
        isOffline,
        isReadOnly,
        supportsQueuedWrites,
        assertWritable,
        showNotice: showToast,
        lastPageKey: LAST_PAGE_KEY,
        pages: [...APP_PAGES]
    };

    rememberPage();

    document.addEventListener('click', event => {
        if (!isOffline() || !isWriteControl(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        assertWritable();
    }, true);

    document.addEventListener('submit', event => {
        if (!isOffline()) return;
        if (event.target instanceof Element && event.target.closest(`${OFFLINE_QUEUE_SELECTOR}, [data-offline-allow]`)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        assertWritable('Sin conexión: este formulario no puede guardar cambios.');
    }, true);

    window.addEventListener('online', applyState);
    window.addEventListener('offline', applyState);

    function iniciarObservador() {
        applyState();
        if (!document.body) return;
        new MutationObserver(records => {
            if (!isOffline()) return;
            records.forEach(record => record.addedNodes.forEach(markWriteControls));
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciarObservador, { once: true });
    } else {
        iniciarObservador();
    }
})();