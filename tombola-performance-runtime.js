(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'tombola.html') return;
    if (window.TombolaPerformanceRuntime) return;

    const RETARDO_MANOS_MS = 180;
    const mesasPendientes = new Set();
    let refrescoManosEnCurso = false;
    let timerManos = null;
    let fallbackCompletoManos = null;

    function clienteActual() {
        return window.supabaseClient || null;
    }

    function idsMesasTombolaActivas() {
        try {
            return [...new Set((mesasTombola || [])
                .map(control => control?.mesa_actual_id)
                .filter(Boolean)
                .map(String))];
        } catch (_) {
            return [];
        }
    }

    function mesaIdEvento(payload) {
        return payload?.new?.mesa_id || payload?.old?.mesa_id || null;
    }

    function fechaMano(mano) {
        const valor = mano?.created_at || mano?.creado_en || '';
        const ms = valor ? new Date(valor).getTime() : 0;
        return Number.isFinite(ms) ? ms : 0;
    }

    function aplicarRenderLigero() {
        try {
            const firmaNueva = firmaEstadoTombola();
            const huboCambios = firmaNueva !== firmaRenderActual;
            cacheHidratada = true;

            if (huboCambios) {
                const scrollAnterior = window.scrollY;
                renderizar();
                firmaRenderActual = firmaNueva;
                guardarCache();
                if (scrollAnterior > 0) {
                    requestAnimationFrame(() => window.scrollTo(0, scrollAnterior));
                }
            }

            estadoSync('● Sincronizado');
        } catch (error) {
            console.warn('[TÓMBOLA LIGERA] No se pudo repintar el marcador:', error);
        }
    }

    async function refrescarManosPendientes(db) {
        if (refrescoManosEnCurso || !db || navigator.onLine === false) return;

        const activas = idsMesasTombolaActivas();
        if (!activas.length) {
            mesasPendientes.clear();
            return;
        }

        const activasSet = new Set(activas);
        let ids = [...mesasPendientes].filter(id => activasSet.has(String(id)));
        mesasPendientes.clear();

        // Si el evento no trajo mesa_id (por ejemplo cierto DELETE), refrescamos
        // únicamente las mesas que pertenecen a la jornada activa.
        if (!ids.length) ids = activas;

        refrescoManosEnCurso = true;
        try {
            const { data, error } = await db
                .from('manos')
                .select('id,mesa_id,puntos_pareja1,puntos_pareja2,anulada,created_at,creado_en')
                .in('mesa_id', ids)
                .order('created_at', { ascending: true });

            if (error) throw error;

            const idsSet = new Set(ids.map(String));
            const conservadas = (manosActuales || []).filter(
                mano => !idsSet.has(String(mano?.mesa_id || ''))
            );
            const nuevas = Array.isArray(data) ? data : [];

            manosActuales = [...conservadas, ...nuevas].sort((a, b) => {
                const dif = fechaMano(a) - fechaMano(b);
                if (dif !== 0) return dif;
                return String(a?.id || '').localeCompare(String(b?.id || ''));
            });

            aplicarRenderLigero();
        } catch (error) {
            console.warn('[TÓMBOLA LIGERA] Falló el refresco de manos; se usa sincronización completa:', error);
            if (typeof fallbackCompletoManos === 'function') {
                fallbackCompletoManos();
            }
        } finally {
            refrescoManosEnCurso = false;

            // Si entró otra mano mientras consultábamos, procesamos el lote nuevo.
            if (mesasPendientes.size) {
                clearTimeout(timerManos);
                timerManos = setTimeout(() => refrescarManosPendientes(db), RETARDO_MANOS_MS);
            }
        }
    }

    function programarRefrescoMano(db, payload) {
        const activas = idsMesasTombolaActivas();
        if (!activas.length) return;

        const mesaId = mesaIdEvento(payload);
        if (mesaId) {
            const id = String(mesaId);
            if (!activas.includes(id)) {
                // Una mano de una mesa ajena a la jornada no obliga a recargar
                // perfiles, sesión, inscripciones ni marcadores de Tómbola.
                return;
            }
            mesasPendientes.add(id);
        }

        clearTimeout(timerManos);
        timerManos = setTimeout(() => refrescarManosPendientes(db), RETARDO_MANOS_MS);
    }

    function instalarIntercepcionRealtime(db) {
        if (!db || db.__tombolaRealtimeLigeroInstalado) return;

        const channelOriginal = db.channel.bind(db);

        db.channel = function (nombreCanal, opciones) {
            const canal = channelOriginal(nombreCanal, opciones);
            if (nombreCanal !== 'tombola-compartida' || !canal?.on) return canal;

            const onOriginal = canal.on.bind(canal);
            canal.on = function (tipo, filtro, callback) {
                const esMano = tipo === 'postgres_changes' && filtro?.table === 'manos';
                if (!esMano) return onOriginal(tipo, filtro, callback);

                fallbackCompletoManos = callback;
                return onOriginal(tipo, filtro, payload => programarRefrescoMano(db, payload));
            };

            return canal;
        };

        try {
            Object.defineProperty(db, '__tombolaRealtimeLigeroInstalado', {
                value: true,
                configurable: true
            });
        } catch (_) {
            db.__tombolaRealtimeLigeroInstalado = true;
        }
    }

    function instalar() {
        const db = clienteActual();
        if (!db) return;

        instalarIntercepcionRealtime(db);
        window.TombolaPerformanceRuntime = {
            version: 1,
            refrescoManosMs: RETARDO_MANOS_MS,
            soloMesasDeJornada: true
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
