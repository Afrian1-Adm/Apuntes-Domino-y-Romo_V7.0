(function () {
    'use strict';

    if (window.AppNotifications) return;

    const SUPABASE_URL = 'https://kzbslfwupzwczmjqfjem.supabase.co';

    const SUPABASE_ANON_KEY =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6YnNsZnd1cHp3Y3ptanFmamVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDI1MzksImV4cCI6MjEwMjcxODUzOX0.qeeh2FV3zKRet-jRMVvJUwBm9jYHsLbWSYWIao574qc';

    const GOAT_AUDIO_URL = './chiva.mp3';

    const GOAT_AUDIO_FALLBACK_URL =
        'https://cdn.freesound.org/previews/842/842307_15895934-lq.mp3';

    const STORAGE_SEEN =
        'domino_notificaciones_vistas_v1';

    const STORAGE_ENABLED =
        'domino_avisos_activos_v1';

    const THURSDAY_KEY =
        'domino_recordatorio_jueves_';

    const MAX_SEEN = 180;


    // ==========================================================
    // CLIENTE SUPABASE COMPARTIDO
    // ==========================================================

    const crearClienteSupabase =
        window.supabase?.createClient
            ? window.supabase.createClient.bind(window.supabase)
            : null;


    function obtenerClienteSupabaseCompartido() {

        if (window.supabaseClient) {
            return window.supabaseClient;
        }

        if (!crearClienteSupabase) {
            return null;
        }


        const cliente =
            crearClienteSupabase(
                SUPABASE_URL,
                SUPABASE_ANON_KEY,
                {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: true
                    }
                }
            );


        window.supabaseClient = cliente;

        return cliente;
    }


    let db = null;

    let perfil = null;

    let canal = null;

    let audioChiva = null;

    let audioDesbloqueado = false;

    let audioContext = null;

    let audioSource = null;

    let audioGain = null;

    let audioCompressor = null;

    let temporizadorJueves = null;



    // ==========================================================
    // ESTILOS
    // ==========================================================

    function inyectarEstilos() {

        if (
            document.getElementById(
                'app-notifications-style'
            )
        ) {
            return;
        }


        const style =
            document.createElement('style');


        style.id =
            'app-notifications-style';


        style.textContent = `

            #app-notification-stack{

                position:fixed;

                top:calc(
                    env(safe-area-inset-top,0px) + 12px
                );

                left:max(
                    10px,
                    env(safe-area-inset-left,0px)
                );

                right:max(
                    10px,
                    env(safe-area-inset-right,0px)
                );

                z-index:2147483000;

                display:flex;

                flex-direction:column;

                gap:10px;

                width:auto;

                max-width:390px;

                margin-left:auto;

                margin-right:auto;

                box-sizing:border-box;

                pointer-events:none;

            }


            .app-notification-card{

                pointer-events:auto;

                display:grid;

                grid-template-columns:
                    auto 1fr auto;

                gap:11px;

                align-items:start;

                padding:14px;

                border:
                    1px solid
                    rgba(59,130,246,.32);

                border-radius:16px;

                background:
                    rgba(255,255,255,.97);

                color:#0f172a;

                box-shadow:
                    0 18px 50px
                    rgba(15,23,42,.24);

                font-family:
                    system-ui,
                    -apple-system,
                    sans-serif;

                animation:
                    appNoticeIn
                    .22s
                    ease-out;

            }


            .app-notification-card[data-url]{
                cursor:pointer;
            }


            .app-notification-icon{

                font-size:1.45rem;

                line-height:1.15;

            }


            .app-notification-title{

                display:block;

                font-size:.94rem;

                font-weight:900;

                margin-bottom:3px;

            }


            .app-notification-message{

                font-size:.82rem;

                line-height:1.38;

                color:#475569;

            }


            .app-notification-close{

                border:0;

                background:transparent;

                color:#64748b;

                font-size:1.2rem;

                line-height:1;

                cursor:pointer;

                padding:1px 3px;

            }


            .app-lisa-overlay{

                position:fixed;

                inset:0;

                z-index:2147483200;

                display:grid;

                place-items:center;

                padding:22px;

                background:
                    rgba(2,6,23,.72);

                backdrop-filter:
                    blur(5px);

                font-family:
                    system-ui,
                    -apple-system,
                    sans-serif;

            }


            .app-lisa-card{

                width:min(
                    520px,
                    100%
                );

                position:relative;

                text-align:center;

                padding:
                    26px
                    22px
                    22px;

                border:
                    3px solid
                    #f59e0b;

                border-radius:24px;

                background:
                    linear-gradient(
                        145deg,
                        #fffbeb,
                        #fff7ed
                    );

                color:#7c2d12;

                box-shadow:
                    0 25px 80px
                    rgba(0,0,0,.45);

                animation:
                    appLisaIn
                    .32s
                    cubic-bezier(
                        .2,
                        .9,
                        .25,
                        1.2
                    );

            }


            .app-lisa-goat{

                font-size:4.3rem;

                line-height:1;

                margin-bottom:5px;

            }


            .app-lisa-card h2{

                font-size:2rem;

                line-height:1;

                margin:
                    0 0 10px;

                font-weight:1000;

                letter-spacing:.04em;

            }


            .app-lisa-card p{

                margin:0;

                font-size:1rem;

                line-height:1.45;

                font-weight:750;

            }


            .app-lisa-card small{

                display:block;

                margin-top:10px;

                color:#9a3412;

                font-weight:700;

            }


            .app-lisa-close{

                position:absolute;

                top:10px;

                right:11px;

                width:36px;

                height:36px;

                border:
                    1px solid
                    #fed7aa;

                border-radius:50%;

                background:#fff;

                color:#9a3412;

                font-size:1.25rem;

                cursor:pointer;

            }


            @media(prefers-color-scheme:dark){

                .app-notification-card{

                    background:
                        rgba(15,23,42,.97);

                    color:#f8fafc;

                    border-color:
                        rgba(96,165,250,.4);

                }


                .app-notification-message{
                    color:#cbd5e1;
                }


                .app-notification-close{
                    color:#94a3b8;
                }

            }


            @keyframes appNoticeIn{

                from{

                    opacity:0;

                    transform:
                        translateY(-10px)
                        scale(.98);

                }

                to{

                    opacity:1;

                    transform:none;

                }

            }


            @keyframes appLisaIn{

                from{

                    opacity:0;

                    transform:
                        scale(.78)
                        rotate(-2deg);

                }

                to{

                    opacity:1;

                    transform:
                        scale(1)
                        rotate(0);

                }

            }

        `;


        document.head.appendChild(style);
    }



    // ==========================================================
    // CONTENEDOR DE AVISOS
    // ==========================================================

    function obtenerEscalaVisualApp() {

        const html = document.documentElement;

        if (
            !html.classList.contains(
                'app-viewport-corregido'
            )
        ) {
            return 1;
        }

        const valor = parseFloat(
            getComputedStyle(html)
                .getPropertyValue(
                    '--app-mobile-scale'
                )
        );

        if (
            !Number.isFinite(valor) ||
            valor <= 1
        ) {
            return 1;
        }

        return Math.min(
            valor,
            4
        );
    }


    function ajustarEscalaAvisos() {

        const stack =
            document.getElementById(
                'app-notification-stack'
            );

        if (!stack) return;


        const escala =
            obtenerEscalaVisualApp();


        const anchoViewport =
            window.visualViewport?.width ||
            window.innerWidth ||
            document.documentElement.clientWidth ||
            390;


        /*
         * Calculamos el ancho lógico antes
         * de ampliarlo.
         *
         * De esta forma en el A6 puede crecer
         * visualmente sin salirse de la pantalla.
         */

        const anchoBase =
            Math.min(
                390,
                Math.max(
                    260,
                    (anchoViewport - 20) / escala
                )
            );


        stack.style.left =
            '50%';

        stack.style.right =
            'auto';

        stack.style.width =
            `${anchoBase}px`;

        stack.style.maxWidth =
            'none';

        stack.style.marginLeft =
            '0';

        stack.style.marginRight =
            '0';

        stack.style.transformOrigin =
            'top center';

        stack.style.transform =
            `translateX(-50%) scale(${escala})`;
    }


    function contenedorAvisos() {

        let stack =
            document.getElementById(
                'app-notification-stack'
            );


        if (!stack) {

            stack =
                document.createElement('div');


            stack.id =
                'app-notification-stack';


            stack.setAttribute(
                'aria-live',
                'polite'
            );


            /*
             * IMPORTANTE:
             *
             * Se agrega directamente a <html>
             * y NO dentro del body.
             *
             * Esto evita que el zoom o
             * transform del body desplace
             * las notificaciones en móviles
             * antiguos como el Samsung A6.
             */

            document.documentElement
                .appendChild(stack);
        }


        ajustarEscalaAvisos();


        return stack;
    }



    // ==========================================================
    // NOTIFICACIONES YA VISTAS
    // ==========================================================

    function leerVistas() {

        try {

            const value =
                JSON.parse(
                    localStorage.getItem(
                        STORAGE_SEEN
                    ) || '{}'
                );


            return (
                value &&
                typeof value === 'object'
            )
                ? value
                : {};

        } catch (_) {

            return {};

        }
    }


    function yaVista(key) {

        if (!key) return false;

        return Boolean(
            leerVistas()[key]
        );
    }


    function marcarVista(key) {

        if (!key) return;


        try {

            const vistas =
                leerVistas();


            vistas[key] =
                Date.now();


            const ordenadas =
                Object.entries(vistas)
                    .sort(
                        (a, b) =>
                            b[1] - a[1]
                    )
                    .slice(
                        0,
                        MAX_SEEN
                    );


            localStorage.setItem(
                STORAGE_SEEN,
                JSON.stringify(
                    Object.fromEntries(
                        ordenadas
                    )
                )
            );

        } catch (_) {}
    }



    // ==========================================================
    // AUDIO DE LA CHIVA
    // ==========================================================

    function obtenerAudioChiva() {

        if (!audioChiva) {

            audioChiva =
                new Audio();


            audioChiva.crossOrigin =
                'anonymous';


            audioChiva.src =
                GOAT_AUDIO_URL;


            audioChiva.preload =
                'auto';

        }


        return audioChiva;
    }


    async function reproducirChivaReal(audio) {

        try {

            await audio.play();

        } catch (errorLocal) {

            if (
                audio.dataset
                    .chivaFallback === '1'
            ) {

                throw errorLocal;

            }


            audio.dataset
                .chivaFallback = '1';


            audio.pause();


            audio.src =
                GOAT_AUDIO_FALLBACK_URL;


            audio.load();


            await audio.play();

        }
    }


    function prepararChivaAmplificada() {

        try {

            const AudioCtx =
                window.AudioContext ||
                window.webkitAudioContext;


            if (!AudioCtx) {
                return false;
            }


            audioContext =
                audioContext ||
                new AudioCtx();


            if (!audioSource) {

                audioSource =
                    audioContext
                        .createMediaElementSource(
                            obtenerAudioChiva()
                        );


                audioGain =
                    audioContext
                        .createGain();


                audioCompressor =
                    audioContext
                        .createDynamicsCompressor();


                audioGain
                    .gain
                    .value = 2.4;


                audioCompressor
                    .threshold
                    .value = -12;


                audioCompressor
                    .knee
                    .value = 12;


                audioCompressor
                    .ratio
                    .value = 10;


                audioCompressor
                    .attack
                    .value = .003;


                audioCompressor
                    .release
                    .value = .22;


                audioSource
                    .connect(audioGain)
                    .connect(
                        audioCompressor
                    )
                    .connect(
                        audioContext
                            .destination
                    );

            }


            return true;

        } catch (_) {

            return false;

        }
    }


    async function desbloquearAudio() {

        if (audioDesbloqueado) {
            return true;
        }


        try {

            const audio =
                obtenerAudioChiva();


            prepararChivaAmplificada();


            if (
                audioContext?.state ===
                'suspended'
            ) {

                await audioContext.resume();

            }


            const volumen =
                audio.volume;


            audio.volume =
                0.001;


            await reproducirChivaReal(
                audio
            );


            audio.pause();


            audio.currentTime = 0;


            audio.volume =
                volumen;


            audioDesbloqueado =
                true;

        } catch (_) {

            try {

                const AudioCtx =
                    window.AudioContext ||
                    window.webkitAudioContext;


                if (AudioCtx) {

                    audioContext =
                        audioContext ||
                        new AudioCtx();


                    await audioContext
                        .resume();


                    audioDesbloqueado =
                        audioContext.state ===
                        'running';

                }

            } catch (_) {}

        }


        return audioDesbloqueado;
    }


    function chivaSintetica() {

        try {

            const AudioCtx =
                window.AudioContext ||
                window.webkitAudioContext;


            if (!AudioCtx) return;


            audioContext =
                audioContext ||
                new AudioCtx();


            const start =
                audioContext.currentTime;


            [0, .23, .47]
                .forEach(
                    (delay, index) => {

                        const osc =
                            audioContext
                                .createOscillator();


                        const gain =
                            audioContext
                                .createGain();


                        osc.type =
                            index === 1
                                ? 'sawtooth'
                                : 'triangle';


                        osc.frequency
                            .setValueAtTime(
                                520 -
                                index * 35,
                                start + delay
                            );


                        osc.frequency
                            .exponentialRampToValueAtTime(
                                255,
                                start +
                                delay +
                                .22
                            );


                        gain.gain
                            .setValueAtTime(
                                .0001,
                                start + delay
                            );


                        gain.gain
                            .exponentialRampToValueAtTime(
                                .22,
                                start +
                                delay +
                                .025
                            );


                        gain.gain
                            .exponentialRampToValueAtTime(
                                .0001,
                                start +
                                delay +
                                .25
                            );


                        osc
                            .connect(gain)
                            .connect(
                                audioContext
                                    .destination
                            );


                        osc.start(
                            start + delay
                        );


                        osc.stop(
                            start +
                            delay +
                            .27
                        );

                    }
                );

        } catch (_) {}
    }


    async function sonarChiva() {

        try {

            const audio =
                obtenerAudioChiva();


            prepararChivaAmplificada();


            if (
                audioContext?.state ===
                'suspended'
            ) {

                await audioContext.resume();

            }


            audio.currentTime = 0;

            audio.volume = 1;


            await reproducirChivaReal(
                audio
            );


            audioDesbloqueado =
                true;


            window.setTimeout(
                () => {

                    if (!audio.paused) {

                        audio.pause();

                        audio.currentTime = 0;

                    }

                },
                6500
            );


            navigator.vibrate?.(
                [
                    260,
                    100,
                    260,
                    100,
                    420
                ]
            );

        } catch (_) {

            chivaSintetica();

        }
    }


    function sonarAviso() {

        try {

            const AudioCtx =
                window.AudioContext ||
                window.webkitAudioContext;


            if (!AudioCtx) return;


            audioContext =
                audioContext ||
                new AudioCtx();


            const t =
                audioContext.currentTime;


            [660, 880]
                .forEach(
                    (
                        frequency,
                        index
                    ) => {

                        const osc =
                            audioContext
                                .createOscillator();


                        const gain =
                            audioContext
                                .createGain();


                        osc.type =
                            'sine';


                        osc.frequency
                            .value =
                            frequency;


                        gain.gain
                            .setValueAtTime(
                                .0001,
                                t +
                                index * .12
                            );


                        gain.gain
                            .exponentialRampToValueAtTime(
                                .12,
                                t +
                                index * .12 +
                                .015
                            );


                        gain.gain
                            .exponentialRampToValueAtTime(
                                .0001,
                                t +
                                index * .12 +
                                .18
                            );


                        osc
                            .connect(gain)
                            .connect(
                                audioContext
                                    .destination
                            );


                        osc.start(
                            t +
                            index * .12
                        );


                        osc.stop(
                            t +
                            index * .12 +
                            .2
                        );

                    }
                );

        } catch (_) {}
    }



    // ==========================================================
    // NAVEGACIÓN
    // ==========================================================

    function navegar(url) {

        if (!url) return;

        window.location.href =
            url;
    }



    // ==========================================================
    // AVISO DENTRO DE LA APP
    // ==========================================================

    function mostrarAviso({

        icono = '🔔',

        titulo,

        mensaje,

        url,

        duracion = 8000

    }) {

        inyectarEstilos();


        const card =
            document.createElement(
                'div'
            );


        card.className =
            'app-notification-card';


        card.setAttribute(
            'role',
            'status'
        );


        if (url) {

            card.dataset.url =
                url;

        }


        const icon =
            document.createElement(
                'span'
            );


        icon.className =
            'app-notification-icon';


        icon.textContent =
            icono;


        const copy =
            document.createElement(
                'div'
            );


        const strong =
            document.createElement(
                'strong'
            );


        strong.className =
            'app-notification-title';


        strong.textContent =
            titulo;


        const text =
            document.createElement(
                'div'
            );


        text.className =
            'app-notification-message';


        text.textContent =
            mensaje;


        copy.append(
            strong,
            text
        );


        const close =
            document.createElement(
                'button'
            );


        close.type =
            'button';


        close.className =
            'app-notification-close';


        close.setAttribute(
            'aria-label',
            'Cerrar aviso'
        );


        close.textContent =
            '×';


        close.addEventListener(
            'click',
            event => {

                event.stopPropagation();

                card.remove();

            }
        );


        card.append(
            icon,
            copy,
            close
        );


        if (url) {

            card.addEventListener(
                'click',
                () => navegar(url)
            );

        }


        contenedorAvisos()
            .prepend(card);


        window.setTimeout(
            () => card.remove(),
            duracion
        );
    }



    // ==========================================================
    // LISA
    // ==========================================================

    function mostrarLisa({

        titulo,

        mensaje,

        detalle,

        url

    }) {

        inyectarEstilos();


        document
            .querySelector(
                '.app-lisa-overlay'
            )
            ?.remove();


        const overlay =
            document.createElement(
                'div'
            );


        overlay.className =
            'app-lisa-overlay';


        overlay.setAttribute(
            'role',
            'alertdialog'
        );


        overlay.setAttribute(
            'aria-label',
            titulo
        );


        const card =
            document.createElement(
                'div'
            );


        card.className =
            'app-lisa-card';


        const close =
            document.createElement(
                'button'
            );


        close.type =
            'button';


        close.className =
            'app-lisa-close';


        close.setAttribute(
            'aria-label',
            'Cerrar cartel'
        );


        close.textContent =
            '×';


        const goat =
            document.createElement(
                'div'
            );


        goat.className =
            'app-lisa-goat';


        goat.textContent =
            '🐐';


        const h2 =
            document.createElement(
                'h2'
            );


        h2.textContent =
            titulo;


        const p =
            document.createElement(
                'p'
            );


        p.textContent =
            mensaje;


        const small =
            document.createElement(
                'small'
            );


        small.textContent =
            detalle ||
            '¡Meeee! La partida terminó sin que los rivales anotaran.';


        card.append(
            close,
            goat,
            h2,
            p,
            small
        );


        overlay.appendChild(
            card
        );


        /*
         * Fuera del body para evitar
         * problemas con zoom/scale.
         */

        document
            .documentElement
            .appendChild(
                overlay
            );


        close.addEventListener(
            'click',
            () =>
                overlay.remove()
        );


        overlay.addEventListener(
            'click',
            event => {

                if (
                    event.target ===
                    overlay
                ) {

                    overlay.remove();

                }

            }
        );


        if (url) {

            card.addEventListener(
                'click',
                event => {

                    if (
                        event.target !==
                        close
                    ) {

                        navegar(url);

                    }

                }
            );

        }


        window.setTimeout(
            () => overlay.remove(),
            10000
        );
    }



    // ==========================================================
    // NOTIFICACIÓN DEL SISTEMA
    // ==========================================================

    async function notificacionSistema({

        titulo,

        mensaje,

        url,

        tag

    }) {

        if (
            !(
                'Notification'
                in window
            ) ||
            Notification.permission
                !== 'granted'
        ) {

            return;

        }


        try {

            if (
                'serviceWorker'
                in navigator
            ) {

                const registration =
                    await navigator
                        .serviceWorker
                        .ready;


                await registration
                    .showNotification(
                        titulo,
                        {

                            body:
                                mensaje,

                            icon:
                                'icon-192.png',

                            badge:
                                'icon-192.png',

                            tag:
                                tag ||
                                titulo,

                            renotify:
                                true,

                            data: {

                                url:
                                    url ||
                                    'lobby.html'

                            }

                        }
                    );

            } else {

                const notice =
                    new Notification(
                        titulo,
                        {

                            body:
                                mensaje,

                            icon:
                                'icon-192.png',

                            tag

                        }
                    );


                notice.onclick =
                    () =>
                        navegar(
                            url ||
                            'lobby.html'
                        );

            }

        } catch (error) {

            console.warn(
                '[AVISOS] No se pudo mostrar la notificación del sistema:',
                error
            );

        }
    }



    // ==========================================================
    // INTERRUPTOR MAESTRO
    // ==========================================================

    function avisosActivos() {

        const valor =
            localStorage.getItem(
                STORAGE_ENABLED
            );


        if (valor === '1') {

            return true;

        }


        if (valor === '0') {

            return false;

        }


        /*
         * Compatibilidad con celulares
         * que ya tenían Web Push activado
         * antes de existir el interruptor.
         */

        return (
            localStorage.getItem(
                'domino_push_celular_activo'
            ) === '1'
        );
    }


    function establecerAvisosActivos(
        activos
    ) {

        localStorage.setItem(
            STORAGE_ENABLED,
            activos
                ? '1'
                : '0'
        );
    }



    // ==========================================================
    // EMITIR
    // ==========================================================

    async function emitir(aviso) {

        /*
         * Si el usuario apagó el
         * interruptor, no mostramos
         * carteles ni sonidos internos.
         */

        if (!avisosActivos()) {

            return false;

        }


        if (
            aviso.key &&
            yaVista(aviso.key)
        ) {

            return false;

        }


        if (aviso.key) {

            marcarVista(
                aviso.key
            );

        }


        if (
            aviso.tipo ===
            'lisa'
        ) {

            mostrarLisa(aviso);

            sonarChiva();

        } else {

            mostrarAviso(aviso);

            sonarAviso();

        }


        const webPushActivo =
            localStorage.getItem(
                'domino_push_celular_activo'
            ) === '1';


        if (
            aviso.tipo ===
            'lisa' ||
            !webPushActivo
        ) {

            notificacionSistema({

                titulo:
                    aviso.titulo,

                mensaje:
                    aviso.mensaje,

                url:
                    aviso.url,

                tag:
                    aviso.key ||
                    aviso.tipo

            });

        }


        return true;
    }



    // ==========================================================
    // NOMBRES DE PERFILES
    // ==========================================================

    function nombrePerfil(p) {

        return String(

            p?.nombre_completo ||

            p?.username ||

            'Jugador'

        ).trim();
    }


    async function nombresPerfiles(
        ids
    ) {

        const unicos =
            [
                ...new Set(

                    (ids || [])

                        .filter(Boolean)

                        .map(String)

                )
            ];


        if (
            !unicos.length ||
            !db
        ) {

            return [];

        }


        const {
            data,
            error
        } =
            await db
                .from('perfiles')
                .select(
                    'id,username,nombre_completo'
                )
                .in(
                    'id',
                    unicos
                );


        if (error) {

            return [];

        }


        const mapa =
            new Map(

                (data || [])

                    .map(
                        p => [

                            String(p.id),

                            nombrePerfil(p)

                        ]
                    )

            );


        return unicos
            .map(
                id =>
                    mapa.get(id) ||
                    'Jugador'
            );
    }



    // ==========================================================
    // LISA
    // ==========================================================

    async function evaluarLisa(
        mesaId
    ) {

        if (
            !mesaId ||
            !db
        ) {

            return;

        }


        const lisaKey =
            `lisa_partida_final_${mesaId}`;


        if (
            localStorage.getItem(
                lisaKey
            ) ||
            yaVista(
                `lisa:${mesaId}`
            )
        ) {

            return;

        }


        const [
            mesaResult,
            manosResult
        ] =
            await Promise.all([

                db
                    .from('mesas')
                    .select(
                        'id,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id'
                    )
                    .eq(
                        'id',
                        mesaId
                    )
                    .maybeSingle(),


                db
                    .from('manos')
                    .select(
                        'puntos_pareja1,puntos_pareja2,anulada'
                    )
                    .eq(
                        'mesa_id',
                        mesaId
                    )

            ]);


        if (
            mesaResult.error ||
            manosResult.error ||
            !mesaResult.data
        ) {

            return;

        }


        const marcador =
            (
                manosResult.data ||
                []
            )
                .reduce(
                    (
                        acc,
                        mano
                    ) => {

                        if (
                            !mano.anulada
                        ) {

                            acc.p1 +=
                                Number(
                                    mano
                                        .puntos_pareja1 ||
                                    0
                                );


                            acc.p2 +=
                                Number(
                                    mano
                                        .puntos_pareja2 ||
                                    0
                                );

                        }


                        return acc;

                    },
                    {
                        p1: 0,
                        p2: 0
                    }
                );


        const mesa =
            mesaResult.data;


        const limite =
            Number(
                mesa.limite_puntos ||
                200
            );


        const ganoP1 =

            marcador.p1 >=
            limite &&

            marcador.p2 ===
            0;


        const ganoP2 =

            marcador.p2 >=
            limite &&

            marcador.p1 ===
            0;


        if (
            !ganoP1 &&
            !ganoP2
        ) {

            return;

        }


        const perdedores =
            ganoP1

                ? [
                    mesa.jugador2_id,
                    mesa.jugador4_id
                ]

                : [
                    mesa.jugador1_id,
                    mesa.jugador3_id
                ];


        const nombres =
            await nombresPerfiles(
                perdedores
            );


        const textoPerdedores =
            nombres
                .filter(Boolean)
                .join(' y ') ||
            'la pareja rival';


        localStorage.setItem(
            lisaKey,
            '1'
        );


        await emitir({

            key:
                `lisa:${mesaId}`,

            tipo:
                'lisa',

            titulo:
                '¡LISA!',

            mensaje:
                `A ${textoPerdedores} le acaban de dar una lisa: ${ganoP1 ? marcador.p1 : marcador.p2} a 0.`,

            detalle:
                '¡Meeee! La chiva llegó al club. 🍼',

            url:
                `mesa.html?id=${encodeURIComponent(
                    mesaId
                )}`

        });
    }



    // ==========================================================
    // MESAS
    // ==========================================================

    async function manejarMesa(
        payload
    ) {

        const nueva =
            payload.new ||
            {};


        const anterior =
            payload.old ||
            {};


        if (!nueva.id) {

            return;

        }


        if (
            payload.eventType ===
            'INSERT' &&
            perfil?.id
        ) {

            const jugadores =
                [

                    nueva.jugador1_id,

                    nueva.jugador2_id,

                    nueva.jugador3_id,

                    nueva.jugador4_id

                ]
                    .map(String);


            if (
                jugadores.includes(
                    String(
                        perfil.id
                    )
                )
            ) {

                emitir({

                    key:
                        `mesa-iniciada:${nueva.id}`,

                    tipo:
                        'mesa',

                    icono:
                        '🀄',

                    titulo:
                        'Tu mesa está lista',

                    mensaje:
                        `Se inició una mesa de ${Number(
                            nueva.limite_puntos ||
                            200
                        )} puntos con tu perfil.`,

                    url:
                        `mesa.html?id=${encodeURIComponent(
                            nueva.id
                        )}`

                });

            }

        }


        if (
            payload.eventType ===
            'UPDATE' &&

            nueva.estado ===
            'cerrada' &&

            anterior.estado !==
            'cerrada'
        ) {

            window.setTimeout(
                () =>
                    evaluarLisa(
                        nueva.id
                    ),
                250
            );

        }
    }



    // ==========================================================
    // TORNEO INICIADO
    // ==========================================================

    function manejarTorneo(
        payload
    ) {

        const nueva =
            payload.new ||
            {};


        const anterior =
            payload.old ||
            {};


        if (
            !nueva.id ||

            nueva.estado !==
            'en_curso' ||

            anterior.estado ===
            'en_curso'
        ) {

            return;

        }


        emitir({

            key:
                `torneo-iniciado:${nueva.id}`,

            tipo:
                'torneo',

            icono:
                '🏆',

            titulo:
                '¡Comenzó el torneo!',

            mensaje:
                `${nueva.nombre || nueva.titulo || 'El torneo del club'} ya está en curso.`,

            url:
                `torneos.html?torneo=${encodeURIComponent(
                    nueva.id
                )}`

        });
    }



    // ==========================================================
    // SOLICITUDES DE PAREJA
    // ==========================================================

    async function manejarSolicitudPareja(
        payload
    ) {

        if (!perfil?.id) {

            return;

        }


        const nueva =
            payload.new ||
            {};


        if (!nueva.id) {

            return;

        }


        if (
            payload.eventType ===
            'INSERT' &&

            String(
                nueva.invitado_id
            ) ===
            String(
                perfil.id
            )
        ) {

            const [
                solicitante
            ] =
                await nombresPerfiles(
                    [
                        nueva
                            .solicitante_id
                    ]
                );


            emitir({

                key:
                    `solicitud-pareja:${nueva.id}`,

                tipo:
                    'pareja',

                icono:
                    '🤝',

                titulo:
                    'Solicitud para jugar en pareja',

                mensaje:
                    `${solicitante || 'Un jugador'} quiere formar pareja contigo en un torneo.`,

                url:
                    `torneos.html${

                        nueva.torneo_id

                            ? `?torneo=${encodeURIComponent(
                                nueva
                                    .torneo_id
                            )}`

                            : ''

                    }`

            });

        }


        if (
            payload.eventType ===
            'UPDATE' &&

            String(
                nueva.solicitante_id
            ) ===
            String(
                perfil.id
            ) &&

            nueva.estado &&

            nueva.estado !==
            'pendiente'
        ) {

            const aceptada =
                nueva.estado ===
                'aceptada';


            emitir({

                key:
                    `respuesta-pareja:${nueva.id}:${nueva.estado}`,

                tipo:
                    'pareja',

                icono:
                    aceptada
                        ? '✅'
                        : 'ℹ️',

                titulo:
                    aceptada

                        ? 'Solicitud aceptada'

                        : 'Solicitud de pareja actualizada',

                mensaje:
                    aceptada

                        ? 'Tu compañero aceptó jugar contigo.'

                        : `La solicitud quedó como ${nueva.estado}.`,

                url:
                    `torneos.html${

                        nueva.torneo_id

                            ? `?torneo=${encodeURIComponent(
                                nueva
                                    .torneo_id
                            )}`

                            : ''

                    }`

            });

        }
    }



    // ==========================================================
    // TÓMBOLA
    // ==========================================================

    function manejarTombola(
        payload
    ) {

        if (!perfil?.id) {

            return;

        }


        const nueva =
            payload.new ||
            {};


        if (
            String(
                nueva.jugador_id
            ) !==
            String(
                perfil.id
            ) ||

            nueva.estado !==
            'seleccionado'
        ) {

            return;

        }


        const marca =

            payload.commit_timestamp ||

            nueva.updated_at ||

            Date.now();


        emitir({

            key:
                `tombola-seleccion:${nueva.id}:${marca}`,

            tipo:
                'tombola',

            icono:
                '🎲',

            titulo:
                '¡Fuiste elegido!',

            mensaje:
                'La jugada aleatoria te seleccionó para una mesa. Entra para confirmar.',

            url:
                'tombola.html'

        });
    }



    // ==========================================================
    // HORA DE SANTO DOMINGO
    // ==========================================================

    function fechaSantoDomingo() {

        try {

            const partes =

                new Intl
                    .DateTimeFormat(
                        'en-CA',
                        {

                            timeZone:
                                'America/Santo_Domingo',

                            year:
                                'numeric',

                            month:
                                '2-digit',

                            day:
                                '2-digit',

                            weekday:
                                'short',

                            hour:
                                '2-digit',

                            minute:
                                '2-digit',

                            hourCycle:
                                'h23'

                        }
                    )
                    .formatToParts(
                        new Date()
                    )
                    .reduce(
                        (
                            acc,
                            p
                        ) => {

                            acc[
                                p.type
                            ] =
                                p.value;

                            return acc;

                        },
                        {}
                    );


            return {

                fecha:
                    `${partes.year}-${partes.month}-${partes.day}`,

                jueves:
                    partes.weekday ===
                    'Thu',

                hora:
                    Number(
                        partes.hour ||
                        0
                    ),

                minuto:
                    Number(
                        partes.minute ||
                        0
                    )

            };

        } catch (_) {

            const ahora =
                new Date();


            return {

                fecha:
                    ahora
                        .toISOString()
                        .slice(
                            0,
                            10
                        ),

                jueves:
                    ahora.getDay() ===
                    4,

                hora:
                    ahora.getHours(),

                minuto:
                    ahora.getMinutes()

            };

        }
    }



    // ==========================================================
    // RECORDATORIO DEL JUEVES
    // ==========================================================

    function revisarJueves() {

        const ahora =
            fechaSantoDomingo();


        if (
            !ahora.jueves ||
            ahora.hora < 19
        ) {

            return;

        }


        const key =
            `${THURSDAY_KEY}${ahora.fecha}`;


        if (
            localStorage.getItem(
                key
            )
        ) {

            return;

        }


        localStorage.setItem(
            key,
            '1'
        );


        emitir({

            key:
                `jueves:${ahora.fecha}`,

            tipo:
                'recordatorio',

            icono:
                '🁣',

            titulo:
                '¡Hoy hay jugada de dominó!',

            mensaje:
                'Es jueves y son las 7:00 p. m. Nos vemos en el club para la jugada.',

            url:
                'lobby.html'

        });
    }



    // ==========================================================
    // REALTIME
    // ==========================================================

    function conectarRealtime() {

        if (
            !db ||
            canal
        ) {

            return;

        }


        canal =
            db.channel(
                `avisos-app-${Math.random()
                    .toString(36)
                    .slice(2)}`
            )


                .on(

                    'postgres_changes',

                    {

                        event:
                            '*',

                        schema:
                            'public',

                        table:
                            'mesas'

                    },

                    manejarMesa

                )


                .on(

                    'postgres_changes',

                    {

                        event:
                            'UPDATE',

                        schema:
                            'public',

                        table:
                            'torneos_v2'

                    },

                    manejarTorneo

                )


                .on(

                    'postgres_changes',

                    {

                        event:
                            '*',

                        schema:
                            'public',

                        table:
                            'torneo_v2_solicitudes_pareja'

                    },

                    manejarSolicitudPareja

                )


                .on(

                    'postgres_changes',

                    {

                        event:
                            'UPDATE',

                        schema:
                            'public',

                        table:
                            'tombola_inscripciones'

                    },

                    manejarTombola

                )


                .subscribe(
                    status => {

                        if (
                            status ===
                            'CHANNEL_ERROR'
                        ) {

                            console.warn(
                                '[AVISOS] El canal en tiempo real no pudo conectarse.'
                            );

                        }

                    }
                );
    }



    function desconectarRealtime() {

        if (
            temporizadorJueves
        ) {

            clearInterval(
                temporizadorJueves
            );


            temporizadorJueves =
                null;

        }


        if (
            canal &&
            db
        ) {

            try {

                db.removeChannel(
                    canal
                );

            } catch (_) {}

        }


        canal = null;
    }



    // ==========================================================
    // BOTÓN DE NOTIFICACIONES
    // ==========================================================

    function actualizarBoton() {

        const boton =
            document.getElementById(
                'btn-notificaciones-app'
            );


        if (!boton) {

            return;

        }


        const activos =
            avisosActivos();


        boton.setAttribute(
            'aria-pressed',
            activos
                ? 'true'
                : 'false'
        );


        if (!activos) {

            boton.textContent =
                '🔕 Avisos desactivados · Toca para activar';


            boton.title =
                'Activar avisos en este dispositivo';


            return;
        }


        if (
            !(
                'Notification'
                in window
            )
        ) {

            boton.textContent =
                '🔔 Avisos dentro de la app activos · Toca para apagar';


            boton.title =
                'Desactivar avisos en este dispositivo';


            return;
        }


        const pushActivo =

            localStorage.getItem(
                'domino_push_celular_activo'
            ) === '1';


        if (
            Notification.permission ===
            'granted' &&
            pushActivo
        ) {

            boton.textContent =
                '🔔 Avisos y sonido activados · Toca para apagar';

        }

        else if (
            Notification.permission ===
            'denied'
        ) {

            boton.textContent =
                '🔔 Avisos dentro de la app activos · Toca para apagar';

        }

        else {

            boton.textContent =
                '🔔 Avisos activos · Toca para apagar';

        }


        boton.title =
            'Desactivar avisos en este dispositivo';
    }



    // ==========================================================
    // CLAVE WEB PUSH
    // ==========================================================

    function convertirClavePush(
        base64
    ) {

        const relleno =
            '='.repeat(
                (
                    4 -
                    base64.length % 4
                ) % 4
            );


        const normalizada =
            (
                base64 +
                relleno
            )

                .replace(
                    /-/g,
                    '+'
                )

                .replace(
                    /_/g,
                    '/'
                );


        const binario =
            atob(
                normalizada
            );


        return Uint8Array.from(

            [...binario]

                .map(
                    char =>
                        char.charCodeAt(
                            0
                        )
                )

        );
    }



    // ==========================================================
    // SESIÓN Y PERFIL
    // ==========================================================

    async function asegurarContextoUsuario() {

        try {

            db =
                db ||
                obtenerClienteSupabaseCompartido();


            if (!db) {

                return null;

            }


            const {

                data: {
                    session
                },

                error

            } =
                await db
                    .auth
                    .getSession();


            if (error) {

                console.warn(
                    '[AVISOS] No se pudo recuperar la sesión:',
                    error
                );


                return null;
            }


            if (
                !session?.user
            ) {

                return null;

            }


            if (!perfil) {

                const {

                    data,

                    error:
                        perfilError

                } =
                    await db

                        .from(
                            'perfiles'
                        )

                        .select(
                            'id,username,nombre_completo,estado'
                        )

                        .eq(
                            'auth_user_id',
                            session.user.id
                        )

                        .maybeSingle();


                if (
                    perfilError
                ) {

                    console.warn(
                        '[AVISOS] No se pudo recuperar el perfil:',
                        perfilError
                    );

                } else {

                    perfil =
                        data ||
                        null;

                }

            }


            return session;

        } catch (error) {

            console.warn(
                '[AVISOS] Error recuperando contexto de usuario:',
                error
            );


            return null;

        }
    }



    // ==========================================================
    // ACTIVAR PUSH DEL CELULAR
    // ==========================================================

    async function activarPushCelular() {

        if (
            !(
                'serviceWorker'
                in navigator
            ) ||
            !(
                'PushManager'
                in window
            )
        ) {

            throw new Error(
                'Este navegador no admite notificaciones Web Push.'
            );

        }


        const session =
            await asegurarContextoUsuario();


        if (
            !session ||
            !perfil?.id
        ) {

            throw new Error(
                'Inicia sesión nuevamente para activar los avisos.'
            );

        }


        const keyResponse =
            await fetch(

                `${SUPABASE_URL}/functions/v1/push-web`,

                {

                    method:
                        'GET',

                    headers: {

                        apikey:
                            SUPABASE_ANON_KEY,

                        Authorization:
                            `Bearer ${session.access_token}`

                    }

                }

            );


        if (
            !keyResponse.ok
        ) {

            throw new Error(
                'El servicio de avisos del celular todavía no está publicado.'
            );

        }


        const {
            publicKey
        } =
            await keyResponse
                .json();


        if (!publicKey) {

            throw new Error(
                'Falta la clave pública del servicio de avisos.'
            );

        }


        const registration =
            await navigator
                .serviceWorker
                .ready;


        let subscription =
            await registration
                .pushManager
                .getSubscription();


        if (!subscription) {

            subscription =
                await registration
                    .pushManager
                    .subscribe(
                        {

                            userVisibleOnly:
                                true,

                            applicationServerKey:
                                convertirClavePush(
                                    publicKey
                                )

                        }
                    );

        }


        const serializada =
            subscription.toJSON();


        const {
            error
        } =
            await db.rpc(

                'registrar_push_subscription',

                {

                    p_endpoint:
                        serializada.endpoint,

                    p_p256dh:
                        serializada
                            .keys
                            ?.p256dh,

                    p_auth:
                        serializada
                            .keys
                            ?.auth,

                    p_user_agent:
                        navigator
                            .userAgent

                }

            );


        if (error) {

            throw error;

        }


        localStorage.setItem(
            'domino_push_celular_activo',
            '1'
        );


        return true;
    }



    // ==========================================================
    // DESACTIVAR PUSH DEL CELULAR
    // ==========================================================

    async function desactivarPushCelular() {

        try {

            if (
                !(
                    'serviceWorker'
                    in navigator
                ) ||
                !(
                    'PushManager'
                    in window
                )
            ) {

                return;

            }


            const registration =
                await navigator
                    .serviceWorker
                    .getRegistration();


            const subscription =
                await registration
                    ?.pushManager
                    .getSubscription();


            if (!subscription) {

                return;

            }


            const session =
                await asegurarContextoUsuario();


            if (
                session &&
                db
            ) {

                await db

                    .from(
                        'push_subscriptions'
                    )

                    .delete()

                    .eq(
                        'endpoint',
                        subscription.endpoint
                    );

            }


            await subscription
                .unsubscribe();


        } catch (error) {

            console.warn(
                '[AVISOS] No se pudo retirar la suscripción del celular:',
                error
            );

        } finally {

            localStorage.removeItem(
                'domino_push_celular_activo'
            );

        }
    }



    // ==========================================================
    // ENCENDER AVISOS
    // ==========================================================

    async function activar() {

        await desbloquearAudio();


        let permiso =
            'unsupported';


        if (
            'Notification'
            in window
        ) {

            try {

                permiso =

                    Notification.permission ===
                    'default'

                        ? await Notification
                            .requestPermission()

                        : Notification
                            .permission;


            } catch (_) {

                permiso =
                    Notification.permission;

            }

        }


        /*
         * El interruptor maestro queda
         * encendido aunque el navegador
         * solo permita avisos internos.
         */

        establecerAvisosActivos(
            true
        );


        let pushActivo =
            false;


        let errorPush =
            '';


        if (
            permiso ===
            'granted'
        ) {

            try {

                pushActivo =
                    await activarPushCelular();

            } catch (error) {

                errorPush =
                    error?.message ||
                    'No se pudo registrar este celular.';


                console.warn(
                    '[AVISOS] Web Push pendiente:',
                    error
                );

            }

        }


        const session =
            await asegurarContextoUsuario();


        if (
            session &&
            perfil
        ) {

            conectarRealtime();

            revisarJueves();


            if (
                !temporizadorJueves
            ) {

                temporizadorJueves =
                    window.setInterval(
                        revisarJueves,
                        30000
                    );

            }

        }


        actualizarBoton();


        if (
            permiso ===
            'denied'
        ) {

            mostrarAviso({

                icono:
                    '🔕',

                titulo:
                    'Avisos del sistema bloqueados',

                mensaje:
                    'Los avisos dentro de la app quedan activos. Para recibirlos con la app cerrada, habilita las notificaciones en los permisos del sitio.'

            });

        } else {

            mostrarAviso({

                icono:
                    '🔔',

                titulo:
                    'Avisos activados',

                mensaje:

                    pushActivo

                        ? 'Este celular recibirá avisos aunque la aplicación esté cerrada.'

                        : permiso ===
                          'granted'

                            ? `Los avisos dentro de la app están activos. ${errorPush}`

                            : 'Recibirás carteles y sonido dentro de la app.'

            });


            sonarAviso();

        }


        return permiso;
    }



    // ==========================================================
    // APAGAR AVISOS
    // ==========================================================

    async function desactivar() {

        /*
         * Primero apagamos el interruptor
         * para que ningún aviso Realtime
         * pueda colarse durante el proceso.
         */

        establecerAvisosActivos(
            false
        );


        /*
         * Elimina la suscripción Push
         * de ESTE dispositivo.
         */

        await desactivarPushCelular();


        /*
         * Desconecta los avisos Realtime.
         */

        desconectarRealtime();


        actualizarBoton();


        /*
         * Este cartel se muestra directamente
         * porque emitir() ya está apagado.
         */

        mostrarAviso({

            icono:
                '🔕',

            titulo:
                'Avisos desactivados',

            mensaje:
                'Este dispositivo dejó de recibir avisos del club. Puedes volver a activarlos cuando quieras.'

        });


        return false;
    }



    // ==========================================================
    // INTERRUPTOR ENCENDER / APAGAR
    // ==========================================================

    async function alternar() {

        if (
            avisosActivos()
        ) {

            return desactivar();

        }


        return activar();
    }



    // ==========================================================
    // INICIALIZAR
    // ==========================================================

    async function iniciar() {

        inyectarEstilos();


        /*
         * MIGRACIÓN AUTOMÁTICA
         *
         * Si este celular ya tenía Push
         * activo antes de crear el nuevo
         * interruptor, lo dejamos encendido.
         */

        if (

            localStorage.getItem(
                STORAGE_ENABLED
            ) === null &&

            localStorage.getItem(
                'domino_push_celular_activo'
            ) === '1'

        ) {

            establecerAvisosActivos(
                true
            );

        }


        actualizarBoton();


        /*
         * Si el usuario apagó los avisos
         * manualmente, respetamos su decisión.
         */

        if (
            !avisosActivos()
        ) {

            return;

        }


        try {

            const session =
                await asegurarContextoUsuario();


            if (
                !session ||
                !perfil
            ) {

                return;

            }


            /*
             * Si el usuario ya había concedido
             * permiso de notificaciones pero
             * por algún motivo se perdió el
             * registro local del Push,
             * intentamos recuperarlo.
             */

            if (

                'Notification'
                in window &&

                Notification.permission ===
                'granted' &&

                localStorage.getItem(
                    'domino_push_celular_activo'
                ) !== '1'

            ) {

                try {

                    await activarPushCelular();

                } catch (error) {

                    console.warn(
                        '[AVISOS] No se pudo restaurar Web Push:',
                        error
                    );

                }

            }


            conectarRealtime();

            revisarJueves();


            if (
                !temporizadorJueves
            ) {

                temporizadorJueves =
                    window.setInterval(
                        revisarJueves,
                        30000
                    );

            }


            actualizarBoton();


        } catch (error) {

            console.warn(
                '[AVISOS] No se pudo iniciar el centro de avisos:',
                error
            );

        }
    }



    // ==========================================================
    // API GLOBAL
    // ==========================================================

    window.AppNotifications = {

        activar,

        desactivar,

        alternar,

        desactivarPushCelular,

        emitir,

        evaluarLisa,

        actualizarBoton,

        avisosActivos,

        get perfil() {

            return perfil;

        }

    };



    // ==========================================================
    // EVENTOS GENERALES
    // ==========================================================

    document.addEventListener(

        'pointerdown',

        desbloquearAudio,

        {
            once: true,
            passive: true
        }

    );


    document.addEventListener(

        'keydown',

        desbloquearAudio,

        {
            once: true
        }

    );


    document.addEventListener(

        'DOMContentLoaded',

        iniciar,

        {
            once: true
        }

    );


    window.addEventListener(
        'beforeunload',
        () => {
            desconectarRealtime();
        }
    );


    window.addEventListener(
        'resize',
        ajustarEscalaAvisos,
        { passive: true }
    );


    window.visualViewport?.addEventListener(
        'resize',
        ajustarEscalaAvisos,
        { passive: true }
    );


    window.addEventListener(
        'appviewchange',
        () => {

            window.requestAnimationFrame(
                ajustarEscalaAvisos
            );

        }
    );


})();