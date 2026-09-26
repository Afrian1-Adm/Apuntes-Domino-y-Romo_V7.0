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

    /*
     * Supabase limita por defecto las consultas REST grandes. La app ya
     * superó las 1,000 manos, así que una consulta simple a "manos" podía
     * devolver un historial incompleto sin lanzar error.
     *
     * Este wrapper pagina de forma transparente SOLO las lecturas completas
     * de /rest/v1/manos. Respeta .range(), .limit(), .single() y cualquier
     * consulta que ya haya pedido un rango explícito.
     */
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
        if (
            accept.includes('application/vnd.pgrst.object') ||
            accept.includes('application/vnd.pgrst.object+json')
        ) {
            return false;
        }

        return true;
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

        if (!debePaginarManosSupabase(request, url)) {
            return nativeFetch(request);
        }

        const primeraRespuesta = await nativeFetch(request.clone());
        if (!primeraRespuesta || !primeraRespuesta.ok) return primeraRespuesta;

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

            const pageRequest = new Request(request, { headers });
            const pageResponse = await nativeFetch(pageRequest);

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
        headersFinales.set(
            'content-range',
            datos.length ? `0-${datos.length - 1}/*` : '*/0'
        );

        return new Response(JSON.stringify(datos), {
            status: 200,
            statusText: 'OK',
            headers: headersFinales
        });
    }

    window.fetch = fetchSupabaseConPaginacion;

    function currentFile() {
        return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    }

    function rememberPage() {
        const file = currentFile();
        if (!APP_PAGES.has(file)) return;
        try {
            localStorage.setItem(LAST_PAGE_KEY, file + location.search + location.hash);
        } catch (error) {}
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

    function validarAnotacionMesa(event) {
        if (currentFile() !== 'mesa.html') return;
        if (!(event.target instanceof HTMLFormElement)) return;

        const p1Input = event.target.querySelector('#input-p1') || document.getElementById('input-p1');
        const p2Input = event.target.querySelector('#input-p2') || document.getElementById('input-p2');
        if (!p1Input || !p2Input) return;

        const raw1 = String(p1Input.value || '').trim();
        const raw2 = String(p2Input.value || '').trim();
        const p1 = raw1 === '' ? 0 : Number(raw1);
        const p2 = raw2 === '' ? 0 : Number(raw2);

        let mensaje = '';

        if (!Number.isFinite(p1) || !Number.isFinite(p2) || !Number.isInteger(p1) || !Number.isInteger(p2)) {
            mensaje = 'Los puntos deben ser números enteros.';
        } else if (p1 < 0 || p2 < 0) {
            mensaje = 'Los puntos no pueden ser negativos.';
        } else if (p1 > 0 && p2 > 0) {
            mensaje = 'Anota los puntos de una sola pareja por mano.';
        } else if (p1 > 168 || p2 > 168) {
            mensaje = 'Una sola mano no puede superar 168 puntos. Revisa el valor antes de guardarlo.';
        }

        if (!mensaje) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        showToast(mensaje);
        try { alert(mensaje); } catch (_) {}
    }

    function prepararControlesMesa() {
        if (currentFile() !== 'mesa.html') return;
        ['input-p1', 'input-p2'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.setAttribute('min', '0');
            input.setAttribute('max', '168');
            input.setAttribute('step', '1');
            input.setAttribute('inputmode', 'numeric');
        });
    }

    function parchearHistorialAdmin() {
        if (currentFile() !== 'admin.html') return;
        if (typeof window.cargarHistorialCerradoAdmin !== 'function') return;

        const original = window.cargarHistorialCerradoAdmin;

        window.cargarHistorialCerradoAdmin = async function cargarHistorialCerradoAdminSeguro() {
            try {
                if (
                    typeof sbClient === 'undefined' ||
                    typeof cacheMesas === 'undefined' ||
                    typeof cachePartidasCerradas === 'undefined' ||
                    typeof renderizarHistorialLocal !== 'function'
                ) {
                    return original.apply(this, arguments);
                }

                const { data, error } = await sbClient
                    .from('manos')
                    .select('*')
                    .eq('anulada', false)
                    .order('created_at', { ascending: true })
                    .order('id', { ascending: true });

                if (error) {
                    const cuerpo = document.getElementById('cuerpo-tabla-historial');
                    if (cuerpo) {
                        cuerpo.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--accent-red);">Error al cargar historial.</td></tr>';
                    }
                    return;
                }

                const mesasAcumulado = {};

                (data || []).forEach(m => {
                    const mesaId = m.mesa_id;

                    if (!mesasAcumulado[mesaId]) {
                        const mesaInfo = cacheMesas[mesaId] || { id: mesaId, limite_puntos: 200 };
                        mesasAcumulado[mesaId] = {
                            mesa_id: mesaId,
                            mesas: mesaInfo,
                            puntos_pareja1: 0,
                            puntos_pareja2: 0,
                            rondas: 0,
                            created_at: m.created_at,
                            finalizada: false,
                            manos_ids: []
                        };
                    }

                    const partida = mesasAcumulado[mesaId];

                    // Una partida cerrada no puede seguir acumulando manos.
                    if (partida.finalizada) return;

                    partida.puntos_pareja1 += Number(m.puntos_pareja1 || 0);
                    partida.puntos_pareja2 += Number(m.puntos_pareja2 || 0);
                    partida.rondas += 1;
                    partida.manos_ids.push(m);

                    if (m.created_at) partida.created_at = m.created_at;

                    const limite = Number(partida.mesas?.limite_puntos || 200);
                    if (
                        partida.puntos_pareja1 >= limite ||
                        partida.puntos_pareja2 >= limite
                    ) {
                        partida.finalizada = true;
                    }
                });

                cachePartidasCerradas = Object.values(mesasAcumulado)
                    .filter(p => p.finalizada)
                    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

                try {
                    localStorage.setItem(
                        'domino_cache_admin_historial_v1',
                        JSON.stringify(cachePartidasCerradas)
                    );
                } catch (_) {}

                renderizarHistorialLocal();
            } catch (error) {
                console.error('[APP] No se pudo aplicar el historial administrativo corregido:', error);
                return original.apply(this, arguments);
            }
        };
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

    // Se registra en captura antes del onsubmit de mesa.html para que una mano
    // inválida jamás llegue a la cola offline ni al RPC de Supabase.
    document.addEventListener('submit', validarAnotacionMesa, true);

    document.addEventListener('submit', event => {
        if (!isOffline()) return;
        if (event.target instanceof Element && event.target.closest(`${OFFLINE_QUEUE_SELECTOR}, [data-offline-allow]`)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        assertWritable('Sin conexión: este formulario no puede guardar cambios.');
    }, true);

    window.addEventListener('online', applyState);
    window.addEventListener('offline', applyState);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            prepararControlesMesa();
            parchearHistorialAdmin();
            applyState();
            new MutationObserver(records => {
                if (!isOffline()) return;
                records.forEach(record => record.addedNodes.forEach(markWriteControls));
            }).observe(document.body, { childList: true, subtree: true });
        }, { once: true });
    } else {
        prepararControlesMesa();
        parchearHistorialAdmin();
        applyState();
        new MutationObserver(records => {
            if (!isOffline()) return;
            records.forEach(record => record.addedNodes.forEach(markWriteControls));
        }).observe(document.body, { childList: true, subtree: true });
    }
})();
