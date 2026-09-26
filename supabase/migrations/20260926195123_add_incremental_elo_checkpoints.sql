create schema if not exists private;

create table if not exists private.elo_partidas_canonicas (
    mesa_id uuid primary key,
    fecha_final timestamptz not null,
    jugador1_id uuid not null,
    jugador2_id uuid not null,
    jugador3_id uuid not null,
    jugador4_id uuid not null,
    total_pareja1 integer not null,
    total_pareja2 integer not null,
    updated_at timestamptz not null default now()
);

create index if not exists idx_elo_partidas_canonicas_orden
    on private.elo_partidas_canonicas (fecha_final, mesa_id);

create table if not exists private.elo_checkpoints (
    partidas_procesadas integer primary key check (partidas_procesadas > 0),
    ultima_fecha timestamptz not null,
    ultima_mesa_id uuid not null,
    elos jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists idx_elo_checkpoints_cursor
    on private.elo_checkpoints (ultima_fecha, ultima_mesa_id);

create index if not exists idx_manos_mesa_fecha_elo
    on public.manos (mesa_id, (coalesce(fecha_hora, created_at)), id)
    where coalesce(anulada, false) = false;

revoke all on private.elo_partidas_canonicas from public, anon, authenticated;
revoke all on private.elo_checkpoints from public, anon, authenticated;

create or replace function private.refrescar_partida_elo(p_mesa_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_mesa record;
    v_decisiva record;
    v_filas integer := 0;
begin
    select
        me.id,
        me.estado,
        coalesce(me.cuenta_tabla_general, true) as cuenta_tabla_general,
        coalesce(me.limite_puntos, 200) as limite_puntos,
        me.jugador1_id,
        me.jugador2_id,
        me.jugador3_id,
        me.jugador4_id
    into v_mesa
    from public.mesas me
    where me.id = p_mesa_id;

    if not found
       or v_mesa.estado <> 'cerrada'
       or v_mesa.cuenta_tabla_general is false
       or v_mesa.jugador1_id is null
       or v_mesa.jugador2_id is null
       or v_mesa.jugador3_id is null
       or v_mesa.jugador4_id is null
       or cardinality(
            array(
                select distinct x
                from unnest(array[
                    v_mesa.jugador1_id,
                    v_mesa.jugador2_id,
                    v_mesa.jugador3_id,
                    v_mesa.jugador4_id
                ]) as x
                where x is not null
            )
          ) <> 4
       or not exists (select 1 from public.perfiles p where p.id = v_mesa.jugador1_id)
       or not exists (select 1 from public.perfiles p where p.id = v_mesa.jugador2_id)
       or not exists (select 1 from public.perfiles p where p.id = v_mesa.jugador3_id)
       or not exists (select 1 from public.perfiles p where p.id = v_mesa.jugador4_id)
    then
        delete from private.elo_partidas_canonicas where mesa_id = p_mesa_id;
        get diagnostics v_filas = row_count;
        return v_filas > 0;
    end if;

    with ordenadas as (
        select
            m.id as mano_id,
            coalesce(m.fecha_hora, m.created_at) as fecha_mano,
            sum(coalesce(m.puntos_pareja1, 0)) over (
                order by coalesce(m.fecha_hora, m.created_at), m.id
                rows between unbounded preceding and current row
            ) as total_pareja1,
            sum(coalesce(m.puntos_pareja2, 0)) over (
                order by coalesce(m.fecha_hora, m.created_at), m.id
                rows between unbounded preceding and current row
            ) as total_pareja2
        from public.manos m
        where m.mesa_id = p_mesa_id
          and coalesce(m.anulada, false) = false
    )
    select
        o.fecha_mano as fecha_final,
        o.total_pareja1::integer as total_pareja1,
        o.total_pareja2::integer as total_pareja2
    into v_decisiva
    from ordenadas o
    where o.total_pareja1 >= v_mesa.limite_puntos
       or o.total_pareja2 >= v_mesa.limite_puntos
    order by o.fecha_mano, o.mano_id
    limit 1;

    if not found or v_decisiva.total_pareja1 = v_decisiva.total_pareja2 then
        delete from private.elo_partidas_canonicas where mesa_id = p_mesa_id;
        get diagnostics v_filas = row_count;
        return v_filas > 0;
    end if;

    insert into private.elo_partidas_canonicas (
        mesa_id,
        fecha_final,
        jugador1_id,
        jugador2_id,
        jugador3_id,
        jugador4_id,
        total_pareja1,
        total_pareja2,
        updated_at
    ) values (
        p_mesa_id,
        v_decisiva.fecha_final,
        v_mesa.jugador1_id,
        v_mesa.jugador2_id,
        v_mesa.jugador3_id,
        v_mesa.jugador4_id,
        v_decisiva.total_pareja1,
        v_decisiva.total_pareja2,
        now()
    )
    on conflict (mesa_id) do update
    set
        fecha_final = excluded.fecha_final,
        jugador1_id = excluded.jugador1_id,
        jugador2_id = excluded.jugador2_id,
        jugador3_id = excluded.jugador3_id,
        jugador4_id = excluded.jugador4_id,
        total_pareja1 = excluded.total_pareja1,
        total_pareja2 = excluded.total_pareja2,
        updated_at = now()
    where (
        private.elo_partidas_canonicas.fecha_final,
        private.elo_partidas_canonicas.jugador1_id,
        private.elo_partidas_canonicas.jugador2_id,
        private.elo_partidas_canonicas.jugador3_id,
        private.elo_partidas_canonicas.jugador4_id,
        private.elo_partidas_canonicas.total_pareja1,
        private.elo_partidas_canonicas.total_pareja2
    ) is distinct from (
        excluded.fecha_final,
        excluded.jugador1_id,
        excluded.jugador2_id,
        excluded.jugador3_id,
        excluded.jugador4_id,
        excluded.total_pareja1,
        excluded.total_pareja2
    );

    get diagnostics v_filas = row_count;
    return v_filas > 0;
end;
$function$;

revoke all on function private.refrescar_partida_elo(uuid) from public, anon, authenticated;

create or replace function private.reconstruir_elo_desde(
    p_afectado_desde timestamptz default null,
    p_forzar_completo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    partida record;
    v_checkpoint record;
    v_tiene_checkpoint boolean := false;
    v_elos jsonb;
    v_cursor_fecha timestamptz;
    v_cursor_mesa uuid;
    v_ultima_fecha timestamptz;
    v_ultima_mesa uuid;
    v_base_count integer := 0;
    v_current_count integer := 0;
    v_total_canonicas integer := 0;
    v_recalculadas integer := 0;
    v_perfiles_actualizados integer := 0;
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
begin
    perform pg_advisory_xact_lock(hashtextextended('club_domino_elo_v3_checkpoints', 0));

    if not p_forzar_completo and p_afectado_desde is not null then
        select c.*
        into v_checkpoint
        from private.elo_checkpoints c
        where c.ultima_fecha < p_afectado_desde
        order by c.ultima_fecha desc, c.ultima_mesa_id desc
        limit 1;

        v_tiene_checkpoint := found;
    end if;

    if v_tiene_checkpoint then
        v_base_count := v_checkpoint.partidas_procesadas;
        v_current_count := v_base_count;
        v_cursor_fecha := v_checkpoint.ultima_fecha;
        v_cursor_mesa := v_checkpoint.ultima_mesa_id;
        v_elos := v_checkpoint.elos;

        select coalesce(
            jsonb_object_agg(
                p.id::text,
                to_jsonb(coalesce(nullif(v_elos ->> p.id::text, '')::integer, 1200))
            ),
            '{}'::jsonb
        )
        into v_elos
        from public.perfiles p
        where p.id is not null;

        delete from private.elo_checkpoints
        where partidas_procesadas > v_base_count;
    else
        v_base_count := 0;
        v_current_count := 0;
        v_cursor_fecha := null;
        v_cursor_mesa := null;

        select coalesce(
            jsonb_object_agg(p.id::text, to_jsonb(1200::integer)),
            '{}'::jsonb
        )
        into v_elos
        from public.perfiles p
        where p.id is not null;

        delete from private.elo_checkpoints;
    end if;

    for partida in
        select e.*
        from private.elo_partidas_canonicas e
        where v_cursor_fecha is null
           or (e.fecha_final, e.mesa_id) > (v_cursor_fecha, v_cursor_mesa)
        order by e.fecha_final, e.mesa_id
    loop
        elo_j1 := nullif(v_elos ->> partida.jugador1_id::text, '')::numeric;
        elo_j2 := nullif(v_elos ->> partida.jugador2_id::text, '')::numeric;
        elo_j3 := nullif(v_elos ->> partida.jugador3_id::text, '')::numeric;
        elo_j4 := nullif(v_elos ->> partida.jugador4_id::text, '')::numeric;

        if elo_j1 is null or elo_j2 is null or elo_j3 is null or elo_j4 is null then
            raise exception 'Partida % referencia un perfil fuera del mapa ELO', partida.mesa_id;
        end if;

        elo_rival_p1 := (elo_j2 + elo_j4) / 2.0;
        elo_rival_p2 := (elo_j1 + elo_j3) / 2.0;

        exp_j1 := 1.0 / (1.0 + power(10.0, (elo_rival_p1 - elo_j1) / 400.0));
        exp_j3 := 1.0 / (1.0 + power(10.0, (elo_rival_p1 - elo_j3) / 400.0));
        exp_j2 := 1.0 / (1.0 + power(10.0, (elo_rival_p2 - elo_j2) / 400.0));
        exp_j4 := 1.0 / (1.0 + power(10.0, (elo_rival_p2 - elo_j4) / 400.0));

        resultado_p1 := case when partida.total_pareja1 > partida.total_pareja2 then 1 else 0 end;

        cambio_j1 := k_factor * (resultado_p1 - exp_j1);
        cambio_j3 := k_factor * (resultado_p1 - exp_j3);
        cambio_j2 := k_factor * ((1.0 - resultado_p1) - exp_j2);
        cambio_j4 := k_factor * ((1.0 - resultado_p1) - exp_j4);

        v_elos := jsonb_set(v_elos, array[partida.jugador1_id::text], to_jsonb(round(elo_j1 + cambio_j1)::integer), true);
        v_elos := jsonb_set(v_elos, array[partida.jugador3_id::text], to_jsonb(round(elo_j3 + cambio_j3)::integer), true);
        v_elos := jsonb_set(v_elos, array[partida.jugador2_id::text], to_jsonb(round(elo_j2 + cambio_j2)::integer), true);
        v_elos := jsonb_set(v_elos, array[partida.jugador4_id::text], to_jsonb(round(elo_j4 + cambio_j4)::integer), true);

        v_current_count := v_current_count + 1;
        v_recalculadas := v_recalculadas + 1;
        v_ultima_fecha := partida.fecha_final;
        v_ultima_mesa := partida.mesa_id;

        if mod(v_current_count, 100) = 0 then
            insert into private.elo_checkpoints (
                partidas_procesadas,
                ultima_fecha,
                ultima_mesa_id,
                elos,
                updated_at
            ) values (
                v_current_count,
                v_ultima_fecha,
                v_ultima_mesa,
                v_elos,
                now()
            )
            on conflict (partidas_procesadas) do update
            set ultima_fecha = excluded.ultima_fecha,
                ultima_mesa_id = excluded.ultima_mesa_id,
                elos = excluded.elos,
                updated_at = now();
        end if;
    end loop;

    select count(*) into v_total_canonicas from private.elo_partidas_canonicas;

    if v_current_count <> v_total_canonicas then
        raise exception 'Inconsistencia de checkpoint ELO: procesadas %, canónicas %', v_current_count, v_total_canonicas;
    end if;

    update public.perfiles p
       set elo = calculado.elo
      from (
          select key::uuid as id, value::integer as elo
          from jsonb_each_text(v_elos)
      ) calculado
     where p.id = calculado.id
       and p.elo is distinct from calculado.elo;

    get diagnostics v_perfiles_actualizados = row_count;

    if v_total_canonicas = 0 then
        delete from private.elo_checkpoints;
    elsif v_recalculadas > 0 then
        delete from private.elo_checkpoints
        where mod(partidas_procesadas, 100) <> 0
          and partidas_procesadas <> v_current_count;

        insert into private.elo_checkpoints (
            partidas_procesadas,
            ultima_fecha,
            ultima_mesa_id,
            elos,
            updated_at
        ) values (
            v_current_count,
            v_ultima_fecha,
            v_ultima_mesa,
            v_elos,
            now()
        )
        on conflict (partidas_procesadas) do update
        set ultima_fecha = excluded.ultima_fecha,
            ultima_mesa_id = excluded.ultima_mesa_id,
            elos = excluded.elos,
            updated_at = now();
    end if;

    return jsonb_build_object(
        'success', true,
        'version', 'elo_v3_checkpoints',
        'partidas_procesadas', v_total_canonicas,
        'partidas_recalculadas', v_recalculadas,
        'checkpoint_base', v_base_count,
        'perfiles_actualizados', v_perfiles_actualizados
    );
exception
    when others then
        return jsonb_build_object(
            'success', false,
            'version', 'elo_v3_checkpoints',
            'error', sqlerrm
        );
end;
$function$;

revoke all on function private.reconstruir_elo_desde(timestamptz, boolean) from public, anon, authenticated;

create or replace function public.recalcular_elo()
returns jsonb
language sql
security definer
set search_path = ''
as $function$
    select private.reconstruir_elo_desde(null, true);
$function$;

revoke all on function public.recalcular_elo() from public, anon, authenticated;
grant execute on function public.recalcular_elo() to service_role;

delete from private.elo_partidas_canonicas;
do $block$
declare
    r record;
begin
    for r in
        select me.id
        from public.mesas me
        where me.estado = 'cerrada'
          and coalesce(me.cuenta_tabla_general, true) = true
    loop
        perform private.refrescar_partida_elo(r.id);
    end loop;
end;
$block$;

select public.recalcular_elo();

create or replace function private.trg_elo_mano_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_mesa_id uuid;
    v_mesa_ids uuid[];
    v_cambio boolean := false;
    v_cambio_actual boolean;
    v_fecha timestamptz;
    v_afectado_desde timestamptz;
    v_resultado jsonb;
    v_limite integer := 200;
    v_total1 integer := 0;
    v_total2 integer := 0;
    v_terminada boolean := false;
begin
    if tg_op = 'UPDATE' and old.mesa_id is distinct from new.mesa_id then
        v_mesa_ids := array[old.mesa_id, new.mesa_id];
    elsif tg_op = 'DELETE' then
        v_mesa_ids := array[old.mesa_id];
    else
        v_mesa_ids := array[new.mesa_id];
    end if;

    foreach v_mesa_id in array v_mesa_ids
    loop
        if v_mesa_id is null then
            continue;
        end if;

        select me.created_at
        into v_fecha
        from public.mesas me
        where me.id = v_mesa_id;

        if not found then
            continue;
        end if;

        v_cambio_actual := private.refrescar_partida_elo(v_mesa_id);
        v_cambio := v_cambio or v_cambio_actual;

        if v_cambio_actual and (v_afectado_desde is null or v_fecha < v_afectado_desde) then
            v_afectado_desde := v_fecha;
        end if;
    end loop;

    if v_cambio then
        v_resultado := private.reconstruir_elo_desde(v_afectado_desde, false);

        if coalesce((v_resultado ->> 'success')::boolean, false) = false then
            raise exception 'Error recalculando Elo incremental: %', v_resultado;
        end if;

        v_mesa_id := coalesce(case when tg_op <> 'DELETE' then new.mesa_id end, old.mesa_id);

        select
            coalesce(me.limite_puntos, 200),
            coalesce(sum(m.puntos_pareja1) filter (where coalesce(m.anulada, false) = false), 0)::integer,
            coalesce(sum(m.puntos_pareja2) filter (where coalesce(m.anulada, false) = false), 0)::integer
        into v_limite, v_total1, v_total2
        from public.mesas me
        left join public.manos m on m.mesa_id = me.id
        where me.id = v_mesa_id
        group by me.limite_puntos;

        v_terminada := exists (
            select 1 from private.elo_partidas_canonicas e where e.mesa_id = v_mesa_id
        );

        insert into public.elo_trigger_log (
            mesa_id, accion, limite_puntos, total_pareja1, total_pareja2,
            partida_terminada, resultado_recalculo
        ) values (
            v_mesa_id, tg_op, v_limite, v_total1, v_total2,
            v_terminada, v_resultado
        );
    end if;

    return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function private.trg_elo_mesa_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_mesa_id uuid := coalesce(new.id, old.id);
    v_cambio boolean := false;
    v_afectado_desde timestamptz := coalesce(old.created_at, new.created_at);
    v_resultado jsonb;
    v_limite integer := coalesce(new.limite_puntos, old.limite_puntos, 200);
    v_total1 integer := 0;
    v_total2 integer := 0;
    v_terminada boolean := false;
begin
    if tg_op = 'DELETE' then
        delete from private.elo_partidas_canonicas where mesa_id = old.id;
        get diagnostics v_total1 = row_count;
        v_cambio := v_total1 > 0;
        v_total1 := 0;
    else
        v_cambio := private.refrescar_partida_elo(v_mesa_id);
    end if;

    if not v_cambio then
        return case when tg_op = 'DELETE' then old else new end;
    end if;

    v_resultado := private.reconstruir_elo_desde(v_afectado_desde, false);
    if coalesce((v_resultado ->> 'success')::boolean, false) = false then
        raise exception 'Error recalculando Elo por cambio de mesa: %', v_resultado;
    end if;

    if tg_op <> 'DELETE' then
        select
            coalesce(sum(m.puntos_pareja1) filter (where coalesce(m.anulada, false) = false), 0)::integer,
            coalesce(sum(m.puntos_pareja2) filter (where coalesce(m.anulada, false) = false), 0)::integer
        into v_total1, v_total2
        from public.manos m
        where m.mesa_id = v_mesa_id;
    end if;

    v_terminada := exists (
        select 1 from private.elo_partidas_canonicas e where e.mesa_id = v_mesa_id
    );

    insert into public.elo_trigger_log (
        mesa_id, accion, limite_puntos, total_pareja1, total_pareja2,
        partida_terminada, resultado_recalculo
    ) values (
        v_mesa_id, tg_op || '_MESA', v_limite, v_total1, v_total2,
        v_terminada, v_resultado
    );

    return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function private.trg_elo_mano_checkpoint() from public, anon, authenticated;
revoke all on function private.trg_elo_mesa_checkpoint() from public, anon, authenticated;

drop trigger if exists trigger_recalcular_elo_final on public.manos;
drop function if exists public.ejecutar_recalculo_elo_al_finalizar_partida();

create trigger trigger_elo_checkpoint_manos
after insert or delete or update of mesa_id, puntos_pareja1, puntos_pareja2, anulada, fecha_hora, created_at
on public.manos
for each row
execute function private.trg_elo_mano_checkpoint();

create trigger trigger_elo_checkpoint_mesas_insert
after insert on public.mesas
for each row
execute function private.trg_elo_mesa_checkpoint();

create trigger trigger_elo_checkpoint_mesas_update
after update of estado, cuenta_tabla_general, jugador1_id, jugador2_id, jugador3_id, jugador4_id, limite_puntos
on public.mesas
for each row
execute function private.trg_elo_mesa_checkpoint();

create trigger trigger_elo_checkpoint_mesas_delete
after delete on public.mesas
for each row
execute function private.trg_elo_mesa_checkpoint();
