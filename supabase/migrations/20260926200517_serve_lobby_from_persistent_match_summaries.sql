grant select on public.partidas_resumen to anon;

drop policy if exists partidas_resumen_lectura_autenticados on public.partidas_resumen;
drop policy if exists partidas_resumen_lectura_publica on public.partidas_resumen;
create policy partidas_resumen_lectura_publica
on public.partidas_resumen
for select
to anon, authenticated
using (true);

create or replace view public.vw_lobby_partidas_resumen
with (security_invoker = true)
as
select
    p.mesa_id as id,
    p.fecha_final as created_at,
    'cerrada'::text as estado,
    p.jugador1_id,
    p.jugador2_id,
    p.jugador3_id,
    p.jugador4_id,
    p.cuenta_tabla_general,
    p.torneo_v2_id,
    p.puntos_pareja1::bigint as score_p1,
    p.puntos_pareja2::bigint as score_p2,
    p.rondas
from public.partidas_resumen p
where p.cuenta_tabla_general = true;

grant select on public.vw_lobby_partidas_resumen to anon, authenticated;
