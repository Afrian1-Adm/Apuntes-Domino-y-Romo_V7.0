-- Seguridad · Fase 1
--
-- Estas funciones son callbacks de triggers de PostgreSQL. No forman parte de
-- la API que el navegador debe invocar directamente. Los triggers continúan
-- ejecutándolas con normalidad aunque se retire EXECUTE a roles cliente.
--
-- La migración usa descubrimiento por catálogo para no fallar si alguna función
-- fue retirada o renombrada antes de aplicarse.

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT
            n.nspname AS schema_name,
            p.proname AS function_name,
            pg_get_function_identity_arguments(p.oid) AS identity_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND pg_get_function_identity_arguments(p.oid) = ''
          AND p.proname = ANY (ARRAY[
              'cerrar_mesa_si_termino',
              'trg_procesar_mesa_equipo_ab',
              'manos_version_antes_insertar',
              'manos_version_despues_actualizar',
              'manos_version_despues_eliminar',
              'trigger_procesar_mesa_torneo_mano',
              'torneo_v2_trigger_mano',
              'validar_mano_nueva',
              'ejecutar_recalculo_elo_al_finalizar_partida',
              'app_notificar_logros_cierre_mesa',
              'app_notificar_mesa_iniciada',
              'trigger_procesar_mesa_equipo_ab',
              'trigger_procesar_mesa_torneo'
          ]::text[])
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
            r.schema_name,
            r.function_name,
            r.identity_args
        );

        -- Conservamos una vía explícita para tareas backend/administrativas.
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
            r.schema_name,
            r.function_name,
            r.identity_args
        );
    END LOOP;
END
$$;

COMMENT ON SCHEMA public IS
'API pública de Club Dominó y Romo. Las funciones de trigger no deben exponerse como RPC cliente.';
