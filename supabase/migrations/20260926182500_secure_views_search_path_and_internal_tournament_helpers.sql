-- Seguridad · Fase 3
-- Vistas con permisos del invocador, RLS explícito para agregados públicos autenticados,
-- search_path fijo y helpers internos fuera del API cliente.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='estadisticas_clutch'
          AND policyname='estadisticas_clutch_lectura_autenticados'
    ) THEN
        CREATE POLICY estadisticas_clutch_lectura_autenticados
        ON public.estadisticas_clutch
        FOR SELECT TO authenticated
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='jugador_semana'
          AND policyname='jugador_semana_lectura_autenticados'
    ) THEN
        CREATE POLICY jugador_semana_lectura_autenticados
        ON public.jugador_semana
        FOR SELECT TO authenticated
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='rachas_jugadores'
          AND policyname='rachas_jugadores_lectura_autenticados'
    ) THEN
        CREATE POLICY rachas_jugadores_lectura_autenticados
        ON public.rachas_jugadores
        FOR SELECT TO authenticated
        USING (true);
    END IF;
END
$$;

ALTER VIEW public.vista_promedio_diferencial SET (security_invoker = true);
ALTER VIEW public.v_top_10_parejas SET (security_invoker = true);
ALTER VIEW public.v_top_3_rachas SET (security_invoker = true);
ALTER VIEW public.v_jugador_semana_actual SET (security_invoker = true);
ALTER VIEW public.v_jugador_clutch SET (security_invoker = true);
ALTER VIEW public.vw_torneo_v2_parejas_stats SET (security_invoker = true);
ALTER VIEW public.vw_torneo_v2_ab_parejas_stats SET (security_invoker = true);
ALTER VIEW public.vw_torneo_v2_rotando_stats SET (security_invoker = true);

DO $$
DECLARE
    v text;
BEGIN
    FOREACH v IN ARRAY ARRAY[
        'vista_promedio_diferencial','v_top_10_parejas','v_top_3_rachas',
        'v_jugador_semana_actual','v_jugador_clutch','vw_torneo_v2_parejas_stats',
        'vw_torneo_v2_ab_parejas_stats','vw_torneo_v2_rotando_stats'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v);
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v);
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', v);
    END LOOP;
END
$$;

ALTER FUNCTION public.actualizar_estado_usuario() SET search_path TO '';
ALTER FUNCTION public.torneo_partidas_equipo_updated_at() SET search_path TO '';
ALTER FUNCTION public.torneos_set_updated_at() SET search_path TO '';
ALTER FUNCTION public.torneo_v2_set_updated_at() SET search_path TO '';

REVOKE EXECUTE ON FUNCTION public.actualizar_estado_usuario() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.torneo_partidas_equipo_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.torneos_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.torneo_v2_set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.actualizar_estado_usuario() TO service_role;
GRANT EXECUTE ON FUNCTION public.torneo_partidas_equipo_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.torneos_set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.torneo_v2_set_updated_at() TO service_role;

ALTER FUNCTION public.obtener_jugador_on_fire_fn() SET search_path TO 'public';

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
              'torneo_v3_after_partida_finalizada',
              'torneo_v3_cerrar_mesas_vencidas',
              'torneo_v3_generar_desempate_parejas',
              'torneo_v3_generar_desempate_rotando',
              'torneo_v4_rotando_rellenar_cola',
              'torneo_v4_trigger_cola_partida',
              'torneo_v4_trigger_iniciar_cola',
              'torneo_v5_rotando_rellenar_mesas',
              'torneo_v5_trigger_rotando_mesa_finalizada',
              'torneo_v7_crear_partida_serie',
              'torneo_v7_trigger_partida_serie',
              'trg_mesa_estado_equipo_ab'
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
