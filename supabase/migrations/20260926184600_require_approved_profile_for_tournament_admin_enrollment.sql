-- Seguridad e integridad · Fase 8
-- Administración solo puede añadir al torneo perfiles actualmente aprobados.

CREATE OR REPLACE FUNCTION public.torneo_v2_admin_inscribir(
    p_torneo_id uuid,
    p_jugador_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_estado text;
BEGIN
    IF NOT public.torneo_v2_es_admin() THEN
        RETURN jsonb_build_object('success',false,'error','Sin permiso.');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.id = p_jugador_id
          AND lower(coalesce(p.estado::text,'')) = 'aprobado'
    ) THEN
        RETURN jsonb_build_object(
            'success',false,
            'error','Solo se pueden inscribir perfiles aprobados.'
        );
    END IF;

    SELECT estado INTO v_estado
    FROM public.torneos_v2
    WHERE id=p_torneo_id;

    IF v_estado NOT IN ('inscripciones','cerrado') THEN
        RETURN jsonb_build_object(
            'success',false,
            'error','Ya no se pueden modificar los inscritos.'
        );
    END IF;

    INSERT INTO public.torneo_v2_participantes(
        torneo_id,jugador_id,estado
    )
    VALUES(
        p_torneo_id,p_jugador_id,'inscrito'
    )
    ON CONFLICT(torneo_id,jugador_id)
    DO UPDATE SET estado='inscrito';

    RETURN jsonb_build_object('success',true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.torneo_v2_admin_inscribir(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.torneo_v2_admin_inscribir(uuid,uuid) TO authenticated, service_role;
