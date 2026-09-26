(function () {
    'use strict';

    if (window.SummaryStatsRuntime) return;
    window.SummaryStatsRuntime = { version: 1 };

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();

    function obtenerCliente() {
        return window.supabaseClient || null;
    }

    function obtenerFechaResumen(resumen) {
        return resumen?.fecha_final || resumen?.mesa_created_at || null;
    }

    function cargarScriptGalardones() {
        function resumenAMano(resumen) {
            const fecha = obtenerFechaResumen(resumen);
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
                mesas: mesa
            };
        }

        function renderizarClutchDesdeResumen(perfiles, resumenes) {
            const tbody = document.getElementById('cuerpo-ranking-clutch');
            if (!tbody) return;

            const elegibles = new Set(
                (perfiles || [])
                    .filter(p =>
                        p.es_jugador === true ||
                        p.es_jugador === 1 ||
                        ['jugador', 'admin', 'super_admin'].includes((p.rol || '').toLowerCase())
                    )
                    .map(p => String(p.id))
            );
            const nombres = new Map(
                (perfiles || []).map(p => [
                    String(p.id),
                    p.username || p.nombre_completo || 'Jugador'
                ])
            );
            const conteo = new Map();

            (resumenes || []).forEach(resumen => {
                const equipo = Number(resumen.clutch_winner_team || 0);
                if (equipo !== 1 && equipo !== 2) return;

                const ids = equipo === 1
                    ? [resumen.jugador1_id, resumen.jugador3_id]
                    : [resumen.jugador2_id, resumen.jugador4_id];

                ids.forEach(id => {
                    const key = String(id || '');
                    if (!elegibles.has(key)) return;
                    conteo.set(key, (conteo.get(key) || 0) + 1);
                });
            });

            const lista = [...conteo.entries()]
                .map(([id, remontadas]) => ({
                    jugador: nombres.get(id) || 'Jugador',
                    remontadas
                }))
                .sort((a, b) =>
                    b.remontadas - a.remontadas ||
                    a.jugador.localeCompare(b.jugador, 'es')
                );

            if (!lista.length) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 12px 0;">No hay registros de remontadas épicas.</td></tr>';
                return;
            }

            tbody.innerHTML = lista.map((item, idx) => {
                const badgeClass = idx === 0
                    ? 'badge-oro'
                    : idx === 1
                        ? 'badge-plata'
                        : idx === 2
                            ? 'badge-bronce'
                            : '';

                return `
                    <tr>
                        <td style="text-align: center;" class="${badgeClass}">${idx + 1}°</td>
                        <td style="font-weight: bold;">${item.jugador}</td>
                        <td style="text-align: right; font-weight: 900; color: var(--accent-amber);">${item.remontadas} remontada${item.remontadas > 1 ? 's' : ''}</td>
                    </tr>
                `;
            }).join('');
        }

        function instalar() {
            const originalDatos = typeof window.obtenerDatosGalardones === 'function'
                ? window.obtenerDatosGalardones
                : null;
            const originalProcesar = typeof window.procesarYRenderizarGalardones === 'function'
                ? window.procesarYRenderizarGalardones
                : null;
            const cliente = obtenerCliente();

            if (!originalDatos || !originalProcesar || !cliente) return;
            if (originalDatos.__resumenServidor) return;

            const obtenerDatosResumidos = async function () {
                const [perfilesRes, partidasRes, parejasRes] = await Promise.all([
                    cliente.from('perfiles').select('*'),
                    cliente
                        .from('partidas_resumen')
                        .select('mesa_id,mesa_created_at,fecha_final,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,puntos_pareja1,puntos_pareja2,rondas,ganador,es_lisa,diferencial,clutch_winner_team')
                        .eq('cuenta_tabla_general', true)
                        .order('fecha_final', { ascending: true })
                        .order('mesa_id', { ascending: true }),
                    cliente.from('v_top_10_parejas').select('*')
                ]);

                if (perfilesRes.error) throw perfilesRes.error;
                if (partidasRes.error) {
                    console.warn('[RESUMEN] Galardones usa temporalmente el historial por manos:', partidasRes.error);
                    window._galardonesResumenGlobal = null;
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

            window.obtenerDatosGalardones = obtenerDatosResumidos;
            window.procesarYRenderizarGalardones = function (
                perfiles,
                manos,
                diferencialView,
                topParejasView,
                topRachasView,
                jugadorSemanaView
            ) {
                const resultado = originalProcesar.call(
                    this,
                    perfiles,
                    manos,
                    diferencialView,
                    topParejasView,
                    topRachasView,
                    jugadorSemanaView
                );

                if (Array.isArray(window._galardonesResumenGlobal)) {
                    renderizarClutchDesdeResumen(perfiles, window._galardonesResumenGlobal);
                }
                return resultado;
            };

            // El código heredado crea un canal con listeners para manos, perfiles
            // y mesas. Para esta pantalla, manos/mesas se sustituyen por un único
            // evento por partida resumida; perfiles se mantiene sin cambios.
            if (!cliente.__galardonesResumenChannel) {
                const channelOriginal = cliente.channel.bind(cliente);
                cliente.channel = function (nombre, ...args) {
                    const canal = channelOriginal(nombre, ...args);
                    if (nombre !== 'galardones_realtime') return canal;

                    const onOriginal = canal.on.bind(canal);
                    let resumenRegistrado = false;

                    canal.on = function (tipo, filtro, callback) {
                        if (
                            tipo === 'postgres_changes' &&
                            (filtro?.table === 'manos' || filtro?.table === 'mesas')
                        ) {
                            if (!resumenRegistrado) {
                                resumenRegistrado = true;
                                onOriginal(
                                    'postgres_changes',
                                    { event: '*', schema: 'public', table: 'partidas_resumen' },
                                    callback
                                );
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

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', instalar, { once: true });
        } else {
            instalar();
        }
    }

    function cargarScriptPerfil() {
        function resumenAMesa(resumen) {
            const fecha = obtenerFechaResumen(resumen);
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
                    ganador_pareja: Number(resumen.ganador || 0)
                }]
            };
        }

        function obtenerVentanaOnFire(referencia = new Date()) {
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
            const cliente = obtenerCliente();

            if (!originalCarga || !cliente) return;
            if (originalCarga.__resumenServidor) return;

            const cargarResumen = async function () {
                let usuarioId;
                let cachePintada;
                try {
                    usuarioId = usuarioIdActual;
                    cachePintada = estadisticasCachePintadas;
                } catch (_) {
                    return originalCarga();
                }

                const cacheKey = 'domino_cache_mesas_manos_' + usuarioId;

                try {
                    const { data, error } = await cliente
                        .from('partidas_resumen')
                        .select('mesa_id,mesa_created_at,fecha_final,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,puntos_pareja1,puntos_pareja2,rondas,ganador,es_lisa,diferencial,clutch_winner_team')
                        .eq('cuenta_tabla_general', true)
                        .order('fecha_final', { ascending: true })
                        .order('mesa_id', { ascending: true });

                    if (error) {
                        console.warn('[RESUMEN] Perfil usa temporalmente mesas+manos:', error);
                        return originalCarga();
                    }

                    const mesas = (data || []).map(resumenAMesa);
                    let firmaGuardada = '';
                    try {
                        const cacheAnterior = JSON.parse(localStorage.getItem(cacheKey) || 'null');
                        firmaGuardada = JSON.stringify(cacheAnterior?.mesas || []);
                    } catch (_) {}

                    const firmaNueva = JSON.stringify(mesas);
                    const huboCambios = firmaNueva !== firmaGuardada;

                    if (!cachePintada || huboCambios) {
                        localStorage.setItem(
                            cacheKey,
                            JSON.stringify({ mesas, time: Date.now(), fuente: 'partidas_resumen' })
                        );
                        calcularEstadisticasYRanking(mesas, usuarioId);
                        try { estadisticasCachePintadas = true; } catch (_) {}
                    }

                    const perfilGuardado = localStorage.getItem('domino_cache_perfil_' + usuarioId);
                    if (perfilGuardado && huboCambios) {
                        verificarDistintivosPerfil(JSON.parse(perfilGuardado), mesas);
                    }
                } catch (error) {
                    console.warn('[RESUMEN] Error cargando estadísticas de Perfil:', error);
                    return originalCarga();
                }
            };
            cargarResumen.__resumenServidor = true;
            window.cargarMesasYEstadisticasConCache = cargarResumen;

            // On Fire oficial: partidas, jueves 08:00 → viernes 06:00,
            // mínimo 8 partidas y 75% de victorias. Invitado no compite.
            window.calcularEsOnFireConManos = function (manos, userId) {
                const { inicio, fin } = obtenerVentanaOnFire();
                const stats = new Map();
                let perfiles = [];
                try {
                    perfiles = Array.isArray(perfilesDetalle) ? perfilesDetalle : [];
                } catch (_) {}
                const perfilMap = new Map(perfiles.map(p => [String(p.id), p]));

                const registrar = (id, gano) => {
                    if (!id) return;
                    const key = String(id);
                    if (!stats.has(key)) {
                        stats.set(key, { id: key, partidas: 0, victorias: 0 });
                    }
                    const item = stats.get(key);
                    item.partidas++;
                    if (gano) item.victorias++;
                };

                (manos || []).forEach(mano => {
                    if (mano?.anulada) return;
                    const fecha = new Date(mano?.fecha_hora || mano?.created_at || 0);
                    if (Number.isNaN(fecha.getTime()) || fecha < inicio || fecha >= fin) return;

                    const mesa = mano?.mesas;
                    if (!mesa || mesa.estado !== 'cerrada' || mesa.cuenta_tabla_general === false) return;

                    const p1 = Number(mano.puntos_pareja1 || 0);
                    const p2 = Number(mano.puntos_pareja2 || 0);
                    const ganador = Number(mano.ganador_pareja || (p1 > p2 ? 1 : p2 > p1 ? 2 : 0));
                    if (ganador !== 1 && ganador !== 2) return;

                    [mesa.jugador1_id, mesa.jugador3_id]
                        .forEach(id => registrar(id, ganador === 1));
                    [mesa.jugador2_id, mesa.jugador4_id]
                        .forEach(id => registrar(id, ganador === 2));
                });

                const candidatos = [...stats.values()]
                    .filter(item => {
                        const perfil = perfilMap.get(item.id);
                        if ((perfil?.rol || '').toLowerCase() === 'invitado') return false;
                        return item.partidas >= 8 && item.victorias / item.partidas >= 0.75;
                    })
                    .map(item => ({
                        ...item,
                        eficiencia: item.victorias / item.partidas
                    }))
                    .sort((a, b) =>
                        b.eficiencia - a.eficiencia ||
                        b.victorias - a.victorias ||
                        b.partidas - a.partidas ||
                        a.id.localeCompare(b.id)
                    );

                return candidatos.length > 0 && String(candidatos[0].id) === String(userId);
            };

            let timer = null;
            try {
                cliente
                    .channel('perfil-partidas-resumen')
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'partidas_resumen' },
                        () => {
                            clearTimeout(timer);
                            timer = setTimeout(() => cargarResumen(), 250);
                        }
                    )
                    .subscribe();
            } catch (errorRealtime) {
                console.warn('[RESUMEN] Realtime de Perfil no disponible:', errorRealtime);
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', instalar, { once: true });
        } else {
            instalar();
        }
    }

    if (pagina === 'galardones.html') cargarScriptGalardones();
    if (pagina === 'perfil.html') cargarScriptPerfil();
})();