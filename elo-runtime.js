// ============================================================
// MESA — COMPATIBILIDAD CON AUTORIDAD DEL SERVIDOR
// ============================================================
(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'mesa.html') return;

    let intentos = 0;
    const MAX_INTENTOS = 80;

    function respuestaDelegada(tipo, extra = {}) {
        return Promise.resolve({
            data: {
                success: true,
                delegated_to_server: true,
                authority: 'postgres_triggers',
                type: tipo,
                ...extra
            },
            error: null
        });
    }

    function instalar() {
        const cliente = window.supabaseClient;
        if (!cliente || typeof cliente.rpc !== 'function') {
            if (intentos++ < MAX_INTENTOS) setTimeout(instalar, 125);
            return;
        }

        if (cliente.rpc.__dominoAutoridadServidor) return;

        const rpcOriginal = cliente.rpc.bind(cliente);
        const rpcSeguro = function (nombre, args, opciones) {
            // ELO v2: PostgreSQL reconstruye el ranking al guardar la mano
            // decisiva. El navegador nunca debe ejecutar el recálculo global.
            if (nombre === 'recalcular_elo') {
                return respuestaDelegada('elo', {
                    version: 'elo_v2_canonico'
                });
            }

            // Torneos V2 y el módulo heredado Equipo A/B ya tienen triggers
            // sincronizados sobre manos/mesas. Las llamadas antiguas de
            // mesa.html son únicamente respaldos históricos y no deben volver
            // a ejecutar lógica de cierre desde el cliente.
            if (nombre === 'torneo_v2_procesar_mesa') {
                return respuestaDelegada('torneo_v2', {
                    es_torneo: true
                });
            }

            if (nombre === 'procesar_mesa_equipo_ab') {
                return respuestaDelegada('torneo_equipo_ab');
            }

            return rpcOriginal(nombre, args, opciones);
        };

        rpcSeguro.__dominoAutoridadServidor = true;
        rpcSeguro.__eloGestionadoPorServidor = true;
        cliente.rpc = rpcSeguro;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
