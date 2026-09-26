-- Resumen de partidas cerradas para el Lobby: una fila por partida, no una por mano.
create or replace view public.vw_lobby_partidas_resumen
with (security_invoker = true)
as
select
    me.id,
    coalesce(max(h.created_at) filter (where h.id is not null), me.created_at) as created_at,
    me.estado,
    me.jugador1_id,
    me.jugador2_id,
    me.jugador3_id,
    me.jugador4_id,
    me.cuenta_tabla_general,
    me.torneo_v2_id,
    coalesce(sum(h.puntos_pareja1) filter (where h.id is not null), 0)::bigint as score_p1,
    coalesce(sum(h.puntos_pareja2) filter (where h.id is not null), 0)::bigint as score_p2,
    count(h.id)::integer as rondas
from public.mesas me
left join public.manos h
  on h.mesa_id = me.id
 and coalesce(h.anulada, false) = false
where me.estado = 'cerrada'
  and coalesce(me.cuenta_tabla_general, true) = true
group by
    me.id,
    me.created_at,
    me.estado,
    me.jugador1_id,
    me.jugador2_id,
    me.jugador3_id,
    me.jugador4_id,
    me.cuenta_tabla_general,
    me.torneo_v2_id;

grant select on public.vw_lobby_partidas_resumen to anon, authenticated;

-- Índices de rutas calientes actuales.
create index if not exists idx_manos_validas_created_at_id
    on public.manos (created_at, id)
    where coalesce(anulada, false) = false;

create index if not exists idx_manos_mesa_creado_en_id
    on public.manos (mesa_id, creado_en, id);

create index if not exists idx_mesas_estado_created_at_id
    on public.mesas (estado, created_at, id);

create index if not exists idx_mesas_abiertas_j1
    on public.mesas (jugador1_id)
    where estado = 'abierta';
create index if not exists idx_mesas_abiertas_j2
    on public.mesas (jugador2_id)
    where estado = 'abierta';
create index if not exists idx_mesas_abiertas_j3
    on public.mesas (jugador3_id)
    where estado = 'abierta';
create index if not exists idx_mesas_abiertas_j4
    on public.mesas (jugador4_id)
    where estado = 'abierta';

-- RLS initplans: misma autorización, auth.uid() evaluado una vez por consulta.
drop policy if exists "app_notificaciones_ver" on public.app_notificaciones;
create policy "app_notificaciones_ver"
on public.app_notificaciones
for select
to authenticated
using (
    destinatario_id is null
    or exists (
        select 1
        from public.perfiles p
        where p.id = app_notificaciones.destinatario_id
          and p.auth_user_id = (select auth.uid())
    )
);

drop policy if exists "Usuarios pueden actualizar su propio perfil" on public.perfiles;
create policy "Usuarios pueden actualizar su propio perfil"
on public.perfiles
for update
to authenticated
using (
    id = (select auth.uid())
    or auth_user_id = (select auth.uid())
)
with check (
    id = (select auth.uid())
    or auth_user_id = (select auth.uid())
);

drop policy if exists "usuarios_actualizan_su_perfil" on public.perfiles;
create policy "usuarios_actualizan_su_perfil"
on public.perfiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "usuarios_ven_su_propio_perfil" on public.perfiles;
create policy "usuarios_ven_su_propio_perfil"
on public.perfiles
for select
to authenticated
using (
    (select auth.uid()) = id
    or (select auth.uid()) = auth_user_id
);

drop policy if exists "push_subscription_borrar_propia" on public.push_subscriptions;
create policy "push_subscription_borrar_propia"
on public.push_subscriptions
for delete
to authenticated
using (
    exists (
        select 1
        from public.perfiles p
        where p.id = push_subscriptions.perfil_id
          and p.auth_user_id = (select auth.uid())
    )
);

drop policy if exists "push_subscription_ver_propia" on public.push_subscriptions;
create policy "push_subscription_ver_propia"
on public.push_subscriptions
for select
to authenticated
using (
    exists (
        select 1
        from public.perfiles p
        where p.id = push_subscriptions.perfil_id
          and p.auth_user_id = (select auth.uid())
    )
);

drop policy if exists "torneo_solicitudes_insert_propio" on public.torneo_solicitudes_pareja;
create policy "torneo_solicitudes_insert_propio"
on public.torneo_solicitudes_pareja
for insert
to authenticated
with check (
    solicitante_id in (
        select p.id
        from public.perfiles p
        where p.auth_user_id = (select auth.uid())
    )
);

drop policy if exists "torneo_solicitudes_select_participantes" on public.torneo_solicitudes_pareja;
create policy "torneo_solicitudes_select_participantes"
on public.torneo_solicitudes_pareja
for select
to authenticated
using (
    solicitante_id in (
        select p.id from public.perfiles p
        where p.auth_user_id = (select auth.uid())
    )
    or destinatario_id in (
        select p.id from public.perfiles p
        where p.auth_user_id = (select auth.uid())
    )
    or public.es_admin_torneos()
);

drop policy if exists "torneo_solicitudes_update_propios" on public.torneo_solicitudes_pareja;
create policy "torneo_solicitudes_update_propios"
on public.torneo_solicitudes_pareja
for update
to authenticated
using (
    destinatario_id in (
        select p.id from public.perfiles p
        where p.auth_user_id = (select auth.uid())
    )
    or solicitante_id in (
        select p.id from public.perfiles p
        where p.auth_user_id = (select auth.uid())
    )
    or public.es_admin_torneos()
)
with check (
    destinatario_id in (
        select p.id from public.perfiles p
        where p.auth_user_id = (select auth.uid())
    )
    or solicitante_id in (
        select p.id from public.perfiles p
        where p.auth_user_id = (select auth.uid())
    )
    or public.es_admin_torneos()
);