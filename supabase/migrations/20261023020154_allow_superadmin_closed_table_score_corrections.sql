create or replace function private.reconciliar_estado_mesa_por_manos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_mesa_id uuid;
    v_limite integer;
    v_p1 integer;
    v_p2 integer;
    v_conflicto boolean := false;
begin
    v_mesa_id := coalesce(new.mesa_id, old.mesa_id);

    select coalesce(m.limite_puntos, 200)
      into v_limite
      from public.mesas m
     where m.id = v_mesa_id;

    if not found then
        return coalesce(new, old);
    end if;

    select
        coalesce(sum(h.puntos_pareja1), 0)::integer,
        coalesce(sum(h.puntos_pareja2), 0)::integer
      into v_p1, v_p2
      from public.manos h
     where h.mesa_id = v_mesa_id
       and coalesce(h.anulada, false) = false;

    if v_p1 >= v_limite or v_p2 >= v_limite then
        update public.mesas
           set estado = 'cerrada'
         where id = v_mesa_id
           and estado is distinct from 'cerrada';
        return coalesce(new, old);
    end if;

    select exists (
        select 1
          from public.mesas objetivo
          join public.mesas otra
            on otra.id <> objetivo.id
           and otra.estado = 'abierta'
           and array[
                objetivo.jugador1_id,
                objetivo.jugador2_id,
                objetivo.jugador3_id,
                objetivo.jugador4_id
           ]::uuid[] && array[
                otra.jugador1_id,
                otra.jugador2_id,
                otra.jugador3_id,
                otra.jugador4_id
           ]::uuid[]
         where objetivo.id = v_mesa_id
    )
    into v_conflicto;

    if not v_conflicto then
        update public.mesas
           set estado = 'abierta'
         where id = v_mesa_id
           and estado is distinct from 'abierta';
    end if;

    return coalesce(new, old);
end;
$$;

create or replace function public.registrar_mano_segura(
    p_mesa_id uuid,
    p_puntos_pareja1 integer,
    p_puntos_pareja2 integer,
    p_version_esperada bigint,
    p_submission_id uuid,
    p_creado_en timestamp with time zone default null::timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_uid uuid := auth.uid();
    v_perfil public.perfiles%ROWTYPE;
    v_mesa public.mesas%ROWTYPE;
    v_mano_existente public.manos%ROWTYPE;
    v_version_actual bigint;
    v_version_nueva bigint;
    v_mano_id uuid;
    v_score_p1 bigint := 0;
    v_score_p2 bigint := 0;
    v_limite integer := 200;
    v_fecha timestamptz := COALESCE(p_creado_en, now());
    v_es_super_admin boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false,'codigo', 'NO_AUTENTICADO','mensaje', 'Debes iniciar sesión para anotar.');
    END IF;

    IF p_mesa_id IS NULL OR p_version_esperada IS NULL OR p_submission_id IS NULL THEN
        RETURN jsonb_build_object('success', false,'codigo', 'DATOS_INCOMPLETOS','mensaje', 'Faltan datos de control de la mano.');
    END IF;

    IF COALESCE(p_puntos_pareja1, 0) < 0
       OR COALESCE(p_puntos_pareja2, 0) < 0
       OR (COALESCE(p_puntos_pareja1, 0) = 0 AND COALESCE(p_puntos_pareja2, 0) = 0) THEN
        RETURN jsonb_build_object('success', false,'codigo', 'PUNTOS_INVALIDOS','mensaje', 'Los puntos de la mano no son válidos.');
    END IF;

    SELECT p.* INTO v_perfil
    FROM public.perfiles p
    WHERE p.auth_user_id = v_uid OR p.id = v_uid
    ORDER BY CASE WHEN p.auth_user_id = v_uid THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false,'codigo', 'PERFIL_NO_ENCONTRADO','mensaje', 'No se encontró tu perfil de jugador.');
    END IF;

    IF COALESCE(v_perfil.estado::text, '') <> 'aprobado' THEN
        RETURN jsonb_build_object('success', false,'codigo', 'PERFIL_NO_APROBADO','mensaje', 'Tu perfil no está habilitado para anotar.');
    END IF;

    v_es_super_admin := COALESCE(v_perfil.rol::text, '') = 'super_admin';

    SELECT me.* INTO v_mesa
    FROM public.mesas me
    WHERE me.id = p_mesa_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false,'codigo', 'MESA_NO_ENCONTRADA','mensaje', 'La mesa ya no existe.');
    END IF;

    IF NOT v_es_super_admin
       AND v_perfil.id IS DISTINCT FROM v_mesa.jugador1_id
       AND v_perfil.id IS DISTINCT FROM v_mesa.jugador2_id
       AND v_perfil.id IS DISTINCT FROM v_mesa.jugador3_id
       AND v_perfil.id IS DISTINCT FROM v_mesa.jugador4_id THEN
        RETURN jsonb_build_object('success', false,'codigo', 'SIN_PERMISO','mensaje', 'No tienes permiso para anotar en esta mesa.');
    END IF;

    v_version_actual := COALESCE(v_mesa.version_mano, 0);
    v_limite := COALESCE(v_mesa.limite_puntos, 200);

    SELECT m.* INTO v_mano_existente
    FROM public.manos m
    WHERE m.submission_id = p_submission_id
    LIMIT 1;

    IF FOUND THEN
        IF v_mano_existente.mesa_id = p_mesa_id
           AND v_mano_existente.creado_por = v_perfil.id THEN
            RETURN jsonb_build_object('success', true,'codigo', 'YA_REGISTRADA','mano_id', v_mano_existente.id,'version_nueva', v_version_actual,'mensaje', 'La mano ya había sido registrada.');
        END IF;

        RETURN jsonb_build_object('success', false,'codigo', 'SUBMISSION_ID_EN_USO','mensaje', 'El identificador de esta operación ya fue utilizado.');
    END IF;

    IF COALESCE(v_mesa.estado, 'abierta') <> 'abierta'
       AND NOT v_es_super_admin THEN
        RETURN jsonb_build_object('success', false,'codigo', 'MESA_CERRADA','mensaje', 'La partida ya está cerrada.','version_actual', v_version_actual);
    END IF;

    IF v_version_actual <> p_version_esperada THEN
        SELECT
            COALESCE(SUM(CASE WHEN COALESCE(anulada, false) = false THEN puntos_pareja1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN COALESCE(anulada, false) = false THEN puntos_pareja2 ELSE 0 END), 0)
        INTO v_score_p1, v_score_p2
        FROM public.manos
        WHERE mesa_id = p_mesa_id;

        RETURN jsonb_build_object(
            'success', false,'codigo', 'CONFLICTO_VERSION',
            'mensaje', 'Otro jugador anotó o corrigió la mesa antes que tú. Revisa el marcador antes de volver a guardar.',
            'version_esperada', p_version_esperada,'version_actual', v_version_actual,
            'score_p1', v_score_p1,'score_p2', v_score_p2
        );
    END IF;

    SELECT
        COALESCE(SUM(CASE WHEN COALESCE(anulada, false) = false THEN puntos_pareja1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(anulada, false) = false THEN puntos_pareja2 ELSE 0 END), 0)
    INTO v_score_p1, v_score_p2
    FROM public.manos
    WHERE mesa_id = p_mesa_id;

    IF v_score_p1 >= v_limite OR v_score_p2 >= v_limite THEN
        UPDATE public.mesas
        SET estado = 'cerrada'
        WHERE id = p_mesa_id
          AND COALESCE(estado, 'abierta') = 'abierta';

        RETURN jsonb_build_object(
            'success', false,'codigo', 'PARTIDA_FINALIZADA',
            'mensaje', 'La partida ya había alcanzado la meta. No se agregó otra mano.',
            'version_actual', v_version_actual,'score_p1', v_score_p1,'score_p2', v_score_p2
        );
    END IF;

    INSERT INTO public.manos (
        mesa_id,puntos_pareja1,puntos_pareja2,creado_por,creado_en,anulada,fecha_hora,created_at,submission_id
    )
    VALUES (
        p_mesa_id,COALESCE(p_puntos_pareja1, 0),COALESCE(p_puntos_pareja2, 0),
        v_perfil.id,v_fecha,false,v_fecha,v_fecha,p_submission_id
    )
    RETURNING id INTO v_mano_id;

    SELECT COALESCE(version_mano, 0)
    INTO v_version_nueva
    FROM public.mesas
    WHERE id = p_mesa_id;

    SELECT
        COALESCE(SUM(CASE WHEN COALESCE(anulada, false) = false THEN puntos_pareja1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(anulada, false) = false THEN puntos_pareja2 ELSE 0 END), 0)
    INTO v_score_p1, v_score_p2
    FROM public.manos
    WHERE mesa_id = p_mesa_id;

    RETURN jsonb_build_object(
        'success', true,'codigo', 'OK','mano_id', v_mano_id,
        'version_anterior', v_version_actual,'version_nueva', v_version_nueva,
        'score_p1', v_score_p1,'score_p2', v_score_p2,
        'finalizada', (v_score_p1 >= v_limite OR v_score_p2 >= v_limite),
        'correccion_admin', (COALESCE(v_mesa.estado, 'abierta') <> 'abierta' AND v_es_super_admin)
    );
END;
$function$;

revoke all on function public.registrar_mano_segura(uuid,integer,integer,bigint,uuid,timestamptz) from public, anon;
grant execute on function public.registrar_mano_segura(uuid,integer,integer,bigint,uuid,timestamptz) to authenticated, service_role;
