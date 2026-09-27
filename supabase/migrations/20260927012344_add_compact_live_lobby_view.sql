create or replace view public.vw_lobby_mesas_activas_resumen
with (security_invoker = true)
as
select
    me.id,
    me.created_at,
    me.creado_en,
    me.estado,
    coalesce(me.limite_puntos, 200)::integer as limite_puntos,
    me.jugador1_id,
    me.jugador2_id,
    me.jugador3_id,
    me.jugador4_id,
    coalesce(me.cuenta_tabla_general, true) as cuenta_tabla_general,
    me.torneo_v2_id,
    coalesce(s.score_p1, 0)::integer as score_p1,
    coalesce(s.score_p2, 0)::integer as score_p2,
    coalesce(s.rondas, 0)::integer as rondas,
    p1.username as j1_username,
    p1.nombre_completo as j1_nombre_completo,
    p2.username as j2_username,
    p2.nombre_completo as j2_nombre_completo,
    p3.username as j3_username,
    p3.nombre_completo as j3_nombre_completo,
    p4.username as j4_username,
    p4.nombre_completo as j4_nombre_completo
from public.mesas me
left join lateral (
    select
        coalesce(sum(m.puntos_pareja1), 0)::integer as score_p1,
        coalesce(sum(m.puntos_pareja2), 0)::integer as score_p2,
        count(*)::integer as rondas
    from public.manos m
    where m.mesa_id = me.id
      and coalesce(m.anulada, false) = false
) s on true
left join public.perfiles p1 on p1.id = me.jugador1_id
left join public.perfiles p2 on p2.id = me.jugador2_id
left join public.perfiles p3 on p3.id = me.jugador3_id
left join public.perfiles p4 on p4.id = me.jugador4_id
where me.estado = 'abierta'
  and coalesce(s.score_p1, 0) < coalesce(me.limite_puntos, 200)
  and coalesce(s.score_p2, 0) < coalesce(me.limite_puntos, 200);

grant select on public.vw_lobby_mesas_activas_resumen to anon, authenticated;
