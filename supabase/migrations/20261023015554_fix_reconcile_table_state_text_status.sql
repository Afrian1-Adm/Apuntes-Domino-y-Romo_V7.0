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
    v_estado_objetivo text;
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

    v_estado_objetivo := case
        when v_p1 >= v_limite or v_p2 >= v_limite then 'cerrada'
        else 'abierta'
    end;

    update public.mesas
       set estado = v_estado_objetivo
     where id = v_mesa_id
       and estado is distinct from v_estado_objetivo;

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_cerrar_mesa_si_termino on public.manos;
drop trigger if exists trg_reconciliar_estado_mesa_por_manos on public.manos;

create trigger trg_reconciliar_estado_mesa_por_manos
after insert or delete or update of puntos_pareja1, puntos_pareja2, anulada, mesa_id
on public.manos
for each row
execute function private.reconciliar_estado_mesa_por_manos();

revoke all on function private.reconciliar_estado_mesa_por_manos() from public, anon, authenticated;
grant execute on function private.reconciliar_estado_mesa_por_manos() to service_role;
