// ==========================================
// HELPER UNIVERSAL DE CACHÉ (Stale-While-Revalidate)
// ==========================================
async function cargarConCache(cacheKey, fetchFunction, renderFunction) {
    // 1. Mostrar datos guardados en localStorage al INSTANTE
    const datosGuardados = localStorage.getItem(cacheKey);
    let firmaGuardada = datosGuardados || '';
    if (datosGuardados) {
        try {
            const parsedData = JSON.parse(datosGuardados);
            renderFunction(parsedData, true); // true indica que viene del caché
        } catch (e) {
            console.error("Error al parsear el caché:", e);
        }
    }

    // Sin Internet conservamos exactamente la última versión guardada.
    // No intentamos una petición que sabemos que no podrá completarse.
    if (navigator.onLine === false) return;

    // 2. Buscar datos frescos en Supabase en segundo plano
    try {
        const freshData = await fetchFunction();
        if (freshData !== null && freshData !== undefined) {
            const firmaNueva = JSON.stringify(freshData);
            localStorage.setItem(cacheKey, firmaNueva);

            // Conservamos exactamente la vista ya pintada cuando Supabase
            // devuelve los mismos datos. Solo se repinta si hubo un cambio real.
            if (firmaNueva !== firmaGuardada) {
                renderFunction(freshData, false); // false indica que son datos frescos de la BD
                firmaGuardada = firmaNueva;
            }
        }
    } catch (err) {
        console.error(`Error actualizando segundo plano [${cacheKey}]:`, err);
    }
}

// ============================================================
// LOBBY — CARGA ESCALABLE DE CLASIFICATORIA
// ============================================================
// El Lobby antiguo descargaba todas las manos y todas las mesas cada vez que
// Realtime notificaba una mano. Esta capa conserva exactamente los mismos
// cálculos visuales, pero consume una fila resumida por partida cerrada y
// limita la reconstrucción en segundo plano a una vez por minuto, salvo cuando
// cambia el conjunto de mesas activas (inicio/cierre/reapertura).
(function instalarClasificatoriaEscalableLobby() {
    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'lobby.html') return;

    const CACHE_KEY = 'cache_index_general_datos';
    const INTERVALO_MINIMO_MS = 60 * 1000;

    let ultimaActualizacion = 0;
    let temporizador = null;
    let cargaEnCurso = null;
    let idsMesasPrevias = leerIdsMesasActivasCache();
    let primeraCargaMesas = true;

    function leerIdsMesasActivasCache() {
        try {
            const raw = localStorage.getItem('cache_mesas_activas');
            const mesas = raw ? JSON.parse(raw) : [];
            return new Set(
                Array.isArray(mesas)
                    ? mesas.map(m => m?.id).filter(Boolean)
                    : []
            );
        } catch (_) {
            return new Set();
        }
    }

    function mismosIds(a, b) {
        if (a.size !== b.size) return false;
        for (const id of a) if (!b.has(id)) return false;
        return true;
    }

    function convertirPartidasResumen(partidas) {
        return (Array.isArray(partidas) ? partidas : []).map(partida => {
            const puntos1 = Number(partida?.score_p1 || 0);
            const puntos2 = Number(partida?.score_p2 || 0);
            const fecha = partida?.created_at || null;

            return {
                ...partida,
                score_p1: puntos1,
                score_p2: puntos2,
                rondas: Number(partida?.rondas || 0),
                // Las funciones históricas del Lobby esperan mesa.manos para
                // sumar el marcador. Una mano sintética con el total final
                // preserva exactamente victorias, derrotas y filtros sin
                // duplicar miles de manos en memoria/localStorage.
                manos: [{
                    anulada: false,
                    puntos_pareja1: puntos1,
                    puntos_pareja2: puntos2,
                    created_at: fecha
                }]
            };
        });
    }

    function aplicarDatosEnMemoria(perfiles, partidasResumen, guardar = true) {
        const partidas = convertirPartidasResumen(partidasResumen);

        try {
            cachePerfiles = Array.isArray(perfiles) ? perfiles : [];
            cacheManos = [];
            cacheMesasCerradas = partidas;
        } catch (error) {
            console.warn('[PERF] No se pudo hidratar la memoria del Lobby:', error);
            return;
        }

        const cacheCompacta = {
            version: 2,
            perfiles: cachePerfiles,
            manos: [],
            mesasCerradas: partidas
        };

        if (guardar) {
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(cacheCompacta));
            } catch (errorCache) {
                console.warn('[PERF] No se pudo guardar la caché resumida:', errorCache);
            }
        }

        try {
            if (typeof firmaDatosLobby === 'function') {
                firmaClasificatoriaLobby = firmaDatosLobby(cacheCompacta);
            }
        } catch (_) {}

        try {
            const periodoActual = document.getElementById('filtro-periodo')?.value;
            const desdeActual = document.getElementById('filtro-desde')?.value;
            if (periodoActual === 'personalizado' && !desdeActual && typeof cambiarPeriodoRapido === 'function') {
                cambiarPeriodoRapido('semana_actual');
            } else if (typeof aplicarFiltrosClasificatoria === 'function') {
                aplicarFiltrosClasificatoria();
            }
        } catch (errorFiltros) {
            console.warn('[PERF] No se pudo refrescar la clasificatoria:', errorFiltros);
        }

        try {
            if (typeof calcularJugadorOnFire === 'function') calcularJugadorOnFire();
            if (typeof verificarCumpleanosClub === 'function') verificarCumpleanosClub();
        } catch (_) {}
    }

    function hidratarCacheResumida() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return false;
            const cache = JSON.parse(raw);
            if (!cache || cache.version !== 2 || !Array.isArray(cache.mesasCerradas)) return false;
            aplicarDatosEnMemoria(cache.perfiles || [], cache.mesasCerradas, false);
            return true;
        } catch (_) {
            return false;
        }
    }

    async function cargarClasificatoriaResumida(esSilencioso = false) {
        if (!esSilencioso) hidratarCacheResumida();
        if (navigator.onLine === false) return;
        if (cargaEnCurso) return cargaEnCurso;

        cargaEnCurso = (async () => {
            const [respuestaPerfiles, respuestaPartidas] = await Promise.all([
                supabase
                    .from('perfiles')
                    .select('id,nombre_completo,username,rol,fecha_nacimiento,estado'),
                supabase
                    .from('vw_lobby_partidas_resumen')
                    .select('id,created_at,estado,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,score_p1,score_p2,rondas')
                    .order('created_at', { ascending: true })
            ]);

            if (respuestaPartidas.error) {
                console.error('[PERF] Error cargando resumen de partidas:', respuestaPartidas.error);
                return;
            }

            let perfiles = respuestaPerfiles.data;
            if (respuestaPerfiles.error) {
                console.warn('[PERF] No se pudieron refrescar perfiles; se conserva la caché disponible:', respuestaPerfiles.error);
                try { perfiles = cachePerfiles || []; } catch (_) { perfiles = []; }
            }

            aplicarDatosEnMemoria(perfiles || [], respuestaPartidas.data || [], true);
            ultimaActualizacion = Date.now();
        })().finally(() => {
            cargaEnCurso = null;
        });

        return cargaEnCurso;
    }

    function programarActualizacionResumida(forzar = false) {
        if (navigator.onLine === false) return;

        if (forzar) {
            if (temporizador) clearTimeout(temporizador);
            temporizador = setTimeout(async () => {
                temporizador = null;
                await cargarClasificatoriaResumida(true);
            }, 300);
            return;
        }

        // Los eventos de manos son frecuentes. Un único temporizador pendiente
        // absorbe todos los eventos siguientes, en vez de posponer indefinidamente.
        if (temporizador) return;

        const transcurrido = Date.now() - ultimaActualizacion;
        const espera = Math.max(1000, INTERVALO_MINIMO_MS - transcurrido);
        temporizador = setTimeout(async () => {
            temporizador = null;
            await cargarClasificatoriaResumida(true);
        }, espera);
    }

    function instalar() {
        if (typeof inicializarDatosClasificatoria !== 'function') {
            setTimeout(instalar, 50);
            return;
        }

        // Reemplaza únicamente el origen de los datos; filtros/render continúan
        // siendo los del Lobby existente.
        inicializarDatosClasificatoria = cargarClasificatoriaResumida;
        programarActualizacionClasificatoria = programarActualizacionResumida;

        if (typeof cargarMesasActivas === 'function' && !cargarMesasActivas.__perfResumen) {
            const originalCargarMesas = cargarMesasActivas;
            const envuelta = async function (...args) {
                const resultado = await originalCargarMesas.apply(this, args);
                const idsNuevos = leerIdsMesasActivasCache();
                const cambioConjunto = !mismosIds(idsMesasPrevias, idsNuevos);

                // Si desapareció/apareció una mesa después de tener una caché
                // previa, refrescamos inmediatamente. Esto cubre cierre y
                // reapertura sin volver a descargar la clasificación por mano.
                if (cambioConjunto && (!primeraCargaMesas || idsMesasPrevias.size > 0)) {
                    programarActualizacionResumida(true);
                }

                idsMesasPrevias = idsNuevos;
                primeraCargaMesas = false;
                return resultado;
            };
            envuelta.__perfResumen = true;
            cargarMesasActivas = envuelta;
        }
    }

    // cache.js se carga en <head>, antes del script principal del Lobby. Al
    // registrar este listener primero, la sustitución queda instalada antes
    // de que el manejador DOMContentLoaded del Lobby haga su primera consulta.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();

// ============================================================
// INTEGRACIÓN DEL HISTORIAL LEGADO
// Solo debe intervenir en la Tabla General (Lobby) y el Top Anual
// (Galardones). El resto de estadísticas sigue usando únicamente
// las partidas registradas por la app nueva.
// ============================================================
(function cargarIntegracionRankingLegado() {
    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (!['lobby.html', 'galardones.html'].includes(pagina)) return;
    if (document.querySelector('script[data-legacy-ranking="true"]')) return;

    const script = document.createElement('script');
    script.src = 'legacy-ranking.js';
    script.dataset.legacyRanking = 'true';
    document.head.appendChild(script);
})();
