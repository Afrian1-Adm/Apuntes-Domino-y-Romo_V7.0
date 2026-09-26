(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'admin.html') return;
    if (window.AdminSummaryRuntime) return;
    window.AdminSummaryRuntime = { version: 1 };

    const CAMPOS_RESUMEN = 'mesa_id,mesa_created_at,fecha_final,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id,puntos_pareja1,puntos_pareja2,rondas,ganador,es_lisa,diferencial,clutch_winner_team';

    function clienteActual() {
        return window.supabaseClient || null;
    }

    function asignarGlobal(nombre, valor) {
        try {
            switch (nombre) {
                case 'cachePartidasCerradas': cachePartidasCerradas = valor; break;
                case 'cachePuntosMesas': cachePuntosMesas = valor; break;
                case 'cacheMesasActivas': cacheMesasActivas = valor; break;
                default: window[nombre] = valor;
            }
        } catch (_) {
            window[nombre] = valor;
        }
    }

    function leerCacheMesas() {
        try {
            return cacheMesas || {};
        } catch (_) {
            return window.cacheMesas || {};
        }
    }

    async function cargarManosPorMesas(cliente, idsMesas) {
        if (!Array.isArray(idsMesas) || idsMesas.length === 0) return [];

        const salida = [];
        const TAMANO_LOTE = 80;
        for (let i = 0; i < idsMesas.length; i += TAMANO_LOTE) {
            const lote = idsMesas.slice(i, i + TAMANO_LOTE);
            const { data, error } = await cliente
                .from('manos')
                .select('id,mesa_id,puntos_pareja1,puntos_pareja2,anulada,created_at,fecha_hora')
                .in('mesa_id', lote)
                .eq('anulada', false)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true });
            if (error) throw error;
            salida.push(...(data || []));
        }
        return salida;
    }

    function convertirResumenAPartida(resumen, mesasCache) {
        const mesaBase = mesasCache?.[resumen.mesa_id] || {};
        const mesa = {
            ...mesaBase,
            id: resumen.mesa_id,
            created_at: resumen.mesa_created_at || mesaBase.created_at || resumen.fecha_final,
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
            created_at: resumen.fecha_final || resumen.mesa_created_at || null,
            finalizada: true,
            ganador: Number(resumen.ganador || 0),
            es_lisa: resumen.es_lisa === true,
            diferencial: Number(resumen.diferencial || 0),
            clutch_winner_team: Number(resumen.clutch_winner_team || 0),
            manos_ids: [],
            __manos_cargadas: false
        };
    }

    function instalar() {
        const cliente = clienteActual();
        const originalHistorial = window.cargarHistorialCerradoAdmin;
        const originalMesasDetalladas = window.cargarMesasDetalladas;
        const originalEditar = window.abrirModalEditar;

        if (!cliente || typeof originalHistorial !== 'function' || typeof originalMesasDetalladas !== 'function' || typeof originalEditar !== 'function') {
            return;
        }

        const cargarHistorialResumen = async function () {
            const { data, error } = await cliente
                .from('partidas_resumen')
                .select(CAMPOS_RESUMEN)
                .order('fecha_final', { ascending: false })
                .order('mesa_id', { ascending: false });

            if (error) {
                console.warn('[ADMIN RESUMEN] Se usa temporalmente el historial por manos:', error);
                return originalHistorial();
            }

            const mesasCache = leerCacheMesas();
            const partidas = (data || []).map(r => convertirResumenAPartida(r, mesasCache));
            asignarGlobal('cachePartidasCerradas', partidas);

            try {
                const compactas = partidas.map(({ manos_ids, __manos_cargadas, ...resto }) => ({ ...resto, manos_ids: [] }));
                localStorage.setItem('domino_cache_admin_historial_v1', JSON.stringify(compactas));
            } catch (errorCache) {
                console.warn('[ADMIN RESUMEN] No se pudo guardar la caché compacta:', errorCache);
            }

            if (typeof renderizarHistorialLocal === 'function') renderizarHistorialLocal();
        };
        cargarHistorialResumen.__resumenServidor = true;
        window.cargarHistorialCerradoAdmin = cargarHistorialResumen;

        const cargarMesasActivasResumen = async function () {
            try {
                const [mesasRes, resumenRes] = await Promise.all([
                    cliente.from('mesas').select('*').order('creado_en', { ascending: false }),
                    cliente
                        .from('partidas_resumen')
                        .select('mesa_id,puntos_pareja1,puntos_pareja2')
                ]);

                if (mesasRes.error) throw mesasRes.error;
                if (resumenRes.error) throw resumenRes.error;

                const mesas = mesasRes.data || [];
                const resumenes = resumenRes.data || [];
                const finalizadas = new Set(resumenes.map(r => r.mesa_id));
                const candidatas = mesas.filter(m => !finalizadas.has(m.id));
                const manos = await cargarManosPorMesas(cliente, candidatas.map(m => m.id));

                const puntosPorMesa = {};
                resumenes.forEach(r => {
                    puntosPorMesa[r.mesa_id] = {
                        pts1: Number(r.puntos_pareja1 || 0),
                        pts2: Number(r.puntos_pareja2 || 0)
                    };
                });
                manos.forEach(mano => {
                    if (!puntosPorMesa[mano.mesa_id]) puntosPorMesa[mano.mesa_id] = { pts1: 0, pts2: 0 };
                    puntosPorMesa[mano.mesa_id].pts1 += Number(mano.puntos_pareja1 || 0);
                    puntosPorMesa[mano.mesa_id].pts2 += Number(mano.puntos_pareja2 || 0);
                });

                const mesasActivas = candidatas.filter(mesa => {
                    const limite = Number(mesa.limite_puntos || 200);
                    const pts = puntosPorMesa[mesa.id] || { pts1: 0, pts2: 0 };
                    return pts.pts1 < limite && pts.pts2 < limite;
                });

                asignarGlobal('cachePuntosMesas', puntosPorMesa);
                asignarGlobal('cacheMesasActivas', mesasActivas);

                try {
                    localStorage.setItem('domino_cache_mesas_activas', JSON.stringify(mesasActivas));
                    localStorage.setItem('domino_cache_puntos_mesas', JSON.stringify(puntosPorMesa));
                } catch (_) {}

                if (typeof renderizarMesasActivasLocales === 'function') renderizarMesasActivasLocales();
            } catch (error) {
                console.warn('[ADMIN RESUMEN] Se usa temporalmente la carga completa de mesas:', error);
                return originalMesasDetalladas();
            }
        };
        cargarMesasActivasResumen.__resumenServidor = true;
        window.cargarMesasDetalladas = cargarMesasActivasResumen;

        window.abrirModalEditar = async function (mesaId) {
            let partida = null;
            try {
                partida = cachePartidasCerradas.find(p => p.mesa_id === mesaId);
            } catch (_) {}
            if (!partida) return originalEditar.call(this, mesaId);

            if (partida.__manos_cargadas !== true) {
                const { data, error } = await cliente
                    .from('manos')
                    .select('*')
                    .eq('mesa_id', mesaId)
                    .eq('anulada', false)
                    .order('created_at', { ascending: true })
                    .order('id', { ascending: true });

                if (error) {
                    console.error('[ADMIN RESUMEN] Error cargando rondas de la partida:', error);
                    if (typeof mostrarError === 'function') {
                        mostrarError('No se pudieron cargar las rondas de esta partida: ' + error.message);
                    } else {
                        alert('No se pudieron cargar las rondas de esta partida.');
                    }
                    return;
                }

                partida.manos_ids = data || [];
                partida.__manos_cargadas = true;
            }

            return originalEditar.call(this, mesaId);
        };
        window.abrirModalEditar.__cargaBajoDemanda = true;

        // Mantiene la vista administrativa fresca sin volver a descargar el
        // historial completo. Las manos solo refrescan el bloque de mesas activas.
        let timerHistorial = null;
        let timerMesas = null;
        try {
            cliente
                .channel('admin-partidas-resumen')
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'partidas_resumen'
                }, () => {
                    clearTimeout(timerHistorial);
                    clearTimeout(timerMesas);
                    timerHistorial = setTimeout(() => cargarHistorialResumen(), 250);
                    timerMesas = setTimeout(() => cargarMesasActivasResumen(), 300);
                })
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'manos'
                }, () => {
                    clearTimeout(timerMesas);
                    timerMesas = setTimeout(() => cargarMesasActivasResumen(), 350);
                })
                .subscribe();
        } catch (errorRealtime) {
            console.warn('[ADMIN RESUMEN] Realtime no disponible:', errorRealtime);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
