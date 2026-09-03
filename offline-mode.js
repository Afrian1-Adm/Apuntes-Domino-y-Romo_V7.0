(function () {
    'use strict';

    if (window.AppOffline) return;

    const LAST_PAGE_KEY = 'club_domino_ultima_pagina';
    const OFFLINE_QUEUE_SELECTOR = '[data-offline-write-queue="true"]';
    const APP_PAGES = new Set([
        'lobby.html',
        'apunte.html',
        'mesa.html',
        'perfil.html',
        'galardones.html',
        'admin.html',
        'historial.html',
        'consultas.html',
        'torneos.html',
        'tombola.html'
    ]);

    const WRITE_WORDS = /(?:guardar|crear|registrar|anotar|eliminar|borrar|rechazar|aprobar|añadir|agregar|inscribir|retirar|editar|reiniciar|finalizar|subir|importar|sortear|rotar|reanudar|buscar\s+reemplazo|elegir\s+retadores|iniciar\s+mesa|cerrar\s+(?:mesa|jornada|sesión|sesion)|abrir\s+(?:otra\s+)?mesa|cambiar\s+contraseña|actualizar\s+(?:perfil|nombres|meta|contraseña|password)|guardar\s+cambios)/i;
    const WRITE_CALLS = /(?:insert|upsert|update|delete|signOut|guardar|crear|registrar|anotar|eliminar|borrar|aprobar|rechazar|retirar|inscribir|iniciarMesa|cerrarMesa|abrirMesa|rotar|sortear|finalizar|reiniciar|reanudarMesa|completarMesa)/i;

    function currentFile() {
        return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    }

    function rememberPage() {
        const file = currentFile();
        if (!APP_PAGES.has(file)) return;
        try {
            localStorage.setItem(LAST_PAGE_KEY, file + location.search + location.hash);
        } catch (error) {}
    }

    function isOffline() {
        return navigator.onLine === false;
    }

    function supportsQueuedWrites() {
        return Boolean(document.querySelector(OFFLINE_QUEUE_SELECTOR));
    }

    function isReadOnly() {
        return isOffline() && !supportsQueuedWrites();
    }

    function ensureStyles() {
        if (document.getElementById('app-offline-styles')) return;
        const style = document.createElement('style');
        style.id = 'app-offline-styles';
        style.textContent = `
            #app-offline-banner {
                position: fixed;
                left: 50%;
                bottom: calc(14px + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%);
                z-index: 2147483647;
                width: max-content;
                max-width: calc(100vw - 28px);
                padding: 10px 15px;
                border: 1px solid #f59e0b;
                border-radius: 999px;
                background: #111827;
                color: #fff;
                box-shadow: 0 12px 35px rgba(0,0,0,.32);
                font: 800 13px/1.25 system-ui, sans-serif;
                text-align: center;
            }
            #app-offline-toast {
                position: fixed;
                left: 50%;
                bottom: calc(68px + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%);
                z-index: 2147483647;
                width: min(440px, calc(100vw - 28px));
                padding: 12px 16px;
                border-radius: 12px;
                background: #7c2d12;
                color: #fff;
                box-shadow: 0 12px 35px rgba(0,0,0,.32);
                font: 700 14px/1.35 system-ui, sans-serif;
                text-align: center;
            }
            [data-app-offline-blocked="true"] {
                opacity: .55 !important;
                cursor: not-allowed !important;
                filter: grayscale(.25);
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showToast(message) {
        ensureStyles();
        let toast = document.getElementById('app-offline-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-offline-toast';
            toast.setAttribute('role', 'alert');
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.remove(), 3600);
    }

    function showBanner() {
        ensureStyles();
        let banner = document.getElementById('app-offline-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'app-offline-banner';
            banner.setAttribute('role', 'status');
            document.body.appendChild(banner);
        }
        banner.textContent = supportsQueuedWrites()
            ? '📴 Sin conexión · los puntos se guardarán y sincronizarán al volver'
            : '📴 Sin conexión · modo de solo lectura';
    }

    function hideBanner() {
        document.getElementById('app-offline-banner')?.remove();
        document.getElementById('app-offline-toast')?.remove();
    }

    function signature(element) {
        return [
            element.id,
            element.className,
            element.getAttribute('name'),
            element.getAttribute('value'),
            element.getAttribute('title'),
            element.getAttribute('aria-label'),
            element.getAttribute('onclick'),
            element.textContent
        ].filter(Boolean).join(' ');
    }

    function isWriteControl(element) {
        if (!(element instanceof Element)) return false;
        if (element.closest(OFFLINE_QUEUE_SELECTOR)) return false;
        if (element.closest('[data-offline-allow]')) return false;
        if (element.closest('[data-offline-write]')) return true;

        const anchor = element.closest('a[href]');
        if (anchor && !/^javascript:/i.test(anchor.getAttribute('href') || '')) return false;

        const control = element.closest('button, input[type="button"], input[type="submit"], [role="button"], [onclick]');
        if (!control) return false;
        if (control.matches('input[type="submit"], button[type="submit"]')) return true;

        const text = signature(control);
        return WRITE_WORDS.test(text) || WRITE_CALLS.test(control.getAttribute('onclick') || '');
    }

    function markWriteControls(root) {
        if (!isOffline()) return;
        const scope = root instanceof Element || root instanceof Document ? root : document;
        const candidates = scope.matches?.('button, input[type="button"], input[type="submit"], [role="button"], [onclick]')
            ? [scope]
            : [];
        candidates.push(...scope.querySelectorAll?.('button, input[type="button"], input[type="submit"], [role="button"], [onclick]') || []);
        candidates.forEach(control => {
            if (!isWriteControl(control)) return;
            if (!control.hasAttribute('data-app-original-title')) {
                control.setAttribute('data-app-original-title', control.getAttribute('title') || '');
            }
            control.setAttribute('data-app-offline-blocked', 'true');
            control.setAttribute('aria-disabled', 'true');
            control.setAttribute('title', 'No disponible sin conexión');
        });
    }

    function restoreControls() {
        document.querySelectorAll('[data-app-offline-blocked="true"]').forEach(control => {
            control.removeAttribute('data-app-offline-blocked');
            control.removeAttribute('aria-disabled');
            const oldTitle = control.getAttribute('data-app-original-title') || '';
            if (oldTitle) control.setAttribute('title', oldTitle);
            else control.removeAttribute('title');
            control.removeAttribute('data-app-original-title');
        });
    }

    function assertWritable(message) {
        if (!isOffline()) return true;
        showToast(message || 'Sin conexión: puedes consultar y navegar, pero no guardar cambios.');
        return false;
    }

    function applyState() {
        if (isOffline()) {
            showBanner();
            markWriteControls(document);
        } else {
            hideBanner();
            restoreControls();
        }
        window.dispatchEvent(new CustomEvent('app:connectionchange', {
            detail: {
                offline: isOffline(),
                readOnly: isReadOnly(),
                queuedWrites: isOffline() && supportsQueuedWrites()
            }
        }));
    }

    window.AppOffline = {
        isOffline,
        isReadOnly,
        supportsQueuedWrites,
        assertWritable,
        showNotice: showToast,
        lastPageKey: LAST_PAGE_KEY,
        pages: [...APP_PAGES]
    };

    rememberPage();

    document.addEventListener('click', event => {
        if (!isOffline() || !isWriteControl(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        assertWritable();
    }, true);

    document.addEventListener('submit', event => {
        if (!isOffline()) return;
        if (event.target instanceof Element && event.target.closest(`${OFFLINE_QUEUE_SELECTOR}, [data-offline-allow]`)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        assertWritable('Sin conexión: este formulario no puede guardar cambios.');
    }, true);

    window.addEventListener('online', applyState);
    window.addEventListener('offline', applyState);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyState();
            new MutationObserver(records => {
                if (!isOffline()) return;
                records.forEach(record => record.addedNodes.forEach(markWriteControls));
            }).observe(document.body, { childList: true, subtree: true });
        }, { once: true });
    } else {
        applyState();
        new MutationObserver(records => {
            if (!isOffline()) return;
            records.forEach(record => record.addedNodes.forEach(markWriteControls));
        }).observe(document.body, { childList: true, subtree: true });
    }
})();
