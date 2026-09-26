create or replace function public.recalcular_elo()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    partida record;
    v_elos jsonb;
    elo_j1 numeric;
    elo_j2 numeric;
    elo_j3 numeric;
    elo_j4 numeric;
    elo_rival_p1 numeric;
    elo_rival_p2 numeric;
    exp_j1 numeric;
    exp_j2 numeric;
    exp_j3 numeric;
    exp_j4 numeric;
    resultado_p1 numeric;
    cambio_j1 numeric;
    cambio_j2 numeric;
    cambio_j3 numeric;
    cambio_j4 numeric;
    k_factor numeric := 32;
    total_partidas integer := 0;
    perfiles_actualizados integer := 0;
begin
    perform pg_advisory_xact_lock(hashtextextended('club_domino_elo_v2', 0));

    select coalesce(
        jsonb_object_agg(p.id::text, to_jsonb(1200::integer)),
        '{}'::jsonb
    )
    into v_elos
    from public.perfiles p
    where p.id is not null;

    for partida in
        with manos_ordenadas as (
            select
                me.id as mesa_id,
                me.jugador1_id,
                me.jugador2_id,
                me.jugador3_id,
                me.jugador4_id,
                me.limite_puntos,
                m.id as mano_id,
                coalesce(m.fecha_hora, m.created_at) as fecha_mano,
                sum(coalesce(m.puntos_pareja1, 0)) over (
                    partition by me.id
                    order by coalesce(m.fecha_hora, m.created_at), m.id
                    rows between unbounded preceding and current row
                ) as total_pareja1,
                sum(coalesce(m.puntos_pareja2, 0)) over (
                    partition by me.id
                    order by coalesce(m.fecha_hora, m.created_at), m.id
                    rows between unbounded preceding and current row
                ) as total_pareja2
            from public.mesas me
            join public.manos m on m.mesa_id = me.id
            where me.estado = 'cerrada'
              and coalesce(me.cuenta_tabla_general, true) = true
              and me.limite_puntos is not null
              and coalesce(m.anulada, false) = false
        ), decisivas as (
            select distinct on (mesa_id)
                mesa_id,
                jugador1_id,
                jugador2_id,
                jugador3_id,
                jugador4_id,
                limite_puntos,
                fecha_mano as fecha_final,
                total_pareja1,
                total_pareja2
            from manos_ordenadas
            where total_pareja1 >= limite_puntos
               or total_pareja2 >= limite_puntos
            order by mesa_id, fecha_mano, mano_id
        )
        select *
        from decisivas
        where jugador1_id is not null
          and jugador2_id is not null
          and jugador3_id is not null
          and jugador4_id is not null
          and cardinality(
                array(
                    select distinct x
                    from unnest(array[jugador1_id, jugador2_id, jugador3_id, jugador4_id]) as x
                    where x is not null
                )
              ) = 4
        order by fecha_final, mesa_id
    loop
        elo_j1 := nullif(v_elos ->> partida.jugador1_id::text, '')::numeric;
        elo_j2 := nullif(v_elos ->> partida.jugador2_id::text, '')::numeric;
        elo_j3 := nullif(v_elos ->> partida.jugador3_id::text, '')::numeric;
        elo_j4 := nullif(v_elos ->> partida.jugador4_id::text, '')::numeric;

        if elo_j1 is null or elo_j2 is null or elo_j3 is null or elo_j4 is null then
            continue;
        end if;

        elo_rival_p1 := (elo_j2 + elo_j4) / 2.0;
        elo_rival_p2 := (elo_j1 + elo_j3) / 2.0;

        exp_j1 := 1.0 / (1.0 + power(10.0, (elo_rival_p1 - elo_j1) / 400.0));
        exp_j3 := 1.0 / (1.0 + power(10.0, (elo_rival_p1 - elo_j3) / 400.0));
        exp_j2 := 1.0 / (1.0 + power(10.0, (elo_rival_p2 - elo_j2) / 400.0));
        exp_j4 := 1.0 / (1.0 + power(10.0, (elo_rival_p2 - elo_j4) / 400.0));

        if partida.total_pareja1 > partida.total_pareja2 then
            resultado_p1 := 1;
        elsif partida.total_pareja2 > partida.total_pareja1 then
            resultado_p1 := 0;
        else
            continue;
        end if;

        cambio_j1 := k_factor * (resultado_p1 - exp_j1);
        cambio_j3 := k_factor * (resultado_p1 - exp_j3);
        cambio_j2 := k_factor * ((1.0 - resultado_p1) - exp_j2);
        cambio_j4 := k_factor * ((1.0 - resultado_p1) - exp_j4);

        v_elos := jsonb_set(v_elos, array[partida.jugador1_id::text], to_jsonb(round(elo_j1 + cambio_j1)::integer), true);
        v_elos := jsonb_set(v_elos, array[partida.jugador3_id::text], to_jsonb(round(elo_j3 + cambio_j3)::integer), true);
        v_elos := jsonb_set(v_elos, array[partida.jugador2_id::text], to_jsonb(round(elo_j2 + cambio_j2)::integer), true);
        v_elos := jsonb_set(v_elos, array[partida.jugador4_id::text], to_jsonb(round(elo_j4 + cambio_j4)::integer), true);

        total_partidas := total_partidas + 1;
    end loop;

    update public.perfiles p
       set elo = calculado.elo
      from (
          select key::uuid as id, value::integer as elo
          from jsonb_each_text(v_elos)
      ) calculado
     where p.id = calculado.id
       and p.elo is distinct from calculado.elo;

    get diagnostics perfiles_actualizados = row_count;

    return jsonb_build_object(
        'success', true,
        'version', 'elo_v2_canonico_optimizado',
        'partidas_procesadas', total_partidas,
        'perfiles_actualizados', perfiles_actualizados,
        'mensaje', 'Elo reconstruido desde partidas canónicas con escritura consolidada'
    );
exception
    when others then
        return jsonb_build_object(
            'success', false,
            'version', 'elo_v2_canonico_optimizado',
            'error', sqlerrm
        );
end;
$function$;

create or replace function public.ejecutar_recalculo_elo_al_finalizar_partida()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_limite_puntos integer;
    v_total_pareja1 integer;
    v_total_pareja2 integer;
    v_estado text;
    v_cuenta_tabla boolean;
    v_partida_terminada boolean := false;
    v_debe_recalcular boolean := false;
    v_resultado jsonb;
begin
    select
        coalesce(limite_puntos, 200),
        estado,
        coalesce(cuenta_tabla_general, true)
    into
        v_limite_puntos,
        v_estado,
        v_cuenta_tabla
    from public.mesas
    where id = new.mesa_id;

    if not found or v_cuenta_tabla is false then
        return new;
    end if;

    select
        coalesce(sum(puntos_pareja1), 0),
        coalesce(sum(puntos_pareja2), 0)
    into
        v_total_pareja1,
        v_total_pareja2
    from public.manos
    where mesa_id = new.mesa_id
      and coalesce(anulada, false) = false;

    v_partida_terminada :=
        v_total_pareja1 >= v_limite_puntos
        or v_total_pareja2 >= v_limite_puntos;

    if tg_op = 'INSERT' then
        v_debe_recalcular := v_estado = 'cerrada' and v_partida_terminada;
    elsif tg_op = 'UPDATE' then
        v_debe_recalcular := v_estado = 'cerrada';
    end if;

    if v_debe_recalcular then
        v_resultado := public.recalcular_elo();

        insert into public.elo_trigger_log (
            mesa_id,
            accion,
            limite_puntos,
            total_pareja1,
            total_pareja2,
            partida_terminada,
            resultado_recalculo
        ) values (
            new.mesa_id,
            tg_op,
            v_limite_puntos,
            v_total_pareja1,
            v_total_pareja2,
            v_partida_terminada,
            v_resultado
        );

        if coalesce((v_resultado->>'success')::boolean, false) = false then
            raise exception 'Error recalculando Elo: %', v_resultado;
        end if;
    end if;

    return new;
end;
$function$;