create or replace view public.vw_lobby_partidas_resumen
with (security_invoker = true)
as
select
    mesa_id as id,
    fecha_final as created_at,
    'cerrada'::text as estado,
    jugador1_id,
    jugador2_id,
    jugador3_id,
    jugador4_id,
    cuenta_tabla_general,
    torneo_v2_id,
    puntos_pareja1::bigint as score_p1,
    puntos_pareja2::bigint as score_p2,
    rondas
from public.partidas_resumen
where cuenta_tabla_general = true;

grant select on public.vw_lobby_partidas_resumen to anon, authenticated;
