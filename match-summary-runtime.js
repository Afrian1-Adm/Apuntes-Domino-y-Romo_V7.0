(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    const PAGINAS = new Set(['historial.html', 'consultas.html', 'galardones.html']);
    if (!PAGINAS.has(pagina)) return;

    const CAMPOS_RESUMEN = [
        'mesa_id',
        'mesa_created_at',
        'fecha_final',
        'limite_puntos',
        'jugador1_id',
        'jugador2_id',
        'jugador3_id',
        'jugador4_id',
        'cuenta_tabla_general',
        'torneo_v2_id',
        'puntos_pareja1',
        'puntos_pareja2',
        'rondas',
        'ganador',
        'es_lisa',
        'diferencial',
        'clutch_winner_team'
    ].join(',');

    function cliente() {
        return window.supabaseClient || null;
    }

    function mesaDesdeResumen(r) {
        return {
            id: r.mesa_id,
            created_at: r.mesa_created_at,
            estado: 'cerrada',
            limite_puntos: Number(r.limite_puntos || 200),
            jugador1_id: r.jugador1_id,
            jugador2_id: r.jugador2_id,
            jugador3_id: r.jugador3_id,
            jugador4_id: r.jugador4_id,
            cuenta_tabla_general: r.cuenta_tabla_general !== false,
            torneo_v2_id: r.torneo_v2_id || null
        };
    }

    function manoSinteticaDesdeResumen(r) {
        return {
            id: `resumen-${r.mesa_id}`,
            mesa_id: r.mesa_id,
            anulada: false,
            puntos_pareja1: Number(r.puntos_pareja1 || 0),
            puntos_pareja2: Number(r.puntos_pareja2 || 0),
            created_at: r.fecha_final,
            fecha_hora: r.fecha_final,
            mesas: mesaDesdeResumen(r)
        };
    }

    function partidaConsultaDesdeResumen(r) {
        const t1 = [r.jugador1_id, r.jugador3_id].filter(Boolean);
        const t2 = [r.jugador2_id, r.jugador4_id].filter(Boolean);
        const fecha = r.fecha_final ? new Date(r.fecha_final) : null;
        return {
            mesaId: r.mesa_id,
            timestamp: fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : 0,
            fecha_hora: r.fecha_final || null,
            t1,
            t2,
            pts1: Number(r.puntos_pareja1 || 0),
            pts2: Number(r.puntos_pareja2 || 0),
            ganador: Number(r.ganador || 0),
            esLisa: Boolean(r.es_lisa),
            clutchWinnerTeam: Number(r.clutch_winner_team || 0)
        };
    }

    async function leerResumen({ soloGeneral = false } = {}) {
        const sb = cliente();
        if (!sb) throw new Error('Supabase todavía no está disponible.');

        let consulta = sb
            .from('partidas_resumen')
            .select(CAMPOS_RESUMEN)
            .order('fecha_final', { ascending: true })
            .order('mesa_id', { ascending: true });

        if (soloGeneral) consulta = consulta.eq('cuenta_tabla_general', true);

        const { data, error } = await consulta;
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    function instalarHistorial() {
        if (typeof window.cargarHistorialCompleto !== 'function') return;

        // Ya no es necesario descargar todas las mesas: cada fila resumida
        // contiene exactamente los campos que usa la pantalla de Historial.
        window.cargarMesas = async function cargarMesasDesdeResumen() {
            return undefined;
        };

        window.cargarHistorialCompleto = async function cargarHistorialDesdeResumen() {
            let filas;
            try {
                filas = await leerResumen({ soloGeneral: false });
            } catch (error) {
                console.error('[RESUMEN] Error cargando historial:', error);
                if (typeof cachePartidas !== 'undefined' && cachePartidas.length === 0) {
                    const tbody = document.getElementById('cuerpo-tabla-historial');
                    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--accent-red);padding:20px 0;">Error al cargar el historial.</td></tr>`;
                }
                return;
            }

            const mesas = {};
            const nuevasPartidas = filas
                .map(r => {
                    const mesa = mesaDesdeResumen(r);
                    mesas[r.mesa_id] = mesa;
                    return {
                        mesa_id: r.mesa_id,
                        mesas: mesa,
                        puntos_pareja1: Number(r.puntos_pareja1 || 0),
                        puntos_pareja2: Number(r.puntos_pareja2 || 0),
                        rondas: Number(r.rondas || 0),
                        created_at: r.fecha_final,
                        finalizada: true
                    };
                })
                .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

            if (typeof cacheMesas !== 'undefined') cacheMesas = mesas;

            const payload = {
                partidas: nuevasPartidas,
                perfiles: typeof cachePerfiles !== 'undefined' ? cachePerfiles : {},
                mesas
            };

            const firmaNueva = typeof firmaDatosHistorial === 'function'
                ? firmaDatosHistorial(payload)
                : JSON.stringify(payload);

            if (typeof firmaHistorialRenderizada === 'undefined' || firmaNueva !== firmaHistorialRenderizada) {
                if (typeof cachePartidas !== 'undefined') cachePartidas = nuevasPartidas;
                if (typeof firmaHistorialRenderizada !== 'undefined') firmaHistorialRenderizada = firmaNueva;
                try {
                    const clave = typeof cacheHistorialKey !== 'undefined'
                        ? cacheHistorialKey
                        : 'cache_historial_domino_v1';
                    localStorage.setItem(clave, JSON.stringify(payload));
                } catch (_) {}
                if (typeof aplicarFiltros === 'function') aplicarFiltros();
            }
        };
    }

    function instalarConsultas() {
        if (typeof window.obtenerDatosConsultas !== 'function' ||
            typeof window.aplicarDatosConsultas !== 'function' ||
            typeof window.obtenerPartidasAgrupadas !== 'function') return;

        const aplicarOriginal = window.aplicarDatosConsultas;
        const agruparOriginal = window.obtenerPartidasAgrupadas;

        window.obtenerDatosConsultas = async function obtenerDatosConsultasDesdeResumen() {
            const sb = cliente();
            if (!sb) throw new Error('Supabase todavía no está disponible.');

            const [perfilesRes, resumen] = await Promise.all([
                sb.from('perfiles').select('*'),
                leerResumen({ soloGeneral: true })
            ]);

            if (perfilesRes.error) throw perfilesRes.error;
            return {
                perfiles: perfilesRes.data || [],
                manos: [],
                partidasResumen: resumen
            };
        };

        window.aplicarDatosConsultas = function aplicarConsultasDesdeResumen(datos) {
            window.__partidasResumenConsultas = Array.isArray(datos?.partidasResumen)
                ? datos.partidasResumen
                : null;
            return aplicarOriginal(datos);
        };

        window.obtenerPartidasAgrupadas = function obtenerPartidasAgrupadasDesdeResumen() {
            const resumen = window.__partidasResumenConsultas;
            if (!Array.isArray(resumen)) return agruparOriginal();
            return resumen
                .filter(r => r.cuenta_tabla_general !== false)
                .map(partidaConsultaDesdeResumen)
                .filter(p => p.t1.length === 2 && p.t2.length === 2 && new Set([...p.t1, ...p.t2]).size === 4)
                .sort((a, b) => a.timestamp - b.timestamp || String(a.mesaId).localeCompare(String(b.mesaId)));
        };
    }

    function renderizarClutchDesdeResumen(resumen, perfiles) {
        const tbody = document.getElementById('cuerpo-ranking-clutch');
        if (!tbody || !Array.isArray(resumen)) return;

        const elegibles = new Set(
            (perfiles || [])
                .filter(p => p.es_jugador === true || p.es_jugador === 1 || p.rol === 'jugador' || p.rol === 'admin' || p.rol === 'super_admin')
                .map(p => p.id)
        );
        const nombres = Object.fromEntries((perfiles || []).map(p => [p.id, p.username || p.nombre_completo || 'Jugador']));
        const conteos = {};

        resumen.forEach(r => {
            const clutch = Number(r.clutch_winner_team || 0);
            if (clutch !== 1 && clutch !== 2) return;
            const ganadores = clutch === 1
                ? [r.jugador1_id, r.jugador3_id]
                : [r.jugador2_id, r.jugador4_id];
            ganadores.forEach(id => {
                if (!elegibles.has(id)) return;
                conteos[id] = (conteos[id] || 0) + 1;
            });
        });

        const ranking = Object.entries(conteos)
            .map(([id, remontadas]) => ({ jugador: nombres[id] || 'Jugador', remontadas }))
            .sort((a, b) => b.remontadas - a.remontadas || a.jugador.localeCompare(b.jugador, 'es', { sensitivity: 'base' }));

        if (!ranking.length) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:12px 0;">No hay registros de remontadas épicas.</td></tr>`;
            return;
        }

        tbody.innerHTML = ranking.map((item, idx) => {
            const badgeClass = idx === 0 ? 'badge-oro' : idx === 1 ? 'badge-plata' : idx === 2 ? 'badge-bronce' : '';
            return `<tr>
                <td style="text-align:center;" class="${badgeClass}">${idx + 1}°</td>
                <td style="font-weight:bold;">${item.jugador}</td>
                <td style="text-align:right;font-weight:900;color:var(--accent-amber);">${item.remontadas} remontada${item.remontadas > 1 ? 's' : ''}</td>
            </tr>`;
        }).join('');
    }

    function instalarGalardones() {
        if (typeof window.obtenerDatosGalardones !== 'function' ||
            typeof window.renderizarDatosGalardones !== 'function') return;

        const renderOriginal = window.renderizarDatosGalardones;
        let temporizadorResumen = null;

        window.obtenerDatosGalardones = async function obtenerGalardonesDesdeResumen() {
            const sb = cliente();
            if (!sb) throw new Error('Supabase todavía no está disponible.');

            const [perfilesRes, resumen, parejasRes] = await Promise.all([
                sb.from('perfiles').select('*'),
                leerResumen({ soloGeneral: true }),
                sb.from('v_top_10_parejas').select('*')
            ]);

            if (perfilesRes.error) throw perfilesRes.error;
            const manos = resumen.map(manoSinteticaDesdeResumen);

            return {
                perfiles: perfilesRes.data || [],
                manos,
                partidasResumen: resumen,
                diferencialView: null,
                topParejasView: parejasRes.error ? null : parejasRes.data,
                topRachasView: null,
                jugadorSemanaView: null
            };
        };

        window.renderizarDatosGalardones = function renderizarGalardonesDesdeResumen(datos) {
            const resultado = renderOriginal(datos);
            if (Array.isArray(datos?.partidasResumen)) {
                window.__partidasResumenGalardones = datos.partidasResumen;
                renderizarClutchDesdeResumen(datos.partidasResumen, datos.perfiles || []);
            }
            return resultado;
        };

        // Las subscripciones antiguas a manos/mesas pueden seguir llegando, pero
        // ya no provocan una descarga histórica completa. La actualización inmediata
        // la dirige Realtime sobre la fila resumen que realmente cambió.
        window.programarActualizacionGalardones = function programarActualizacionGalardonesResumida() {
            return undefined;
        };

        const sb = cliente();
        if (sb?.channel) {
            const refrescar = () => {
                clearTimeout(temporizadorResumen);
                temporizadorResumen = setTimeout(() => {
                    if (typeof window.cargarDatosYProcesar === 'function') {
                        window.cargarDatosYProcesar();
                    }
                }, 250);
            };

            window.__canalResumenGalardones = sb
                .channel('galardones_resumen_runtime')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'partidas_resumen' }, refrescar)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'perfiles' }, refrescar)
                .subscribe();
        }
    }

    function instalar() {
        try {
            if (pagina === 'historial.html') instalarHistorial();
            else if (pagina === 'consultas.html') instalarConsultas();
            else if (pagina === 'galardones.html') instalarGalardones();
        } catch (error) {
            console.error('[RESUMEN] No se pudo instalar el runtime:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
