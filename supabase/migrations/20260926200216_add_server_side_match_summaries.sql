create table if not exists public.partidas_resumen (
    mesa_id uuid primary key references public.mesas(id) on delete cascade,
    mesa_created_at timestamptz,
    fecha_final timestamptz not null,
    limite_puntos integer not null,
    jugador1_id uuid not null,
    jugador2_id uuid not null,
    jugador3_id uuid not null,
    jugador4_id uuid not null,
    cuenta_tabla_general boolean not null default true,
    torneo_v2_id uuid,
    puntos_pareja1 integer not null,
    puntos_pareja2 integer not null,
    rondas integer not null,
    ganador smallint not null check (ganador in (1,2)),
    es_lisa boolean not null,
    diferencial integer not null,
    clutch_winner_team smallint not null default 0 check (clutch_winner_team in (0,1,2)),
    updated_at timestamptz not null default now()
);

create index if not exists idx_partidas_resumen_fecha
    on public.partidas_resumen (fecha_final desc, mesa_id);
create index if not exists idx_partidas_resumen_general_fecha
    on public.partidas_resumen (fecha_final desc, mesa_id)
    where cuenta_tabla_general = true;
create index if not exists idx_partidas_resumen_j1 on public.partidas_resumen (jugador1_id);
create index if not exists idx_partidas_resumen_j2 on public.partidas_resumen (jugador2_id);
create index if not exists idx_partidas_resumen_j3 on public.partidas_resumen (jugador3_id);
create index if not exists idx_partidas_resumen_j4 on public.partidas_resumen (jugador4_id);

alter table public.partidas_resumen enable row level security;
revoke all on public.partidas_resumen from public, anon, authenticated;
grant select on public.partidas_resumen to authenticated;

drop policy if exists partidas_resumen_lectura_autenticados on public.partidas_resumen;
create policy partidas_resumen_lectura_autenticados
on public.partidas_resumen
for select
to authenticated
using (true);

create or replace function private.refrescar_partida_resumen(p_mesa_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_mesa record;
    v_fecha_final timestamptz;
    v_rondas integer;
    v_total1 integer;
    v_total2 integer;
    v_clutch1 boolean := false;
    v_clutch2 boolean := false;
    v_filas integer := 0;
begin
    select
        me.id,
        me.created_at,
        me.estado,
        coalesce(me.limite_puntos, 200) as limite_puntos,
        me.jugador1_id,
        me.jugador2_id,
        me.jugador3_id,
        me.jugador4_id,
        coalesce(me.cuenta_tabla_general, true) as cuenta_tabla_general,
        me.torneo_v2_id
    into v_mesa
    from public.mesas me
    where me.id = p_mesa_id;

    if not found
       or v_mesa.estado <> 'cerrada'
       or v_mesa.jugador1_id is null
       or v_mesa.jugador2_id is null
       or v_mesa.jugador3_id is null
       or v_mesa.jugador4_id is null
       or cardinality(array(
            select distinct x
            from unnest(array[
                v_mesa.jugador1_id,
                v_mesa.jugador2_id,
                v_mesa.jugador3_id,
                v_mesa.jugador4_id
            ]) x
            where x is not null
       )) <> 4
    then
        delete from public.partidas_resumen where mesa_id = p_mesa_id;
        get diagnostics v_filas = row_count;
        return v_filas > 0;
    end if;

    with ordenadas as (
        select
            m.id as mano_id,
            m.created_at as fecha_mano,
            row_number() over (order by m.created_at, m.id) as ronda,
            sum(coalesce(m.puntos_pareja1,0)) over (
                order by m.created_at, m.id
                rows between unbounded preceding and current row
            )::integer as total1,
            sum(coalesce(m.puntos_pareja2,0)) over (
                order by m.created_at, m.id
                rows between unbounded preceding and current row
            )::integer as total2
        from public.manos m
        where m.mesa_id = p_mesa_id
          and coalesce(m.anulada,false) = false
    ), marcada as (
        select
            o.*,
            min(o.ronda) filter (
                where o.total1 >= v_mesa.limite_puntos
                   or o.total2 >= v_mesa.limite_puntos
            ) over () as ronda_decisiva
        from ordenadas o
    ), decisiva as (
        select *
        from marcada
        where ronda = ronda_decisiva
        limit 1
    )
    select
        d.fecha_mano,
        d.ronda::integer,
        d.total1,
        d.total2,
        coalesce(bool_or(
            (x.total2 >= greatest(v_mesa.limite_puntos - 20, 0))
            and (x.total2 - x.total1) >= 100
        ) filter (where x.ronda <= d.ronda), false),
        coalesce(bool_or(
            (x.total1 >= greatest(v_mesa.limite_puntos - 20, 0))
            and (x.total1 - x.total2) >= 100
        ) filter (where x.ronda <= d.ronda), false)
    into v_fecha_final, v_rondas, v_total1, v_total2, v_clutch1, v_clutch2
    from decisiva d
    join marcada x on true
    group by d.fecha_mano, d.ronda, d.total1, d.total2;

    if not found or v_total1 = v_total2 then
        delete from public.partidas_resumen where mesa_id = p_mesa_id;
        get diagnostics v_filas = row_count;
        return v_filas > 0;
    end if;

    insert into public.partidas_resumen (
        mesa_id, mesa_created_at, fecha_final, limite_puntos,
        jugador1_id, jugador2_id, jugador3_id, jugador4_id,
        cuenta_tabla_general, torneo_v2_id,
        puntos_pareja1, puntos_pareja2, rondas, ganador,
        es_lisa, diferencial, clutch_winner_team, updated_at
    ) values (
        p_mesa_id, v_mesa.created_at, v_fecha_final, v_mesa.limite_puntos,
        v_mesa.jugador1_id, v_mesa.jugador2_id, v_mesa.jugador3_id, v_mesa.jugador4_id,
        v_mesa.cuenta_tabla_general, v_mesa.torneo_v2_id,
        v_total1, v_total2, v_rondas,
        case when v_total1 > v_total2 then 1 else 2 end,
        case when v_total1 > v_total2 then v_total2 = 0 else v_total1 = 0 end,
        abs(v_total1 - v_total2),
        case
            when v_total1 > v_total2 and v_clutch1 then 1
            when v_total2 > v_total1 and v_clutch2 then 2
            else 0
        end,
        now()
    )
    on conflict (mesa_id) do update
    set
        mesa_created_at = excluded.mesa_created_at,
        fecha_final = excluded.fecha_final,
        limite_puntos = excluded.limite_puntos,
        jugador1_id = excluded.jugador1_id,
        jugador2_id = excluded.jugador2_id,
        jugador3_id = excluded.jugador3_id,
        jugador4_id = excluded.jugador4_id,
        cuenta_tabla_general = excluded.cuenta_tabla_general,
        torneo_v2_id = excluded.torneo_v2_id,
        puntos_pareja1 = excluded.puntos_pareja1,
        puntos_pareja2 = excluded.puntos_pareja2,
        rondas = excluded.rondas,
        ganador = excluded.ganador,
        es_lisa = excluded.es_lisa,
        diferencial = excluded.diferencial,
        clutch_winner_team = excluded.clutch_winner_team,
        updated_at = now()
    where (
        public.partidas_resumen.mesa_created_at,
        public.partidas_resumen.fecha_final,
        public.partidas_resumen.limite_puntos,
        public.partidas_resumen.jugador1_id,
        public.partidas_resumen.jugador2_id,
        public.partidas_resumen.jugador3_id,
        public.partidas_resumen.jugador4_id,
        public.partidas_resumen.cuenta_tabla_general,
        public.partidas_resumen.torneo_v2_id,
        public.partidas_resumen.puntos_pareja1,
        public.partidas_resumen.puntos_pareja2,
        public.partidas_resumen.rondas,
        public.partidas_resumen.ganador,
        public.partidas_resumen.es_lisa,
        public.partidas_resumen.diferencial,
        public.partidas_resumen.clutch_winner_team
    ) is distinct from (
        excluded.mesa_created_at,
        excluded.fecha_final,
        excluded.limite_puntos,
        excluded.jugador1_id,
        excluded.jugador2_id,
        excluded.jugador3_id,
        excluded.jugador4_id,
        excluded.cuenta_tabla_general,
        excluded.torneo_v2_id,
        excluded.puntos_pareja1,
        excluded.puntos_pareja2,
        excluded.rondas,
        excluded.ganador,
        excluded.es_lisa,
        excluded.diferencial,
        excluded.clutch_winner_team
    );

    get diagnostics v_filas = row_count;
    return v_filas > 0;
end;
$function$;

revoke all on function private.refrescar_partida_resumen(uuid) from public, anon, authenticated;

create or replace function private.trg_partida_resumen_mano()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_id uuid;
begin
    if tg_op = 'UPDATE' and old.mesa_id is distinct from new.mesa_id then
        if exists (select 1 from public.mesas me where me.id = old.mesa_id) then
            perform private.refrescar_partida_resumen(old.mesa_id);
        end if;
        if exists (select 1 from public.mesas me where me.id = new.mesa_id) then
            perform private.refrescar_partida_resumen(new.mesa_id);
        end if;
    else
        v_id := case when tg_op = 'DELETE' then old.mesa_id else new.mesa_id end;
        if exists (select 1 from public.mesas me where me.id = v_id) then
            perform private.refrescar_partida_resumen(v_id);
        end if;
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function private.trg_partida_resumen_mesa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if tg_op = 'DELETE' then
        delete from public.partidas_resumen where mesa_id = old.id;
        return old;
    end if;
    perform private.refrescar_partida_resumen(new.id);
    return new;
end;
$function$;

revoke all on function private.trg_partida_resumen_mano() from public, anon, authenticated;
revoke all on function private.trg_partida_resumen_mesa() from public, anon, authenticated;

drop trigger if exists trigger_partida_resumen_manos on public.manos;
create trigger trigger_partida_resumen_manos
after insert or delete or update of mesa_id,puntos_pareja1,puntos_pareja2,anulada,created_at
on public.manos
for each row execute function private.trg_partida_resumen_mano();

drop trigger if exists trigger_partida_resumen_mesas_insert on public.mesas;
create trigger trigger_partida_resumen_mesas_insert
after insert on public.mesas
for each row execute function private.trg_partida_resumen_mesa();

drop trigger if exists trigger_partida_resumen_mesas_update on public.mesas;
create trigger trigger_partida_resumen_mesas_update
after update of estado,limite_puntos,jugador1_id,jugador2_id,jugador3_id,jugador4_id,cuenta_tabla_general,torneo_v2_id
on public.mesas
for each row execute function private.trg_partida_resumen_mesa();

drop trigger if exists trigger_partida_resumen_mesas_delete on public.mesas;
create trigger trigger_partida_resumen_mesas_delete
after delete on public.mesas
for each row execute function private.trg_partida_resumen_mesa();

do $block$
declare r record;
begin
    for r in select id from public.mesas loop
        perform private.refrescar_partida_resumen(r.id);
    end loop;
end;
$block$;
