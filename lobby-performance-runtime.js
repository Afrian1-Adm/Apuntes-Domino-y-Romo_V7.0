(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'lobby.html') return;
    if (window.LobbyPerformanceRuntime) return;

    const FALLBACK_CLASIFICATORIA_MS = 30000;
    let timerClasificatoria = null;
    let canalResumen = null;

    function clienteActual() {
        return window.supabaseClient || null;
    }

    function asignarEstado(nombre, valor) {
        try {
            switch (nombre) {
                case 'cachePerfiles': cachePerfiles = valor; break;
                case 'cacheManos': cacheManos = valor; break;
                case 'cacheMesasCerradas': cacheMesasCerradas = valor; break;
                case 'firmaClasificatoriaLobby': firmaClasificatoriaLobby = valor; break;
                case 'firmaMesasLobby': firmaMesasLobby = valor; break;
                case 'cargandoMesasEnVivo': cargandoMesasEnVivo = valor; break;
                default: window[nombre] = valor;
            }
        } catch (_) {
            window[nombre] = valor;
        }
    }

    function leerEstado(nombre, fallback) {
        try {
            switch (nombre) {
                case 'firmaClasificatoriaLobby': return firmaClasificatoriaLobby;
                case 'firmaMesasLobby': return firmaMesasLobby;
                case 'cargandoMesasEnVivo': return cargandoMesasEnVivo;
                default: return window[nombre] ?? fallback;
            }
        } catch (_) {
            return window[nombre] ?? fallback;
        }
    }

    function manosSinteticas(score1, score2, rondas, fecha) {
        const cantidad = Math.max(0, Number(rondas) || 0);
        if (!cantidad) return [];

        const salida = Array.from({ length: cantidad }, () => ({
            puntos_pareja1: 0,
            puntos_pareja2: 0,
            anulada: false,
            created_at: fecha || null,
            __resumen: true
        }));
        const ultima = salida[salida.length - 1];
        ultima.puntos_pareja1 = Number(score1) || 0;
        ultima.puntos_pareja2 = Number(score2) || 0;
        return salida;
    }

    function mapearMesaViva(r) {
        const fecha = r.created_at || r.creado_en || null;
        return {
            id: r.id,
            created_at: fecha,
            creado_en: r.creado_en || fecha,
            estado: 'abierta',
            limite_puntos: Number(r.limite_puntos || 200),
            jugador1_id: r.jugador1_id,
            jugador2_id: r.jugador2_id,
            jugador3_id: r.jugador3_id,
            jugador4_id: r.jugador4_id,
            cuenta_tabla_general: r.cuenta_tabla_general !== false,
            torneo_v2_id: r.torneo_v2_id || null,
            j1: { username: r.j1_username, nombre_completo: r.j1_nombre_completo },
            j2: { username: r.j2_username, nombre_completo: r.j2_nombre_completo },
            j3: { username: r.j3_username, nombre_completo: r.j3_nombre_completo },
            j4: { username: r.j4_username, nombre_completo: r.j4_nombre_completo },
            manos: manosSinteticas(r.score_p1, r.score_p2, r.rondas, fecha),
            __resumen_servidor: true
        };
    }

    function mapearPartidaCerrada(r) {
        const fecha = r.created_at || null;
        return {
            id: r.id,
            created_at: fecha,
            estado: 'cerrada',
            jugador1_id: r.jugador1_id,
            jugador2_id: r.jugador2_id,
            jugador3_id: r.jugador3_id,
            jugador4_id: r.jugador4_id,
            cuenta_tabla_general: r.cuenta_tabla_general !== false,
            torneo_v2_id: r.torneo_v2_id || null,
            rondas: Number(r.rondas || 0),
            manos: manosSinteticas(r.score_p1, r.score_p2, r.rondas, fecha),
            __resumen_servidor: true
        };
    }

    function instalar() {
        const db = clienteActual();
        const originalMesas = window.cargarMesasActivas;
        const originalClasificatoria = window.inicializarDatosClasificatoria;

        if (!db || typeof originalMesas !== 'function' || typeof originalClasificatoria !== 'function') {
            return;
        }

        const cargarMesasCompactas = async function () {
            const contenedor = document.getElementById('lista-mesas');
            if (!contenedor || leerEstado('cargandoMesasEnVivo', false)) return;

            if (!window.__lobbyMesasCacheHidratada) {
                window.__lobbyMesasCacheHidratada = true;
                try {
                    const raw = localStorage.getItem('cache_mesas_activas');
                    const cached = raw ? JSON.parse(raw) : null;
                    if (Array.isArray(cached)) {
                        if (typeof renderizarListaMesas === 'function') renderizarListaMesas(cached, contenedor);
                        if (typeof actualizarBadgingApp === 'function') actualizarBadgingApp(cached.length);
                        if (typeof firmaDatosLobby === 'function') asignarEstado('firmaMesasLobby', firmaDatosLobby(cached));
                    }
                } catch (_) {}
            }

            asignarEstado('cargandoMesasEnVivo', true);
            try {
                const { data, error } = await db
                    .from('vw_lobby_mesas_activas_resumen')
                    .select('*')
                    .order('created_at', { ascending: true });

                if (error) throw error;
                const mesas = (data || []).map(mapearMesaViva);
                const firmaNueva = typeof firmaDatosLobby === 'function' ? firmaDatosLobby(mesas) : JSON.stringify(mesas);

                if (firmaNueva !== leerEstado('firmaMesasLobby', '')) {
                    try { localStorage.setItem('cache_mesas_activas', JSON.stringify(mesas)); } catch (_) {}
                    if (typeof renderizarListaMesas === 'function') renderizarListaMesas(mesas, contenedor);
                    if (typeof actualizarBadgingApp === 'function') actualizarBadgingApp(mesas.length);
                    asignarEstado('firmaMesasLobby', firmaNueva);
                } else if (typeof actualizarEstadoMesaJugadorLobby === 'function') {
                    actualizarEstadoMesaJugadorLobby(mesas);
                }
            } catch (error) {
                console.warn('[LOBBY COMPACTO] Fallback a mesas completas:', error);
                return originalMesas.apply(this, arguments);
            } finally {
                asignarEstado('cargandoMesasEnVivo', false);
            }
        };
        cargarMesasCompactas.__resumenServidor = true;
        window.cargarMesasActivas = cargarMesasCompactas;

        const cargarClasificatoriaCompacta = async function (esSilencioso = false) {
            try {
                const [perfilesRes, partidasRes] = await Promise.all([
                    db.from('perfiles').select('id,nombre_completo,username,rol,fecha_nacimiento,estado'),
                    db.from('vw_lobby_partidas_resumen')
                        .select('id,created_at,estado,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,score_p1,score_p2,rondas')
                        .order('created_at', { ascending: true })
                ]);

                if (perfilesRes.error) throw perfilesRes.error;
                if (partidasRes.error) throw partidasRes.error;

                const perfiles = perfilesRes.data || [];
                const mesasCerradas = (partidasRes.data || []).map(mapearPartidaCerrada);
                const cacheCompacta = { perfiles, manos: [], mesasCerradas };
                const firmaNueva = typeof firmaDatosLobby === 'function'
                    ? firmaDatosLobby(cacheCompacta)
                    : JSON.stringify(cacheCompacta);

                if (firmaNueva === leerEstado('firmaClasificatoriaLobby', '') && esSilencioso) return;

                asignarEstado('cachePerfiles', perfiles);
                asignarEstado('cacheManos', []);
                asignarEstado('cacheMesasCerradas', mesasCerradas);
                asignarEstado('firmaClasificatoriaLobby', firmaNueva);

                try { localStorage.setItem('cache_index_general_datos', JSON.stringify(cacheCompacta)); } catch (_) {}

                const periodo = document.getElementById('filtro-periodo')?.value;
                const desde = document.getElementById('filtro-desde')?.value;
                if (periodo === 'personalizado' && !desde && typeof cambiarPeriodoRapido === 'function') {
                    cambiarPeriodoRapido('semana_actual');
                } else if (typeof aplicarFiltrosClasificatoria === 'function') {
                    aplicarFiltrosClasificatoria();
                }

                if (typeof calcularJugadorOnFire === 'function') calcularJugadorOnFire();
                if (typeof verificarCumpleanosClub === 'function') verificarCumpleanosClub();
            } catch (error) {
                console.warn('[LOBBY COMPACTO] Fallback a clasificación completa:', error);
                return originalClasificatoria.apply(this, arguments);
            }
        };
        cargarClasificatoriaCompacta.__resumenServidor = true;
        window.inicializarDatosClasificatoria = cargarClasificatoriaCompacta;

        // El listener histórico de manos sigue llamando esta función. En vez de
        // descargar perfiles + historial tras cada mano, queda como respaldo
        // espaciado. La actualización inmediata llega por partidas_resumen.
        window.programarActualizacionClasificatoria = function () {
            clearTimeout(timerClasificatoria);
            timerClasificatoria = setTimeout(() => cargarClasificatoriaCompacta(true), FALLBACK_CLASIFICATORIA_MS);
        };
        window.programarActualizacionClasificatoria.__resumenServidor = true;

        try {
            canalResumen = db
                .channel('lobby-resumen-compacto')
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'partidas_resumen'
                }, () => {
                    clearTimeout(timerClasificatoria);
                    cargarClasificatoriaCompacta(true);
                })
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'perfiles'
                }, () => {
                    clearTimeout(timerClasificatoria);
                    cargarClasificatoriaCompacta(true);
                })
                .subscribe();
        } catch (error) {
            console.warn('[LOBBY COMPACTO] Realtime de resúmenes no disponible:', error);
        }

        window.LobbyPerformanceRuntime = {
            version: 1,
            vistaMesas: 'vw_lobby_mesas_activas_resumen',
            vistaPartidas: 'vw_lobby_partidas_resumen',
            fallbackClasificatoriaMs: FALLBACK_CLASIFICATORIA_MS
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
