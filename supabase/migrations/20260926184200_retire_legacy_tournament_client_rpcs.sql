-- Seguridad · Fase 6
-- Retira del API cliente las acciones del sistema de torneos heredado.
-- El frontend actual usa exclusivamente torneo_v2_* y torneo_v12_*.
-- Los helpers requeridos por RLS, como es_admin_torneos(), se conservan.

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
              'abrir_enfrentamiento_torneo',
              'abrir_inscripciones_torneo_admin',
              'abrir_partida_equipo_ab_admin',
              'cancelar_torneo_admin',
              'cerrar_inscripciones_torneo_admin',
              'crear_equipos_ab_admin',
              'crear_pareja_torneo',
              'crear_pareja_torneo_admin',
              'crear_partida_equipo_ab_admin',
              'editar_torneo_admin',
              'eliminar_torneo_admin',
              'finalizar_torneo_admin',
              'generar_siguiente_ronda_suizo',
              'generar_torneo_parejas',
              'guardar_pareja_equipo_ab',
              'inscribir_jugador_torneo_admin',
              'inscribirme_en_torneo',
              'procesar_mesa_equipo_ab',
              'procesar_mesa_torneo',
              'remover_jugador_torneo_admin',
              'responder_solicitud_pareja',
              'responder_solicitud_pareja_admin',
              'retirarme_de_torneo',
              'sincronizar_torneo_equipo_ab',
              'solicitar_pareja_torneo',
              'torneo_v11_configurar_rondas_rotando'
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
