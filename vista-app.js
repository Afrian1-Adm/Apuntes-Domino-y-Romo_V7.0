(function () {
    'use strict';

    const STORAGE_KEY = 'app_view_mode';
    const DESKTOP_WIDTH = 1080;
    const DESKTOP_WIDTH_POR_PAGINA = Object.freeze({
        'admin.html': 720,
        'historial.html': 720
    });
    const PAGINAS_CON_VISTA_ESCRITORIO = new Set(['admin.html', 'historial.html']);
    const mediaQueriesOriginales = [];
    let eventoInstalacion = null;

    function obtenerPaginaActual() {
        return (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    }

    function permiteVistaEscritorio() {
        return PAGINAS_CON_VISTA_ESCRITORIO.has(obtenerPaginaActual());
    }

    function obtenerAnchoEscritorio() {
        return DESKTOP_WIDTH_POR_PAGINA[obtenerPaginaActual()] || DESKTOP_WIDTH;
    }

    function esAppInstalada() {
        return window.matchMedia('(display-mode: fullscreen)').matches
            || window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function desactivarAutorrellenoEn(root) {
        const selector = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea';
        const campos = root.matches?.(selector) ? [root] : [...(root.querySelectorAll?.(selector) || [])];
        campos.forEach(campo => {
            campo.setAttribute('autocomplete', 'off');
            campo.setAttribute('autocorrect', 'off');
            campo.setAttribute('autocapitalize', 'none');
            campo.setAttribute('spellcheck', 'false');
            campo.setAttribute('data-lpignore', 'true');
            campo.setAttribute('data-1p-ignore', 'true');
            campo.setAttribute('data-form-type', 'other');
        });
        const formularios = root.matches?.('form') ? [root] : [...(root.querySelectorAll?.('form') || [])];
        formularios.forEach(formulario => formulario.setAttribute('autocomplete', 'off'));
    }

    function prepararPrivacidadDeInputs() {
        desactivarAutorrellenoEn(document);
        if (!document.body) return;
        new MutationObserver(registros => {
            registros.forEach(registro => registro.addedNodes.forEach(nodo => {
                if (nodo instanceof Element) desactivarAutorrellenoEn(nodo);
            }));
        }).observe(document.body, { childList: true, subtree: true });
    }

    function esDispositivoMovil() {
        const agenteMovil = navigator.userAgentData?.mobile === true
            || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        return window.matchMedia('(pointer: coarse)').matches || agenteMovil;
    }

    function obtenerModo() {
        if (!permiteVistaEscritorio()) return 'mobile';

        try {
            return localStorage.getItem(STORAGE_KEY) === 'desktop' ? 'desktop' : 'mobile';
        } catch (error) {
            return 'mobile';
        }
    }

    function guardarModo(modo) {
        try {
            localStorage.setItem(STORAGE_KEY, modo);
        } catch (error) {
            console.warn('No se pudo guardar el modo de visualización:', error);
        }
    }

    function obtenerAnchoMovil() {
        const anchoPantalla = Number(window.screen?.width) || 0;
        const anchoDisponible = Number(window.screen?.availWidth) || anchoPantalla;
        const dpr = Math.max(Number(window.devicePixelRatio) || 1, 1);
        const medidas = [anchoPantalla, anchoDisponible].filter(valor => valor > 0);
        let ancho = medidas.length ? Math.min(...medidas) : 390;

        if (ancho > 600) {
            const anchoCorregido = ancho / dpr;
            ancho = anchoCorregido >= 280 && anchoCorregido <= 600
                ? anchoCorregido
                : 390;
        }

        return Math.min(Math.max(ancho, 280), 600);
    }

    function aplicarMediaQueries(anchoObjetivo) {
        const procesarReglas = reglas => {
            for (const regla of reglas) {
                if (regla.type !== CSSRule.MEDIA_RULE) continue;

                let registro = mediaQueriesOriginales.find(item => item.regla === regla);
                if (!registro) {
                    registro = { regla, media: regla.media.mediaText };
                    mediaQueriesOriginales.push(registro);
                }

                const mediaOriginal = registro.media;
                const maximos = [...mediaOriginal.matchAll(/max-width\s*:\s*([\d.]+)px/gi)]
                    .map(coincidencia => Number(coincidencia[1]));
                const minimos = [...mediaOriginal.matchAll(/min-width\s*:\s*([\d.]+)px/gi)]
                    .map(coincidencia => Number(coincidencia[1]));

                if (!maximos.length && !minimos.length) continue;

                const cumpleMax = maximos.every(maximo => anchoObjetivo <= maximo);
                const cumpleMin = minimos.every(minimo => anchoObjetivo >= minimo);
                regla.media.mediaText = cumpleMax && cumpleMin ? 'all' : 'not all';
            }
        };

        for (const hoja of document.styleSheets) {
            try {
                procesarReglas(hoja.cssRules || []);
            } catch (error) {
                console.warn('No se pudo adaptar una hoja de estilos:', error);
            }
        }
    }

    function restaurarMediaQueries() {
        for (const registro of mediaQueriesOriginales) {
            registro.regla.media.mediaText = registro.media;
        }
    }

    function limpiarEscala() {
        const html = document.documentElement;
        html.classList.remove(
            'app-mobile-layout',
            'app-desktop-layout',
            'app-viewport-corregido'
        );
        html.style.removeProperty('--app-mobile-width');
        html.style.removeProperty('--app-mobile-height');
        html.style.removeProperty('--app-mobile-scale');
    }

    function aplicar() {
        const html = document.documentElement;

        if (!esAppInstalada() || !esDispositivoMovil()) {
            limpiarEscala();
            restaurarMediaQueries();
            actualizarBoton();
            return false;
        }

        const modo = obtenerModo();
        const anchoObjetivo = modo === 'desktop' ? obtenerAnchoEscritorio() : obtenerAnchoMovil();
        const medidasLienzo = [window.innerWidth, html.clientWidth].filter(valor => valor > 0);
        const anchoLienzo = medidasLienzo.length ? Math.max(...medidasLienzo) : anchoObjetivo;

        html.classList.toggle('app-mobile-layout', modo === 'mobile');
        html.classList.toggle('app-desktop-layout', modo === 'desktop');
        aplicarMediaQueries(anchoObjetivo);

        const escala = Math.min(Math.max(anchoLienzo / anchoObjetivo, 0.2), 4);
        const necesitaEscala = modo === 'desktop'
            || Math.abs(anchoLienzo - anchoObjetivo) > 2;

        if (necesitaEscala) {
            html.style.setProperty('--app-mobile-width', `${anchoObjetivo}px`);
            html.style.setProperty('--app-mobile-height', `${Math.ceil(window.innerHeight / escala)}px`);
            html.style.setProperty('--app-mobile-scale', escala.toFixed(4));
            html.classList.add('app-viewport-corregido');
        } else {
            html.classList.remove('app-viewport-corregido');
            html.style.removeProperty('--app-mobile-width');
            html.style.removeProperty('--app-mobile-height');
            html.style.removeProperty('--app-mobile-scale');
        }

        actualizarBoton();
        return true;
    }

    function actualizarBoton() {
        const boton = document.getElementById('app-view-toggle');
        if (!boton) return;

        const modo = obtenerModo();
        const esEscritorio = modo === 'desktop';
        const icono = boton.querySelector('.app-view-icon');
        const etiqueta = boton.querySelector('.app-view-label');
        const accion = esEscritorio ? 'Cambiar a vista móvil' : 'Cambiar a vista escritorio';

        if (icono) icono.textContent = esEscritorio ? '🖥️' : '📱';
        if (etiqueta) etiqueta.textContent = esEscritorio ? 'Escritorio' : 'Móvil';
        boton.dataset.mode = modo;
        boton.setAttribute('aria-label', accion);
        boton.setAttribute('title', accion);
        boton.setAttribute('aria-pressed', esEscritorio ? 'true' : 'false');
    }

    function alternar() {
        if (!permiteVistaEscritorio()) return;

        guardarModo(obtenerModo() === 'desktop' ? 'mobile' : 'desktop');
        aplicar();
        window.requestAnimationFrame(aplicar);
        window.dispatchEvent(new CustomEvent('appviewchange', { detail: { mode: obtenerModo() } }));
    }

    function agregarEstilos() {
        if (document.getElementById('app-view-styles')) return;

        const estilo = document.createElement('style');
        estilo.id = 'app-view-styles';
        estilo.textContent = `
            html.app-viewport-corregido { overflow-x: hidden; }
            html, body { min-height: 100%; min-height: 100dvh; }
            html.app-fullscreen-capable body {
                min-height: 100dvh;
                padding-left: env(safe-area-inset-left, 0px);
                padding-right: env(safe-area-inset-right, 0px);
                padding-bottom: env(safe-area-inset-bottom, 0px);
            }
            html.app-viewport-corregido body {
                box-sizing: border-box;
                width: var(--app-mobile-width);
                min-height: var(--app-mobile-height);
            }
            @supports (zoom: 1) {
                html.app-viewport-corregido body { zoom: var(--app-mobile-scale); }
            }
            @supports not (zoom: 1) {
                html.app-viewport-corregido body {
                    transform: scale(var(--app-mobile-scale));
                    transform-origin: top left;
                }
            }
            .app-view-button {
                white-space: nowrap;
                touch-action: manipulation;
            }
            .app-view-button .app-view-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .app-view-floating {
                position: fixed;
                right: 14px;
                bottom: max(14px, env(safe-area-inset-bottom));
                z-index: 9999;
                min-height: 46px;
                padding: 10px 14px;
                border: 1px solid var(--border-color, var(--line, #cbd5e1));
                border-radius: 14px;
                background: var(--card-bg, var(--surface, #ffffff));
                color: var(--text-color, var(--text, #0f172a));
                box-shadow: 0 8px 24px rgba(15, 23, 42, .18);
                font: inherit;
                font-weight: 800;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
            }
            .app-install-button {
                position: fixed;
                left: 14px;
                bottom: max(14px, env(safe-area-inset-bottom));
                z-index: 10000;
                min-height: 48px;
                padding: 11px 16px;
                border: 1px solid rgba(255, 255, 255, .24);
                border-radius: 14px;
                background: #1769e8;
                color: #ffffff;
                box-shadow: 0 10px 28px rgba(23, 105, 232, .28);
                font: inherit;
                font-weight: 850;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                cursor: pointer;
                touch-action: manipulation;
            }
            .app-install-button:disabled { opacity: .65; }
            @media (max-width: 430px) {
                .app-view-button:not(.app-view-floating) {
                    width: 48px !important;
                    min-width: 48px !important;
                    padding-inline: 10px !important;
                }
                .app-view-button:not(.app-view-floating) .app-view-label { display: none; }
            }
        `;
        document.head.appendChild(estilo);
    }

    function buscarBotonTema() {
        return document.querySelector([
            'button#theme-toggle',
            'button#historialThemeToggle',
            'button#torneosThemeToggle',
            'button#btn-theme-toggle',
            'button.theme-button',
            'button.theme-btn',
            'button.theme-toggle',
            'button[onclick*="cambiarTema"]',
            'button[onclick*="toggleTema"]'
        ].join(','));
    }

    function crearBoton() {
        if (!permiteVistaEscritorio()) return;
        if (!esAppInstalada() || !esDispositivoMovil()) return;
        if (document.getElementById('app-view-toggle')) return;

        agregarEstilos();
        const botonTema = buscarBotonTema();
        const boton = document.createElement('button');
        boton.id = 'app-view-toggle';
        boton.type = 'button';
        boton.className = botonTema
            ? `${botonTema.className} app-view-button`
            : 'app-view-button app-view-floating';
        boton.innerHTML = '<span class="app-view-icon" aria-hidden="true">📱</span><span class="app-view-label">Móvil</span>';
        boton.addEventListener('click', alternar);

        if (botonTema?.parentElement) {
            botonTema.parentElement.insertBefore(boton, botonTema);
        } else {
            document.body.appendChild(boton);
        }

        actualizarBoton();
    }

    function quitarBotonInstalar() {
        document.getElementById('app-install-button')?.remove();
    }

    function crearBotonInstalar() {
        if (!eventoInstalacion || esAppInstalada()) return;
        if (document.getElementById('app-install-button')) return;

        agregarEstilos();
        const boton = document.createElement('button');
        boton.id = 'app-install-button';
        boton.type = 'button';
        boton.className = 'app-install-button';
        boton.innerHTML = '<span aria-hidden="true">⬇️</span><span>Instalar app</span>';
        boton.setAttribute('aria-label', 'Instalar la aplicación');

        boton.addEventListener('click', async () => {
            const solicitud = eventoInstalacion;
            if (!solicitud) return;

            eventoInstalacion = null;
            boton.disabled = true;
            try {
                await solicitud.prompt();
                await solicitud.userChoice;
            } catch (error) {
                console.warn('No se pudo abrir el instalador de la PWA:', error);
            } finally {
                quitarBotonInstalar();
            }
        });

        document.body.appendChild(boton);
    }

    function prepararInstalacion() {
        const esServidorSeguro = window.location.protocol === 'https:'
            || ['localhost', '127.0.0.1'].includes(window.location.hostname);

        if ('serviceWorker' in navigator && esServidorSeguro) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js?v=70', {
                    scope: './',
                    updateViaCache: 'none'
                })
                    .then(registro => registro.update())
                    .catch(error => console.warn('No se pudo registrar el service worker:', error));
            });
        }

        window.addEventListener('beforeinstallprompt', evento => {
            evento.preventDefault();
            eventoInstalacion = evento;
            if (document.body) crearBotonInstalar();
            else document.addEventListener('DOMContentLoaded', crearBotonInstalar, { once: true });
        });

        window.addEventListener('appinstalled', () => {
            eventoInstalacion = null;
            quitarBotonInstalar();
        });
    }

    window.AppViewMode = Object.freeze({
        apply: aplicar,
        toggle: alternar,
        getMode: obtenerModo,
        setMode(modo) {
            if (!permiteVistaEscritorio()) {
                aplicar();
                return;
            }
            guardarModo(modo === 'desktop' ? 'desktop' : 'mobile');
            aplicar();
        }
    });

    prepararInstalacion();
    agregarEstilos();
    document.documentElement.classList.add('app-fullscreen-capable');
    aplicar();
    document.addEventListener('DOMContentLoaded', () => {
        prepararPrivacidadDeInputs();
        crearBoton();
        aplicar();
    });
    window.addEventListener('load', aplicar);
    window.addEventListener('resize', aplicar);
    window.addEventListener('orientationchange', aplicar);
})();
