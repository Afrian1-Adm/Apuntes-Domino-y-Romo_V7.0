create or replace function private.trg_refrescar_torneo_por_mano_editada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_mesa_id uuid;
    v_torneo_id uuid;
begin
    v_mesa_id := coalesce(new.mesa_id, old.mesa_id);

    select m.torneo_v2_id
      into v_torneo_id
      from public.mesas m
     where m.id = v_mesa_id;

    if v_torneo_id is null then
        return coalesce(new, old);
    end if;

    if tg_op = 'UPDATE' then
        if old.puntos_pareja1 is not distinct from new.puntos_pareja1
           and old.puntos_pareja2 is not distinct from new.puntos_pareja2
           and old.anulada is not distinct from new.anulada then
            return new;
        end if;
    end if;

    update public.torneos_v2
       set updated_at = clock_timestamp()
     where id = v_torneo_id;

    return coalesce(new, old);
end;
$$;

revoke all on function private.trg_refrescar_torneo_por_mano_editada() from public, anon, authenticated;
grant execute on function private.trg_refrescar_torneo_por_mano_editada() to service_role;

drop trigger if exists trg_refrescar_torneo_por_mano_editada on public.manos;
create trigger trg_refrescar_torneo_por_mano_editada
after update of puntos_pareja1, puntos_pareja2, anulada or delete
on public.manos
for each row
execute function private.trg_refrescar_torneo_por_mano_editada();
