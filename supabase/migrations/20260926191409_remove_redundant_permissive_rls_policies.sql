-- manos: la política pública de SELECT ya cubre anon y authenticated.
drop policy if exists "Lectura de manos" on public.manos;
drop policy if exists "Permitir lectura de manos a autenticados" on public.manos;

-- mesas: duplicado exacto de admins_eliminan_mesas.
drop policy if exists "Admins pueden eliminar mesas" on public.mesas;

-- mesas: creador_actualiza_su_mesa ya contiene OR es_admin().
drop policy if exists "Admins pueden actualizar mesas" on public.mesas;

-- perfiles: es_admin() ya incluye super_admin y admins_gestionan_perfiles es FOR ALL.
drop policy if exists "super_admin_actualiza_perfiles" on public.perfiles;

-- perfiles: esta condición (auth.uid() = id) está contenida en
-- "Usuarios pueden actualizar su propio perfil" (id OR auth_user_id).
drop policy if exists "usuarios_actualizan_su_perfil" on public.perfiles;