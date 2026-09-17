// ============================================================
// HISTORIAL LEGADO — SOLO TABLA GENERAL Y TOP ANUAL
// ============================================================
(function () {
    'use strict';

    const SUPABASE_URL_LEGACY = 'https://kzbslfwupzwczmjqfjem.supabase.co';
    const SUPABASE_ANON_KEY_LEGACY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Imt6YnNsZnd1cHp3Y3ptanFmamVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDI1MzksImV4cCI6MjEwMjcxODUzOX0.qeeh2FV3zKRet-jRMVvJUwBm9jYHsLbWSYWIao574qc';
    const RPC_LEGACY = 'obtener_clasificacion_general_con_legacy';
    let secuenciaTabla = 0;
    let temporizadorTabla = null;
    let topAnualEnCurso = false;

    async function consultarClasificacion(desde = null, hasta = null) {
        if (navigator.onLine === false) return null;

        const respuesta = await fetch(`${SUPABASE_URL_LEGACY}/rest/v1/rpc/${RPC_LEGACY}`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY_LEGACY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY_LEGACY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                p_desde: desde || null,
                p_hasta: hasta || null
            })
        });

        if (!respuesta.ok) {
            const detalle = await respuesta.text().catch(() => '');
            throw new Error(`Historial legado no disponible (${respuesta.status}) ${detalle}`.trim());
        }

        const datos = await respuesta.json();
        return Array.isArray(datos) ? datos : [];
    }

    function escaparHtml(valor) {
        return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function ordenarClasificacion(lista) {
        return lista.sort((a, b) =>
            Number(b.eficiencia || 0) - Number(a.eficiencia || 0) ||
            Number(b.total || b.partidas || 0) - Number(a.total || a.partidas || 0) ||
            Number(b.vic || b.victorias || 0) - Number(a.vic || a.victorias || 0) ||
            String(a.jugador || '').localeCompare(String(b.jugador || ''), 'es', { sensitivity: 'base' })
        );
    }

    async function renderizarTablaGeneralLegacy() {
        const tbody = document.getElementById('cuerpo-tabla-clasificatoria');
        if (!tbody) return;

        const solicitud = ++secuenciaTabla;
        const desde = document.getElementById('filtro-desde')?.value || null;
        const hasta = document.getElementById('filtro-hasta')?.value || null;
        const minPartidas = Number.parseInt(document.getElementById('filtro-min-partidas')?.value || '0', 10) || 0;
        const tipoJugador = document.getElementById('filtro-tipo-jugador')?.value || '';
        const busqueda = (document.getElementById('filtro-buscar-jugador')?.value || '').trim().toLowerCase();

        try {
            const filas = await consultarClasificacion(desde, hasta);
            if (!filas || solicitud !== secuenciaTabla) return;

            let lista = filas.map(fila => ({
                id: fila.perfil_id,
                jugador: fila.jugador || 'Jugador',
                rol: String(fila.rol || '').toLowerCase(),
                estado: fila.estado,
                vic: Number(fila.victorias) || 0,
                der: Number(fila.derrotas) || 0,
                total: Number(fila.partidas) || 0,
                eficiencia: Number(fila.eficiencia) || 0,
                partidasLegacy: Number(fila.partidas_legacy) || 0
            }));

            if (tipoJugador === 'miembros') {
                lista = lista.filter(item => item.rol !== 'invitado');
            } else if (tipoJugador === 'invitados') {
                lista = lista.filter(item => item.rol === 'invitado');
            }

            if (minPartidas > 0) lista = lista.filter(item => item.total >= minPartidas);
            if (busqueda) lista = lista.filter(item => item.jugador.toLowerCase().includes(busqueda));

            ordenarClasificacion(lista);

            if (typeof window.actualizarMarcadoresJugadorLobby === 'function') {
                window.actualizarMarcadoresJugadorLobby(lista);
            }
            if (typeof window.actualizarResumenClasificatoria === 'function') {
                window.actualizarResumenClasificatoria(lista);
            }

            if (!lista.length) {
                const vacio = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 12px 0;">No hay registros de partidas completadas que coincidan con los filtros.</td></tr>';
                tbody.innerHTML = vacio;
                if (typeof window.guardarCacheTablaClasificatoria === 'function') {
                    window.guardarCacheTablaClasificatoria(vacio, 0);
                }
                return;
            }

            const html = lista.map((item, indice) => {
                const ef = Number(item.eficiencia || 0).toFixed(1);
                return `
                    <tr>
                        <td style="text-align: center; font-weight: bold; color: var(--cyan-title);">${indice + 1}°</td>
                        <td style="font-weight: bold;">${escaparHtml(item.jugador)}</td>
                        <td style="text-align: center; color: var(--accent-green); font-weight: bold;">${item.vic}</td>
                        <td style="text-align: center; color: var(--accent-red);">${item.der}</td>
                        <td style="text-align: center;">${item.total}</td>
                        <td>
                            <div class="progress-container">
                                <div class="progress-bar-bg">
                                    <div class="progress-bar-fill" style="width: ${Math.max(0, Math.min(100, Number(ef)))}%;"></div>
                                </div>
                                <span class="eficiencia-txt">${ef}%</span>
                            </div>
                        </td>
                    </tr>`;
            }).join('');

            tbody.innerHTML = html;
            if (typeof window.guardarCacheTablaClasificatoria === 'function') {
                window.guardarCacheTablaClasificatoria(html, lista.length);
            }
        } catch (error) {
            console.warn('[HISTORIAL LEGADO] Tabla General mantiene el cálculo nuevo como respaldo:', error);
        }
    }

    function programarTablaGeneralLegacy() {
        window.clearTimeout(temporizadorTabla);
        temporizadorTabla = window.setTimeout(renderizarTablaGeneralLegacy, 80);
    }

    function semanaControlAnual(fecha) {
        const anio = fecha.getFullYear();
        const dia = Math.floor(
            (Date.UTC(anio, fecha.getMonth(), fecha.getDate()) - Date.UTC(anio, 0, 1)) / 86400000
        ) + 1;
        return Math.min(52, Math.max(1, Math.floor((dia - 1) / 7) + 1));
    }

    async function renderizarTopAnualLegacy() {
        const tbody = document.getElementById('cuerpo-ranking-anual');
        if (!tbody || topAnualEnCurso) return;

        topAnualEnCurso = true;
        try {
            const ahora = new Date();
            const anio = ahora.getFullYear();
            const desde = `${anio}-01-01`;
            const hasta = `${anio}-12-31`;
            const filas = await consultarClasificacion(desde, hasta);
            if (!filas) return;

            const META_ANUAL = 360;
            const semana = semanaControlAnual(ahora);
            const metaHastaSemana = Math.ceil((META_ANUAL * semana) / 52);

            const lista = filas
                .map(fila => ({
                    id: fila.perfil_id,
                    jugador: fila.jugador || 'Jugador',
                    ganadas: Number(fila.victorias) || 0,
                    perdidas: Number(fila.derrotas) || 0,
                    partidas: Number(fila.partidas) || 0,
                    eficiencia: Number(fila.eficiencia) || 0
                }))
                .filter(item => item.partidas >= metaHastaSemana)
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
            if (metaEl) metaEl.textContent = `${metaHastaSemana} partidas`;

            if (!lista.length) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px 0;">Aún ningún jugador alcanza las ${metaHastaSemana} partidas requeridas en la semana ${semana}.</td></tr>`;
                return;
            }

            tbody.innerHTML = lista.slice(0, 10).map((item, indice) => {
                const badgeClass = indice === 0 ? 'badge-oro' : indice === 1 ? 'badge-plata' : indice === 2 ? 'badge-bronce' : '';
                return `
                    <tr>
                        <td style="text-align: center;" class="${badgeClass}">${indice + 1}°</td>
                        <td>
                            <span class="annual-player-name">${escaparHtml(item.jugador)}</span>
                            <span class="annual-record">${item.ganadas}V · ${item.perdidas}D</span>
                        </td>
                        <td style="text-align: center; font-weight: 850; color: var(--accent-blue);">${item.partidas} / ${META_ANUAL}</td>
                        <td style="text-align: center; font-weight: 900; color: var(--accent-green);">${item.eficiencia.toFixed(1)}%</td>
                    </tr>`;
            }).join('');
        } catch (error) {
            console.warn('[HISTORIAL LEGADO] Top Anual mantiene el cálculo nuevo como respaldo:', error);
        } finally {
            topAnualEnCurso = false;
        }
    }

    function instalarIntegracionLegacy() {
        const tieneTablaGeneral = Boolean(document.getElementById('cuerpo-tabla-clasificatoria'));
        const tieneTopAnual = Boolean(document.getElementById('cuerpo-ranking-anual'));

        if (tieneTablaGeneral) {
            const original = window.aplicarFiltrosClasificatoria;
            if (typeof original === 'function' && !original.__legacyIntegrado) {
                const envuelta = function (...args) {
                    const resultado = original.apply(this, args);
                    programarTablaGeneralLegacy();
                    return resultado;
                };
                envuelta.__legacyIntegrado = true;
                window.aplicarFiltrosClasificatoria = envuelta;
            }
            programarTablaGeneralLegacy();
        }

        if (tieneTopAnual) {
            const original = window.procesarYRenderizarGalardones;
            if (typeof original === 'function' && !original.__legacyIntegrado) {
                const envuelta = function (...args) {
                    const resultado = original.apply(this, args);
                    window.setTimeout(renderizarTopAnualLegacy, 0);
                    return resultado;
                };
                envuelta.__legacyIntegrado = true;
                window.procesarYRenderizarGalardones = envuelta;
            }
            window.setTimeout(renderizarTopAnualLegacy, 100);
        }
    }

    window.addEventListener('load', () => {
        window.setTimeout(instalarIntegracionLegacy, 0);
    });
})();
