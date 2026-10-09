create or replace function private.validar_jugadores_mesa_abierta_unicos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_jugadores uuid[];
    v_distintos integer;
    v_total integer;
begin
    if new.estado <> 'abierta' then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('public.mesas.open_players', 0));

    v_jugadores := array[
        new.jugador1_id,
        new.jugador2_id,
        new.jugador3_id,
        new.jugador4_id
    ]::uuid[];

    select count(*), count(distinct x)
      into v_total, v_distintos
      from unnest(v_jugadores) x
     where x is not null;

    if v_total <> v_distintos then
        raise exception using
            errcode = '23514',
            message = 'Una mesa no puede repetir el mismo jugador.';
    end if;

    if exists (
        select 1
          from public.mesas m
         where m.estado = 'abierta'
           and m.id is distinct from new.id
           and array[
                m.jugador1_id,
                m.jugador2_id,
                m.jugador3_id,
                m.jugador4_id
           ]::uuid[] && v_jugadores
    ) then
        raise exception using
            errcode = '23505',
            message = 'Uno de los jugadores ya pertenece a una mesa abierta.';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_validar_jugadores_mesa_abierta_unicos on public.mesas;

create trigger trg_validar_jugadores_mesa_abierta_unicos
before insert or update of estado, jugador1_id, jugador2_id, jugador3_id, jugador4_id
on public.mesas
for each row
execute function private.validar_jugadores_mesa_abierta_unicos();
