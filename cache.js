// ==========================================
// HELPER UNIVERSAL DE CACHÉ (Stale-While-Revalidate)
// ==========================================
async function cargarConCache(cacheKey, fetchFunction, renderFunction) {
    const datosGuardados = localStorage.getItem(cacheKey);
    let firmaGuardada = datosGuardados || '';
    if (datosGuardados) {
        try {
            const parsedData = JSON.parse(datosGuardados);
            renderFunction(parsedData, true);
        } catch (e) {
            console.error("Error al parsear el caché:", e);
        }
    }

    if (navigator.onLine === false) return;

    try {
        const freshData = await fetchFunction();
        if (freshData !== null && freshData !== undefined) {
            const firmaNueva = JSON.stringify(freshData);
            localStorage.setItem(cacheKey, firmaNueva);
            if (firmaNueva !== firmaGuardada) {
                renderFunction(freshData, false);
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
            return new Set(Array.isArray(mesas) ? mesas.map(m => m?.id).filter(Boolean) : []);
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
                supabase.from('perfiles').select('id,nombre_completo,username,rol,fecha_nacimiento,estado'),
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
        inicializarDatosClasificatoria = cargarClasificatoriaResumida;
        programarActualizacionClasificatoria = programarActualizacionResumida;

        if (typeof cargarMesasActivas === 'function' && !cargarMesasActivas.__perfResumen) {
            const originalCargarMesas = cargarMesasActivas;
            const envuelta = async function (...args) {
                const resultado = await originalCargarMesas.apply(this, args);
                const idsNuevos = leerIdsMesasActivasCache();
                const cambioConjunto = !mismosIds(idsMesasPrevias, idsNuevos);
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();

// ============================================================
// CONSULTAS — PARTIDAS RESUMIDAS EN EL SERVIDOR
// ============================================================
(function instalarConsultasDesdeResumenServidor() {
    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'consultas.html') return;

    function convertirResumenAPartida(resumen) {
        const fecha = resumen?.fecha_final || resumen?.mesa_created_at || null;
        const t1 = [resumen?.jugador1_id, resumen?.jugador3_id].filter(Boolean);
        const t2 = [resumen?.jugador2_id, resumen?.jugador4_id].filter(Boolean);
        if (t1.length !== 2 || t2.length !== 2 || new Set([...t1, ...t2]).size !== 4) return null;
        return {
            mesaId: resumen.mesa_id,
            timestamp: fecha ? new Date(fecha).getTime() : 0,
            fecha_hora: fecha,
            t1,
            t2,
            pts1: Number(resumen.puntos_pareja1 || 0),
            pts2: Number(resumen.puntos_pareja2 || 0),
            ganador: Number(resumen.ganador || 0),
            esLisa: resumen.es_lisa === true,
            clutchWinnerTeam: Number(resumen.clutch_winner_team || 0)
        };
    }

    function instalar() {
        const originalDatos = typeof window.obtenerDatosConsultas === 'function' ? window.obtenerDatosConsultas : null;
        const originalAplicar = typeof window.aplicarDatosConsultas === 'function' ? window.aplicarDatosConsultas : null;
        const originalAgrupar = typeof window.obtenerPartidasAgrupadas === 'function' ? window.obtenerPartidasAgrupadas : null;
        if (!originalDatos || !originalAplicar || !originalAgrupar || originalDatos.__resumenServidor) return;

        const cliente = window.supabaseClient;
        if (!cliente) return;

        const obtenerDatosResumidos = async function () {
            const [perfilesRes, partidasRes] = await Promise.all([
                cliente.from('perfiles').select('*'),
                cliente
                    .from('partidas_resumen')
                    .select('mesa_id,mesa_created_at,fecha_final,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,puntos_pareja1,puntos_pareja2,rondas,ganador,es_lisa,diferencial,clutch_winner_team')
                    .eq('cuenta_tabla_general', true)
                    .order('fecha_final', { ascending: true })
                    .order('mesa_id', { ascending: true })
            ]);
            if (perfilesRes.error) throw perfilesRes.error;
            if (partidasRes.error) {
                console.warn('[RESUMEN] Consultas vuelve temporalmente a manos crudas:', partidasRes.error);
                return originalDatos();
            }
            return { perfiles: perfilesRes.data || [], partidasResumen: partidasRes.data || [] };
        };
        obtenerDatosResumidos.__resumenServidor = true;

        const aplicarDatosResumidos = function (datos) {
            if (!Array.isArray(datos?.partidasResumen)) {
                window._partidasResumenGlobal = null;
                return originalAplicar(datos);
            }
            const perfiles = Array.isArray(datos?.perfiles) ? datos.perfiles : [];
            window._perfilesGlobal = perfiles;
            window._manosGlobal = [];
            window._partidasResumenGlobal = datos.partidasResumen;
            if (typeof window.inicializarSelectores === 'function') window.inicializarSelectores(perfiles, []);
        };

        const obtenerPartidasResumidas = function () {
            const resumenes = window._partidasResumenGlobal;
            if (!Array.isArray(resumenes)) return originalAgrupar();
            return resumenes.map(convertirResumenAPartida).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
        };

        window.obtenerDatosConsultas = obtenerDatosResumidos;
        window.aplicarDatosConsultas = aplicarDatosResumidos;
        window.obtenerPartidasAgrupadas = obtenerPartidasResumidas;

        let timer = null;
        try {
            cliente
                .channel('consultas-partidas-resumen')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'partidas_resumen' }, () => {
                    clearTimeout(timer);
                    timer = setTimeout(async () => {
                        try {
                            const datos = await obtenerDatosResumidos();
                            aplicarDatosResumidos(datos);
                            localStorage.setItem('cache_consultas_historicas_v2', JSON.stringify(datos));
                        } catch (error) {
                            console.warn('[RESUMEN] No se pudo refrescar Consultas:', error);
                        }
                    }, 250);
                })
                .subscribe();
        } catch (errorRealtime) {
            console.warn('[RESUMEN] Realtime de Consultas no disponible:', errorRealtime);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
    else instalar();
})();

// ============================================================
// GALARDONES — UNA FILA POR PARTIDA
// ============================================================
(function instalarGalardonesDesdeResumenServidor() {
    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'galardones.html') return;

    function resumenAMano(resumen) {
        const fecha = resumen.fecha_final || resumen.mesa_created_at;
        const mesa = {
            id: resumen.mesa_id,
            created_at: resumen.mesa_created_at || fecha,
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
            id: `resumen:${resumen.mesa_id}`,
            mesa_id: resumen.mesa_id,
            puntos_pareja1: Number(resumen.puntos_pareja1 || 0),
            puntos_pareja2: Number(resumen.puntos_pareja2 || 0),
            anulada: false,
            created_at: fecha,
            fecha_hora: fecha,
            ganador_pareja: Number(resumen.ganador || 0),
            clutch_winner_team: Number(resumen.clutch_winner_team || 0),
            mesas: mesa
        };
    }

    function renderizarClutchDesdeResumen(perfiles, resumenes) {
        const tbody = document.getElementById('cuerpo-ranking-clutch');
        if (!tbody) return;
        const elegibles = new Set((perfiles || [])
            .filter(p => p.es_jugador === true || p.es_jugador === 1 || ['jugador','admin','super_admin'].includes(p.rol))
            .map(p => String(p.id)));
        const nombres = new Map((perfiles || []).map(p => [String(p.id), p.username || p.nombre_completo || 'Jugador']));
        const conteo = new Map();

        (resumenes || []).forEach(r => {
            const team = Number(r.clutch_winner_team || 0);
            if (team !== 1 && team !== 2) return;
            const ids = team === 1 ? [r.jugador1_id, r.jugador3_id] : [r.jugador2_id, r.jugador4_id];
            ids.forEach(id => {
                const key = String(id || '');
                if (!elegibles.has(key)) return;
                conteo.set(key, (conteo.get(key) || 0) + 1);
            });
        });

        const lista = [...conteo.entries()]
            .map(([id, remontadas]) => ({ jugador: nombres.get(id) || 'Jugador', remontadas }))
            .sort((a, b) => b.remontadas - a.remontadas || a.jugador.localeCompare(b.jugador, 'es'));

        if (!lista.length) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 12px 0;">No hay registros de remontadas épicas.</td></tr>';
            return;
        }

        tbody.innerHTML = lista.map((item, idx) => {
            const badgeClass = idx === 0 ? 'badge-oro' : idx === 1 ? 'badge-plata' : idx === 2 ? 'badge-bronce' : '';
            return `<tr>
                <td style="text-align: center;" class="${badgeClass}">${idx + 1}°</td>
                <td style="font-weight: bold;">${item.jugador}</td>
                <td style="text-align: right; font-weight: 900; color: var(--accent-amber);">${item.remontadas} remontada${item.remontadas > 1 ? 's' : ''}</td>
            </tr>`;
        }).join('');
    }

    function instalar() {
        const originalDatos = typeof window.obtenerDatosGalardones === 'function' ? window.obtenerDatosGalardones : null;
        const originalProcesar = typeof window.procesarYRenderizarGalardones === 'function' ? window.procesarYRenderizarGalardones : null;
        if (!originalDatos || !originalProcesar || originalDatos.__resumenServidor) return;
        const cliente = window.supabaseClient;
        if (!cliente) return;

        const obtenerDatosResumidos = async function () {
            const [perfilesRes, partidasRes, parejasRes] = await Promise.all([
                cliente.from('perfiles').select('*'),
                cliente
                    .from('partidas_resumen')
                    .select('mesa_id,mesa_created_at,fecha_final,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,puntos_pareja1,puntos_pareja2,rondas,ganador,es_lisa,diferencial,clutch_winner_team')
                    .eq('cuenta_tabla_general', true)
                    .order('fecha_final', { ascending: true }),
                cliente.from('v_top_10_parejas').select('*')
            ]);
            if (perfilesRes.error) throw perfilesRes.error;
            if (partidasRes.error) {
                console.warn('[RESUMEN] Galardones vuelve temporalmente a manos crudas:', partidasRes.error);
                return originalDatos();
            }
            const resumenes = partidasRes.data || [];
            window._galardonesResumenGlobal = resumenes;
            return {
                perfiles: perfilesRes.data || [],
                manos: resumenes.map(resumenAMano),
                diferencialView: null,
                topParejasView: parejasRes.error ? null : parejasRes.data,
                topRachasView: null,
                jugadorSemanaView: null
            };
        };
        obtenerDatosResumidos.__resumenServidor = true;

        const procesarResumido = function (perfiles, manos, diferencialView, topParejasView, topRachasView, jugadorSemanaView) {
            const resultado = originalProcesar.call(this, perfiles, manos, diferencialView, topParejasView, topRachasView, jugadorSemanaView);
            if (Array.isArray(window._galardonesResumenGlobal)) {
                renderizarClutchDesdeResumen(perfiles, window._galardonesResumenGlobal);
            }
            return resultado;
        };

        window.obtenerDatosGalardones = obtenerDatosResumidos;
        window.procesarYRenderizarGalardones = procesarResumido;

        // La página antigua escucha manos y mesas. Remapeamos solamente ese
        // canal concreto: una partida resumida cambia una sola vez al cerrar o corregirse.
        if (!cliente.__galardonesResumenChannel) {
            const channelOriginal = cliente.channel.bind(cliente);
            cliente.channel = function (nombre, ...args) {
                const canal = channelOriginal(nombre, ...args);
                if (nombre !== 'galardones_realtime') return canal;
                const onOriginal = canal.on.bind(canal);
                let resumenRegistrado = false;
                canal.on = function (tipo, filtro, callback) {
                    if (tipo === 'postgres_changes' && (filtro?.table === 'manos' || filtro?.table === 'mesas')) {
                        if (!resumenRegistrado) {
                            resumenRegistrado = true;
                            onOriginal('postgres_changes', { event: '*', schema: 'public', table: 'partidas_resumen' }, callback);
                        }
                        return canal;
                    }
                    return onOriginal(tipo, filtro, callback);
                };
                return canal;
            };
            cliente.__galardonesResumenChannel = true;
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
    else instalar();
})();

// ============================================================
// PERFIL — ESTADÍSTICAS DESDE RESÚMENES DE PARTIDAS
// ============================================================
(function instalarPerfilDesdeResumenServidor() {
    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'perfil.html') return;

    function resumenAMesa(resumen) {
        const fecha = resumen.fecha_final || resumen.mesa_created_at;
        return {
            id: resumen.mesa_id,
            created_at: resumen.mesa_created_at || fecha,
            estado: 'cerrada',
            limite_puntos: Number(resumen.limite_puntos || 200),
            jugador1_id: resumen.jugador1_id,
            jugador2_id: resumen.jugador2_id,
            jugador3_id: resumen.jugador3_id,
            jugador4_id: resumen.jugador4_id,
            cuenta_tabla_general: resumen.cuenta_tabla_general !== false,
            torneo_v2_id: resumen.torneo_v2_id || null,
            manos: [{
                id: `resumen:${resumen.mesa_id}`,
                puntos_pareja1: Number(resumen.puntos_pareja1 || 0),
                puntos_pareja2: Number(resumen.puntos_pareja2 || 0),
                anulada: false,
                fecha_hora: fecha,
                created_at: fecha,
                ganador_pareja: Number(resumen.ganador || 0),
                clutch_winner_team: Number(resumen.clutch_winner_team || 0)
            }]
        };
    }

    function ventanaOnFire(referencia = new Date()) {
        const ahora = new Date(referencia);
        const inicio = new Date(ahora);
        const diasDesdeJueves = (ahora.getDay() - 4 + 7) % 7;
        inicio.setDate(ahora.getDate() - diasDesdeJueves);
        inicio.setHours(8, 0, 0, 0);
        if (ahora < inicio) inicio.setDate(inicio.getDate() - 7);
        const fin = new Date(inicio);
        fin.setDate(fin.getDate() + 1);
        fin.setHours(6, 0, 0, 0);
        return { inicio, fin };
    }

    function instalar() {
        const originalCarga = typeof window.cargarMesasYEstadisticasConCache === 'function'
            ? window.cargarMesasYEstadisticasConCache
            : null;
        if (!originalCarga || originalCarga.__resumenServidor) return;
        const cliente = window.supabaseClient;
        if (!cliente) return;

        const cargarResumen = async function () {
            const cacheKey = 'domino_cache_mesas_manos_' + usuarioIdActual;
            try {
                const { data, error } = await cliente
                    .from('partidas_resumen')
                    .select('mesa_id,mesa_created_at,fecha_final,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,puntos_pareja1,puntos_pareja2,rondas,ganador,es_lisa,diferencial,clutch_winner_team')
                    .eq('cuenta_tabla_general', true)
                    .order('fecha_final', { ascending: true });
                if (error) {
                    console.warn('[RESUMEN] Perfil vuelve temporalmente a mesas+manos:', error);
                    return originalCarga();
                }

                const mesas = (data || []).map(resumenAMesa);
                let firmaMesasGuardada = '';
                try {
                    const cacheAnterior = JSON.parse(localStorage.getItem(cacheKey) || 'null');
                    firmaMesasGuardada = JSON.stringify(cacheAnterior?.mesas || []);
                } catch (_) {}
                const firmaMesasNueva = JSON.stringify(mesas);
                const huboCambios = firmaMesasNueva !== firmaMesasGuardada;

                if (!estadisticasCachePintadas || huboCambios) {
                    localStorage.setItem(cacheKey, JSON.stringify({ mesas, time: Date.now(), fuente: 'partidas_resumen' }));
                    calcularEstadisticasYRanking(mesas, usuarioIdActual);
                    estadisticasCachePintadas = true;
                }

                const cachedPerfilUser = localStorage.getItem('domino_cache_perfil_' + usuarioIdActual);
                if (cachedPerfilUser && huboCambios) {
                    verificarDistintivosPerfil(JSON.parse(cachedPerfilUser), mesas);
                }
            } catch (error) {
                console.warn('[RESUMEN] Error cargando estadísticas de Perfil:', error);
                return originalCarga();
            }
        };
        cargarResumen.__resumenServidor = true;
        window.cargarMesasYEstadisticasConCache = cargarResumen;

        // Corrige la definición histórica del Perfil: On Fire se determina por
        // partidas en la ventana jueves 08:00 → viernes 06:00, mínimo 8 y 75%.
        window.calcularEsOnFireConManos = function (manos, userId) {
            const { inicio, fin } = ventanaOnFire();
            const stats = new Map();
            const perfiles = Array.isArray(window.perfilesDetalle) ? window.perfilesDetalle : [];
            const perfilMap = new Map(perfiles.map(p => [String(p.id), p]));

            const registrar = (id, gano) => {
                if (!id) return;
                const key = String(id);
                if (!stats.has(key)) stats.set(key, { id: key, partidas: 0, vic: 0 });
                const item = stats.get(key);
                item.partidas++;
                if (gano) item.vic++;
            };

            (manos || []).forEach(mano => {
                if (mano?.anulada) return;
                const fecha = new Date(mano?.fecha_hora || mano?.created_at || 0);
                if (Number.isNaN(fecha.getTime()) || fecha < inicio || fecha >= fin) return;
                const mesa = mano?.mesas;
                if (!mesa || mesa.estado !== 'cerrada' || mesa.cuenta_tabla_general === false) return;
                const ganador = Number(mano.ganador_pareja || ((mano.puntos_pareja1 || 0) > (mano.puntos_pareja2 || 0) ? 1 : 2));
                [mesa.jugador1_id, mesa.jugador3_id].forEach(id => registrar(id, ganador === 1));
                [mesa.jugador2_id, mesa.jugador4_id].forEach(id => registrar(id, ganador === 2));
            });

            const candidatos = [...stats.values()]
                .filter(item => {
                    const perfil = perfilMap.get(item.id);
                    if ((perfil?.rol || '').toLowerCase() === 'invitado') return false;
                    return item.partidas >= 8 && item.vic / item.partidas >= 0.75;
                })
                .map(item => ({ ...item, eficiencia: item.vic / item.partidas }))
                .sort((a, b) => b.eficiencia - a.eficiencia || b.partidas - a.partidas || b.vic - a.vic);

            return candidatos.length > 0 && String(candidatos[0].id) === String(userId);
        };

        let timer = null;
        try {
            cliente
                .channel('perfil-partidas-resumen')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'partidas_resumen' }, () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => cargarResumen(), 250);
                })
                .subscribe();
        } catch (_) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
    else instalar();
})();

// ============================================================
// INTEGRACIÓN DEL HISTORIAL LEGADO
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