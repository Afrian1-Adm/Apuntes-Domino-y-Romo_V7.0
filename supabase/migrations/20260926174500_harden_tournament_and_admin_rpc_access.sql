-- Seguridad · Fase 2
-- Endurece identidad administrativa y separa RPC cliente de helpers internos.

CREATE OR REPLACE FUNCTION public.torneo_v2_perfil_actual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT p.id
    FROM public.perfiles p
    WHERE auth.uid() IS NOT NULL
      AND p.auth_user_id = auth.uid()
      AND COALESCE(p.es_manual, false) = false
      AND p.estado = 'aprobado'::public.estado_usuario
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.torneo_v2_es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.id = public.torneo_v2_perfil_actual()
          AND p.rol IN ('admin'::public.rol_usuario, 'super_admin'::public.rol_usuario)
    );
$$;

CREATE OR REPLACE FUNCTION public.es_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.id = private.perfil_actual_id()
          AND COALESCE(p.es_manual, false) = false
          AND p.estado = 'aprobado'::public.estado_usuario
          AND p.rol = 'super_admin'::public.rol_usuario
    );
$$;

-- Ninguna operación de torneo/tómbola requiere una sesión anónima.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname AS schema_name,
               p.proname AS function_name,
               pg_get_function_identity_arguments(p.oid) AS identity_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname LIKE 'torneo_v2_%' OR p.proname LIKE 'tombola_%')
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
            r.schema_name,
            r.function_name,
            r.identity_args
        );
    END LOOP;
END
$$;

-- Gestión de perfiles administrativos: siempre con sesión autenticada.
REVOKE EXECUTE ON FUNCTION public.cambiar_estado_perfil(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cambiar_rol_perfil(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.editar_perfil(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_super_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.listar_codigos_vinculacion_manual() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.regenerar_codigo_vinculacion(uuid) FROM PUBLIC, anon;

-- Helpers internos: solo backend/funciones SECURITY DEFINER propietarias.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname AS schema_name,
               p.proname AS function_name,
               pg_get_function_identity_arguments(p.oid) AS identity_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY (ARRAY[
              'torneo_v2_preparar_jugadores_partida',
              'torneo_v2_procesar_mesa',
              'torneo_v2_validar_parejas_completas',
              'torneo_v2_iniciar_equipo_ab',
              'torneo_v2_generar_eliminacion',
              'torneo_v2_generar_eliminacion_series',
              'torneo_v2_generar_rotando',
              'torneo_v2_generar_suizo_inicial',
              'torneo_v2_generar_todos_contra_todos',
              'torneo_v2_finalizar_clasificacion_parejas',
              'torneo_v2_finalizar_rotando',
              'torneo_v2_set_updated_at'
          ]::text[])
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
            r.schema_name,
            r.function_name,
            r.identity_args
        );
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
            r.schema_name,
            r.function_name,
            r.identity_args
        );
    END LOOP;
END
$$;
