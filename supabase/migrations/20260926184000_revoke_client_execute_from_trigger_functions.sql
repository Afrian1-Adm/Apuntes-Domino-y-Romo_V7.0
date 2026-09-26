-- Seguridad · Fase 5
-- Ninguna función que retorna trigger debe exponerse como RPC a clientes.

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
          AND p.prorettype='trigger'::regtype
          AND p.prosecdef=true
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
