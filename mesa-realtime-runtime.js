(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    if (pagina !== 'mesa.html') return;
    if (window.MesaRealtimeRuntime) return;

    const RESPALDO_REALTIME_SANO_MS = 20 * 1000;
    let ultimaConsultaRespaldo = 0;

    function realtimeSano() {
        try {
            return estadoRealtimeMesa === 'SUBSCRIBED' && Boolean(canalManosMesa);
        } catch (_) {
            return window.estadoRealtimeMesa === 'SUBSCRIBED' && Boolean(window.canalManosMesa);
        }
    }

    function instalar() {
        const original = window.revisarCambiosMesaRespaldo;
        if (typeof original !== 'function' || original.__realtimeEficiente) return;

        const envuelta = async function (...args) {
            const ahora = Date.now();

            // Mientras Realtime está conectado, este sondeo es solo una red de
            // seguridad para detectar un evento perdido. No necesita ejecutarse
            // cada 4 segundos: una comprobación cada 20 s mantiene recuperación
            // rápida y reduce 80% de las lecturas de respaldo.
            if (realtimeSano() && ahora - ultimaConsultaRespaldo < RESPALDO_REALTIME_SANO_MS) {
                return;
            }

            ultimaConsultaRespaldo = ahora;
            return original.apply(this, args);
        };

        envuelta.__realtimeEficiente = true;
        envuelta.__intervaloSanoMs = RESPALDO_REALTIME_SANO_MS;
        window.revisarCambiosMesaRespaldo = envuelta;
        window.MesaRealtimeRuntime = {
            version: 1,
            intervaloRespaldoRealtimeSanoMs: RESPALDO_REALTIME_SANO_MS
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar, { once: true });
    } else {
        instalar();
    }
})();
