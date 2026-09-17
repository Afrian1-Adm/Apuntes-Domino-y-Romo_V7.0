// ============================================================
// HISTORIAL LEGADO — SOLO TABLA GENERAL Y TOP ANUAL
// ============================================================
(function () {
    'use strict';

    const SUPABASE_URL_LEGACY = 'https://kzbslfwupzwczmjqfjem.supabase.co';
    const SUPABASE_ANON_KEY_LEGACY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6YnNsZnd1cHp3Y3ptanFmamVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDI1MzksImV4cCI6MjEwMjcxODUzOX0.qeeh2FV3zKRet-jRMVvJUwBm9jYHsLbWSYWIao574qc';
    const RPC = 'obtener_clasificacion_general_con_legacy';

    let clienteFallback = null;
    let secuenciaTabla = 0;
    let timerTabla = null;
    let topEnCurso = false;

    function clienteSupabase() {
        if (window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
            return window.supabaseClient;
        }
        if (!clienteFallback && window.supabase && typeof window.supabase.createClient === 'function') {
            clienteFallback = window.supabase.createClient(SUPABASE_URL_LEGACY, SUPABASE_ANON_KEY_LEGACY);
        }
        return clienteFallback;
    }

    async function consultar(desde = null, hasta = null) {
        if (navigator.onLine === false) return null;
        const db = clienteSupabase();
        if (!db) throw new Error('Supabase JS no está disponible.');

        const { data, error } = await db.rpc(RPC, {
            p_desde: desde || null,
            p_hasta: hasta || null
        });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    function esc(valor) {
        return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function ordenar(lista) {
        return lista.sort((a, b) =>
            b.eficiencia - a.eficiencia ||
            b.total - a.total ||
            b.vic - a.vic ||
            String(a.jugador).localeCompare(String(b.jugador), 'es', { sensitivity: 'base' })
        );
    }

    async function renderTablaGeneral() {
        const tbody = document.getElementById('cuerpo-tabla-clasificatoria');
        if (!tbody) return;

        const solicitud = ++secuenciaTabla;
        const desde = document.getElementById('filtro-desde')?.value || null;
        const hasta = document.getElementById('filtro-hasta')?.value || null;
        const min = parseInt(document.getElementById('filtro-min-partidas')?.value || '0', 10) || 0;
        const tipo = document.getElementById('filtro-tipo-jugador')?.value || '';
        const texto = (document.getElementById('filtro-buscar-jugador')?.value || '').trim().toLowerCase();

        try {
            const filas = await consultar(desde, hasta);
            if (!filas || solicitud !== secuenciaTabla) return;

            let lista = filas.map(f => ({
                id: f.perfil_id,
                jugador: f.jugador || 'Jugador',
                rol: String(f.rol || '').toLowerCase(),
                vic: Number(f.victorias) || 0,
                der: Number(f.derrotas) || 0,
                total: Number(f.partidas) || 0,
                eficiencia: Number(f.eficiencia) || 0
            }));

            if (tipo === 'miembros') lista = lista.filter(x => x.rol !== 'invitado');
            if (tipo === 'invitados') lista = lista.filter(x => x.rol === 'invitado');
            if (min > 0) lista = lista.filter(x => x.total >= min);
            if (texto) lista = lista.filter(x => x.jugador.toLowerCase().includes(texto));
            ordenar(lista);

            if (typeof window.actualizarMarcadoresJugadorLobby === 'function') {
                window.actualizarMarcadoresJugadorLobby(lista);
            }
            if (typeof window.actualizarResumenClasificatoria === 'function') {
                window.actualizarResumenClasificatoria(lista);
            }

            if (!lista.length) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:12px 0;">No hay registros de partidas completadas que coincidan con los filtros.</td></tr>';
                return;
            }

            tbody.innerHTML = lista.map((x, i) => {
                const ef = x.eficiencia.toFixed(1);
                return `<tr>
                    <td style="text-align:center;font-weight:bold;color:var(--cyan-title);">${i + 1}°</td>
                    <td style="font-weight:bold;">${esc(x.jugador)}</td>
                    <td style="text-align:center;color:var(--accent-green);font-weight:bold;">${x.vic}</td>
                    <td style="text-align:center;color:var(--accent-red);">${x.der}</td>
                    <td style="text-align:center;">${x.total}</td>
                    <td><div class="progress-container">
                        <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${Math.max(0, Math.min(100, x.eficiencia))}%;"></div></div>
                        <span class="eficiencia-txt">${ef}%</span>
                    </div></td>
                </tr>`;
            }).join('');
        } catch (error) {
            console.error('[HISTORIAL LEGADO] Error Tabla General:', error);
        }
    }

    function programarTabla() {
        clearTimeout(timerTabla);
        timerTabla = setTimeout(renderTablaGeneral, 80);
    }

    function semanaActual(fecha) {
        const y = fecha.getFullYear();
        const dia = Math.floor((Date.UTC(y, fecha.getMonth(), fecha.getDate()) - Date.UTC(y, 0, 1)) / 86400000) + 1;
        return Math.min(52, Math.max(1, Math.floor((dia - 1) / 7) + 1));
    }

    async function renderTopAnual() {
        const tbody = document.getElementById('cuerpo-ranking-anual');
        if (!tbody || topEnCurso) return;
        topEnCurso = true;

        try {
            const hoy = new Date();
            const anio = hoy.getFullYear();
            const semana = semanaActual(hoy);
            const metaAnual = 360;
            const meta = Math.ceil((metaAnual * semana) / 52);
            const filas = await consultar(`${anio}-01-01`, `${anio}-12-31`);
            if (!filas) return;

            const lista = filas.map(f => ({
                jugador: f.jugador || 'Jugador',
                rol: String(f.rol || '').toLowerCase(),
                ganadas: Number(f.victorias) || 0,
                perdidas: Number(f.derrotas) || 0,
                partidas: Number(f.partidas) || 0,
                eficiencia: Number(f.eficiencia) || 0
            }))
            .filter(x => x.rol !== 'invitado' && x.partidas >= meta)
            .sort((a, b) =>
                b.eficiencia - a.eficiencia ||
                b.ganadas - a.ganadas ||
                b.partidas - a.partidas ||
                String(a.jugador).localeCompare(String(b.jugador), 'es', { sensitivity: 'base' })
            );

            const yearEl = document.getElementById('top-anual-year');
            const semanaEl = document.getElementById('top-anual-semana');
            const metaEl = document.getElementById('top-anual-meta-semanal');
            if (yearEl) yearEl.textContent = String(anio);
            if (semanaEl) semanaEl.textContent = `${semana} de 52`;
            if (metaEl) metaEl.textContent = `${meta} partidas`;

            if (!lista.length) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:12px 0;">Aún ningún jugador alcanza las ${meta} partidas requeridas en la semana ${semana}.</td></tr>`;
                return;
            }

            tbody.innerHTML = lista.slice(0, 10).map((x, i) => {
                const badge = i === 0 ? 'badge-oro' : i === 1 ? 'badge-plata' : i === 2 ? 'badge-bronce' : '';
                return `<tr>
                    <td style="text-align:center;" class="${badge}">${i + 1}°</td>
                    <td><span class="annual-player-name">${esc(x.jugador)}</span><span class="annual-record">${x.ganadas}V · ${x.perdidas}D</span></td>
                    <td style="text-align:center;font-weight:850;color:var(--accent-blue);">${x.partidas} / ${metaAnual}</td>
                    <td style="text-align:center;font-weight:900;color:var(--accent-green);">${x.eficiencia.toFixed(1)}%</td>
                </tr>`;
            }).join('');
        } catch (error) {
            console.error('[HISTORIAL LEGADO] Error Top Anual:', error);
        } finally {
            topEnCurso = false;
        }
    }

    function instalar() {
        const tabla = document.getElementById('cuerpo-tabla-clasificatoria');
        if (tabla) {
            ['filtro-desde', 'filtro-hasta', 'filtro-min-partidas', 'filtro-tipo-jugador', 'filtro-buscar-jugador']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (!el || el.dataset.legacyListener === '1') return;
                    el.dataset.legacyListener = '1';
                    el.addEventListener('input', programarTabla);
                    el.addEventListener('change', programarTabla);
                });

            const original = window.aplicarFiltrosClasificatoria;
            if (typeof original === 'function' && !original.__legacyIntegrado) {
                const envuelta = function (...args) {
                    const r = original.apply(this, args);
                    programarTabla();
                    return r;
                };
                envuelta.__legacyIntegrado = true;
                window.aplicarFiltrosClasificatoria = envuelta;
            }
            programarTabla();
        }

        if (document.getElementById('cuerpo-ranking-anual')) {
            const original = window.procesarYRenderizarGalardones;
            if (typeof original === 'function' && !original.__legacyIntegrado) {
                const envuelta = function (...args) {
                    const r = original.apply(this, args);
                    setTimeout(renderTopAnual, 0);
                    return r;
                };
                envuelta.__legacyIntegrado = true;
                window.procesarYRenderizarGalardones = envuelta;
            }
            setTimeout(renderTopAnual, 100);
        }
    }

    if (document.readyState === 'complete') setTimeout(instalar, 0);
    else window.addEventListener('load', () => setTimeout(instalar, 0), { once: true });
})();
