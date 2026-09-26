-- Seguridad · Fase 9
-- Helpers de autorización usados internamente por funciones SECURITY DEFINER.
-- tombola_perfil_actual_id() se conserva para authenticated porque RLS lo utiliza.

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
              'torneo_v2_es_admin',
              'torneo_v2_perfil_actual',
              'tombola_es_admin',
              'es_lider_de_lado_torneo_equipo',
              'es_lider_torneo_equipo'
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
