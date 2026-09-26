// ============================================================
// ELO — COMPATIBILIDAD DE CLIENTE
// ============================================================
(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'mesa.html') return;

    let intentos = 0;
    const MAX_INTENTOS = 80;

    function instalar() {
        const cliente = window.supabaseClient;
        if (!cliente || typeof cliente.rpc !== 'function') {
            if (intentos++ < MAX_INTENTOS) setTimeout(instalar, 125);
            return;
        }

        if (cliente.rpc.__eloGestionadoPorServidor) return;

        const rpcOriginal = cliente.rpc.bind(cliente);
        const rpcSeguro = function (nombre, args, opciones) {
            // Desde ELO v2 el navegador no reconstruye el ranking global.
            // PostgreSQL lo hace de forma transaccional mediante el trigger
            // de la mano decisiva. Este retorno conserva compatibilidad con
            // versiones de mesa.html que todavía intentan llamar al RPC.
            if (nombre === 'recalcular_elo') {
                return Promise.resolve({
                    data: {
                        success: true,
                        version: 'elo_v2_canonico',
                        delegated_to_server: true
                    },
                    error: null
                });
            }
            return rpcOriginal(nombre, args, opciones);
        };

        rpcSeguro.__eloGestionadoPorServidor = true;
        cliente.rpc = rpcSeguro;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
