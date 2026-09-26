(function () {
    'use strict';

    const pagina = (location.pathname.split('/').pop() || '').toLowerCase();
    const usaResumen = new Set(['historial.html', 'consultas.html', 'galardones.html']).has(pagina);
    const runtime = './match-summary-runtime.js?v=1';
    const core = './app-notifications-core.js?v=1';

    function etiqueta(src) {
        return `<script src="${src}"><\/script>`;
    }

    // Este archivo se carga durante el parseo del <head>. document.write aquí es
    // deliberado: garantiza que el runtime registre sus adaptadores antes de los
    // manejadores DOMContentLoaded de cada página, sin carreras de red.
    if (document.readyState === 'loading') {
        if (usaResumen) document.write(etiqueta(runtime));
        document.write(etiqueta(core));
        return;
    }

    function cargar(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = resolve;
            script.onerror = reject;
            (document.head || document.documentElement).appendChild(script);
        });
    }

    (async () => {
        try {
            if (usaResumen) await cargar(runtime);
            await cargar(core);
        } catch (error) {
            console.error('No se pudieron cargar los módulos comunes de la app:', error);
        }
    })();
})();
