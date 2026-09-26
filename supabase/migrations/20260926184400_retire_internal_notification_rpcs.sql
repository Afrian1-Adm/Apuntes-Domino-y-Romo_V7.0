-- Seguridad · Fase 7
-- Los helpers app_* de notificaciones se ejecutan desde triggers/backend.
-- El único RPC de notificaciones usado por el cliente es registrar_push_subscription.

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname AS schema_name,
               p.proname AS function_name,
               pg_get_function_identity_arguments(p.oid) AS identity_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname = ANY (ARRAY[
              'app_crear_notificacion',
              'app_lider_clasificatoria_semana',
              'app_notificar_miembros_aprobados',
              'app_racha_actual_jugador',
              'app_recordatorio_jueves'
          ]::text[])
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
            r.schema_name,r.function_name,r.identity_args
        );
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
            r.schema_name,r.function_name,r.identity_args
        );
    END LOOP;
END
$$;
