// ============================================================
// INTEGRIDAD ESTADISTICA — FUENTE DE VERDAD COMPARTIDA
// ============================================================
(function () {
    'use strict';

    if (window.DominoStatsIntegrity) return;

    const VERSION = '2026-09-26.1';
    const PAGE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

    function fechaValida(valor) {
        if (!valor) return null;
        const fecha = valor instanceof Date ? new Date(valor) : new Date(valor);
        return Number.isNaN(fecha.getTime()) ? null : fecha;
    }

    function fechaMano(mano, mesa = null) {
        return fechaValida(
            mano?.created_at ||
            mano?.creado_en ||
            mano?.fecha_hora ||
            mesa?.created_at ||
            null
        );
    }

    function esMesaValida(mesa) {
        return Boolean(
            mesa &&
            mesa.estado === 'cerrada' &&
            mesa.cuenta_tabla_general !== false
        );
    }

    function equiposMesa(mesa) {
        const t1 = [mesa?.jugador1_id, mesa?.jugador3_id].filter(id => id != null);
        const t2 = [mesa?.jugador2_id, mesa?.jugador4_id].filter(id => id != null);
        if (t1.length !== 2 || t2.length !== 2) return null;
        if (new Set([...t1, ...t2]).size !== 4) return null;
        return { t1, t2 };
    }

    function manosCanonicasDeMesa(mesa, manos) {
        const limite = Math.max(1, Number(mesa?.limite_puntos) || 200);
        const lista = (Array.isArray(manos) ? manos : [])
            .filter(mano => mano && !mano.anulada)
            .sort((a, b) => (fechaMano(a, mesa)?.getTime() || 0) - (fechaMano(b, mesa)?.getTime() || 0));

        const incluidas = [];
        let pts1 = 0;
        let pts2 = 0;
        let amenazaClutch1 = false;
        let amenazaClutch2 = false;

        for (const mano of lista) {
            pts1 += Number(mano.puntos_pareja1) || 0;
            pts2 += Number(mano.puntos_pareja2) || 0;
            incluidas.push(mano);

            // Mantenemos el mismo criterio histórico de clutch.
            if (pts2 >= 180 && pts2 - pts1 >= 100) amenazaClutch1 = true;
            if (pts1 >= 180 && pts1 - pts2 >= 100) amenazaClutch2 = true;

            // Una mesa cerrada representa una sola partida. Si existieran manos
            // posteriores a la decisiva por datos históricos dañados, se ignoran.
            if (pts1 >= limite || pts2 >= limite) break;
        }

        return {
            manos: incluidas,
            pts1,
            pts2,
            limite,
            amenazaClutch1,
            amenazaClutch2
        };
    }

    function construirPartida(mesa, manos) {
        if (!esMesaValida(mesa)) return null;
        const equipos = equiposMesa(mesa);
        if (!equipos) return null;

        const canon = manosCanonicasDeMesa(mesa, manos);
        if (!canon.manos.length) return null;

        const ultima = canon.manos[canon.manos.length - 1];
        let ganador = canon.pts1 > canon.pts2 ? 1 : (canon.pts2 > canon.pts1 ? 2 : 0);
        if (ganador === 0) ganador = Number(ultima?.ganador_pareja) || 0;
        if (ganador !== 1 && ganador !== 2) return null;

        const fecha = fechaMano(ultima, mesa) || fechaValida(mesa.created_at);
        const clutchWinnerTeam = ganador === 1 && canon.amenazaClutch1
            ? 1
            : (ganador === 2 && canon.amenazaClutch2 ? 2 : 0);

        return {
            mesaId: mesa.id || mesa.mesa_id || null,
            mesa,
            t1: equipos.t1,
            t2: equipos.t2,
            eq1: equipos.t1,
            eq2: equipos.t2,
            pts1: canon.pts1,
            pts2: canon.pts2,
            total1: canon.pts1,
            total2: canon.pts2,
            ganador,
            manos: canon.manos,
            listaManos: canon.manos,
            timestamp: fecha?.getTime() || 0,
            fecha_hora: fecha?.toISOString() || null,
            esLisa: ganador === 1 ? canon.pts2 === 0 : canon.pts1 === 0,
            clutchWinnerTeam
        };
    }

    function construirPartidasDesdeManos(manos) {
        const grupos = new Map();

        (Array.isArray(manos) ? manos : []).forEach(mano => {
            if (!mano || mano.anulada) return;
            const mesa = mano.mesas || mano.mesa || null;
            const mesaId = mano.mesa_id || mesa?.id || mesa?.mesa_id;
            if (!mesa || !mesaId || !esMesaValida(mesa)) return;
            if (!grupos.has(mesaId)) grupos.set(mesaId, { mesa, manos: [] });
            grupos.get(mesaId).manos.push(mano);
        });

        return [...grupos.values()]
            .map(item => construirPartida(item.mesa, item.manos))
            .filter(Boolean)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    function construirPartidasDesdeMesas(mesas) {
        return (Array.isArray(mesas) ? mesas : [])
            .filter(esMesaValida)
            .map(mesa => construirPartida(mesa, mesa.manos || []))
            .filter(Boolean)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    function mesasCanonicas(mesas) {
        return construirPartidasDesdeMesas(mesas).map(partida => ({
            ...partida.mesa,
            created_at: partida.fecha_hora || partida.mesa.created_at,
            manos: partida.manos
        }));
    }

    function manosCanonicasConMesasSeparadas(manos, mesas) {
        const mesasPorId = new Map(
            (Array.isArray(mesas) ? mesas : [])
                .filter(esMesaValida)
                .map(mesa => [mesa.id, mesa])
        );
        const grupos = new Map();

        (Array.isArray(manos) ? manos : []).forEach(mano => {
            const mesa = mesasPorId.get(mano?.mesa_id);
            if (!mesa || mano?.anulada) return;
            if (!grupos.has(mesa.id)) grupos.set(mesa.id, { mesa, manos: [] });
            grupos.get(mesa.id).manos.push(mano);
        });

        const salida = [];
        grupos.forEach(({ mesa, manos: lista }) => {
            const partida = construirPartida(mesa, lista);
            if (partida) salida.push(...partida.manos);
        });
        return salida;
    }

    function manosCanonicasAnidadas(manos) {
        const grupos = new Map();
        (Array.isArray(manos) ? manos : []).forEach(mano => {
            if (!mano || mano.anulada) return;
            const mesa = mano.mesas || null;
            const mesaId = mano.mesa_id || mesa?.id;
            if (!mesa || !mesaId || !esMesaValida(mesa)) return;
            if (!grupos.has(mesaId)) grupos.set(mesaId, { mesa, manos: [] });
            grupos.get(mesaId).manos.push(mano);
        });

        const salida = [];
        grupos.forEach(({ mesa, manos: lista }) => {
            const partida = construirPartida(mesa, lista);
            if (!partida) return;
            partida.manos.forEach(mano => salida.push({ ...mano, mesas: mesa }));
        });
        return salida;
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

    function perfilesDisponibles() {
        const candidatos = [];
        if (Array.isArray(window._perfilesGlobal)) candidatos.push(...window._perfilesGlobal);
        try {
            const cache = JSON.parse(localStorage.getItem('cache_index_general_datos') || 'null');
            if (Array.isArray(cache?.perfiles)) candidatos.push(...cache.perfiles);
        } catch (_) {}

        const mapa = new Map();
        candidatos.forEach(p => {
            if (p?.id != null) mapa.set(String(p.id), p);
        });
        return [...mapa.values()];
    }

    function calcularOnFire(partidas, perfiles = perfilesDisponibles(), referencia = new Date()) {
        const { inicio, fin } = obtenerVentanaOnFire(referencia);
        const stats = {};
        const perfilesMap = new Map((perfiles || []).map(p => [String(p.id), p]));

        const registrar = (id, gano) => {
            if (id == null) return;
            const clave = String(id);
            if (!stats[clave]) stats[clave] = { id, partidas: 0, vic: 0 };
            stats[clave].partidas++;
            if (gano) stats[clave].vic++;
        };

        (partidas || []).forEach(partida => {
            const fecha = fechaValida(partida.fecha_hora || partida.timestamp);
            if (!fecha || fecha < inicio || fecha >= fin) return;
            partida.t1.forEach(id => registrar(id, partida.ganador === 1));
            partida.t2.forEach(id => registrar(id, partida.ganador === 2));
        });

        const candidatos = Object.values(stats)
            .filter(item => {
                const perfil = perfilesMap.get(String(item.id));
                if ((perfil?.rol || '').toLowerCase() === 'invitado') return false;
                const eficiencia = item.partidas ? item.vic / item.partidas : 0;
                return item.partidas >= 8 && eficiencia >= 0.75;
            })
            .map(item => ({
                ...item,
                eficiencia: item.partidas ? item.vic / item.partidas : 0,
                nombre: perfilesMap.get(String(item.id))?.username ||
                    perfilesMap.get(String(item.id))?.nombre_completo ||
                    'Jugador'
            }))
            .sort((a, b) =>
                b.eficiencia - a.eficiencia ||
                b.partidas - a.partidas ||
                b.vic - a.vic ||
                String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' })
            );

        return { inicio, fin, stats, candidatos, ganador: candidatos[0] || null };
    }

    function marcarParche(funcion, nombre) {
        try { funcion.__integridadEstadistica = nombre || true; } catch (_) {}
        return funcion;
    }

    function instalarLobby() {
        const original = window.prepararDatosClasificatoria;
        if (typeof original !== 'function' || original.__integridadEstadistica) return;

        window.prepararDatosClasificatoria = marcarParche(function (perfiles, manos, mesas) {
            const manosCanonicas = manosCanonicasConMesasSeparadas(manos, mesas);
            const resultado = original.call(this, perfiles, manosCanonicas, mesas);
            if (Array.isArray(resultado?.mesasCerradas)) {
                resultado.mesasCerradas = mesasCanonicas(resultado.mesasCerradas);
            }
            return resultado;
        }, 'lobby');
    }

    function instalarGalardones() {
        const originalDatos = window.obtenerDatosGalardones;
        if (typeof originalDatos === 'function' && !originalDatos.__integridadEstadistica) {
            window.obtenerDatosGalardones = marcarParche(async function (...args) {
                const datos = await originalDatos.apply(this, args);
                if (!datos || !Array.isArray(datos.manos)) return datos;
                return { ...datos, manos: manosCanonicasAnidadas(datos.manos) };
            }, 'galardones-datos');
        }

        if (typeof window.obtenerVentanaOnFire === 'function') {
            window.obtenerVentanaOnFire = marcarParche(obtenerVentanaOnFire, 'galardones-onfire');
        }
    }

    function instalarConsultas() {
        const original = window.obtenerPartidasAgrupadas;
        if (typeof original === 'function' && !original.__integridadEstadistica) {
            window.obtenerPartidasAgrupadas = marcarParche(function () {
                return construirPartidasDesdeManos(window._manosGlobal || []).map(partida => ({
                    mesaId: partida.mesaId,
                    timestamp: partida.timestamp,
                    fecha_hora: partida.fecha_hora,
                    t1: partida.t1,
                    t2: partida.t2,
                    pts1: partida.pts1,
                    pts2: partida.pts2,
                    ganador: partida.ganador,
                    esLisa: partida.esLisa,
                    clutchWinnerTeam: partida.clutchWinnerTeam
                }));
            }, 'consultas');
        }

        if (typeof window.obtenerVentanaOnFireConsulta === 'function') {
            window.obtenerVentanaOnFireConsulta = marcarParche(obtenerVentanaOnFire, 'consultas-onfire');
        }
    }

    function instalarPerfil() {
        const originalStats = window.calcularEstadisticasYRanking;
        if (typeof originalStats === 'function' && !originalStats.__integridadEstadistica) {
            window.calcularEstadisticasYRanking = marcarParche(function (mesas, userId) {
                return originalStats.call(this, mesasCanonicas(mesas), userId);
            }, 'perfil-stats');
        }

        const originalBadges = window.verificarDistintivosPerfil;
        if (typeof originalBadges === 'function' && !originalBadges.__integridadEstadistica) {
            window.verificarDistintivosPerfil = marcarParche(function (perfil, mesas) {
                return originalBadges.call(this, perfil, mesasCanonicas(mesas));
            }, 'perfil-badges');
        }

        const originalOnFire = window.calcularEsOnFireConManos;
        if (typeof originalOnFire === 'function' && !originalOnFire.__integridadEstadistica) {
            window.calcularEsOnFireConManos = marcarParche(function (manos, userId) {
                const resultado = calcularOnFire(construirPartidasDesdeManos(manos));
                return String(resultado.ganador?.id ?? '') === String(userId ?? '');
            }, 'perfil-onfire');
        }
    }

    function instalarMesa() {
        const validar = event => {
            if (!(event.target instanceof HTMLFormElement)) return;
            const p1Input = event.target.querySelector('#input-p1');
            const p2Input = event.target.querySelector('#input-p2');
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

            const box = document.getElementById('error-box');
            if (box) {
                box.textContent = mensaje;
                box.classList.remove('hidden');
            }
            window.AppOffline?.showNotice?.(mensaje);
        };

        ['input-p1', 'input-p2'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.min = '0';
            input.max = '168';
            input.step = '1';
            input.inputMode = 'numeric';
        });

        if (!document.documentElement.dataset.mesaIntegridadSubmit) {
            document.documentElement.dataset.mesaIntegridadSubmit = '1';
            document.addEventListener('submit', validar, true);
        }
    }

    function instalarAdmin() {
        const original = window.cargarHistorialCerradoAdmin;
        if (typeof original !== 'function' || original.__integridadEstadistica) return;

        window.cargarHistorialCerradoAdmin = marcarParche(async function cargarHistorialCerradoAdminSeguro() {
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

                if (error) throw error;

                const grupos = new Map();
                (data || []).forEach(mano => {
                    const mesaInfo = cacheMesas[mano.mesa_id] || { id: mano.mesa_id, limite_puntos: 200 };
                    if (!grupos.has(mano.mesa_id)) grupos.set(mano.mesa_id, { mesa: mesaInfo, manos: [] });
                    grupos.get(mano.mesa_id).manos.push(mano);
                });

                const historial = [];
                grupos.forEach(({ mesa, manos }) => {
                    const limite = Math.max(1, Number(mesa?.limite_puntos) || 200);
                    const canon = manosCanonicasDeMesa(mesa, manos);
                    const finalizada = canon.pts1 >= limite || canon.pts2 >= limite;
                    if (!finalizada) return;
                    const ultima = canon.manos[canon.manos.length - 1];
                    historial.push({
                        mesa_id: mesa.id,
                        mesas: mesa,
                        puntos_pareja1: canon.pts1,
                        puntos_pareja2: canon.pts2,
                        rondas: canon.manos.length,
                        created_at: fechaMano(ultima, mesa)?.toISOString() || mesa.created_at,
                        finalizada: true,
                        manos_ids: canon.manos
                    });
                });

                cachePartidasCerradas = historial.sort(
                    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
                );

                try {
                    localStorage.setItem('domino_cache_admin_historial_v1', JSON.stringify(cachePartidasCerradas));
                } catch (_) {}

                renderizarHistorialLocal();
            } catch (error) {
                console.error('[INTEGRIDAD] No se pudo reconstruir el historial administrativo:', error);
                return original.apply(this, arguments);
            }
        }, 'admin');
    }

    function instalar() {
        try {
            if (PAGE === 'lobby.html') instalarLobby();
            if (PAGE === 'galardones.html') instalarGalardones();
            if (PAGE === 'consultas.html') instalarConsultas();
            if (PAGE === 'perfil.html') instalarPerfil();
            if (PAGE === 'mesa.html') instalarMesa();
            if (PAGE === 'admin.html') instalarAdmin();
        } catch (error) {
            console.error('[INTEGRIDAD] Error instalando reglas estadísticas:', error);
        }
    }

    window.DominoStatsIntegrity = Object.freeze({
        version: VERSION,
        esMesaValida,
        construirPartida,
        construirPartidasDesdeManos,
        construirPartidasDesdeMesas,
        obtenerVentanaOnFire,
        calcularOnFire,
        instalar
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
