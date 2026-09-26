-- Seguridad · Fase 4
-- Elimina la ejecución anónima heredada de funciones SECURITY DEFINER.
-- Mantiene exactamente el acceso que cada función tenía para authenticated.
-- Solo quedan anónimas las RPC explícitamente necesarias antes de iniciar sesión.

DO $$
DECLARE
    r record;
    v_authenticated_had_execute boolean;
    v_service_had_execute boolean;
BEGIN
    FOR r IN
        SELECT p.oid,
               n.nspname AS schema_name,
               p.proname AS function_name,
               pg_get_function_identity_arguments(p.oid) AS identity_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.prosecdef = true
          AND NOT (
              (p.proname='username_disponible' AND pg_get_function_identity_arguments(p.oid)='p_username text')
              OR
              (p.proname='validar_codigo_registro' AND pg_get_function_identity_arguments(p.oid)='p_codigo text')
          )
    LOOP
        v_authenticated_had_execute := has_function_privilege('authenticated', r.oid, 'EXECUTE');
        v_service_had_execute := has_function_privilege('service_role', r.oid, 'EXECUTE');

        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
            r.schema_name,r.function_name,r.identity_args
        );

        IF v_authenticated_had_execute THEN
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
                r.schema_name,r.function_name,r.identity_args
            );
        END IF;

        IF v_service_had_execute THEN
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
                r.schema_name,r.function_name,r.identity_args
            );
        END IF;
    END LOOP;
END
$$;
