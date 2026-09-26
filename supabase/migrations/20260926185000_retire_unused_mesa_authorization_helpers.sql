-- Seguridad · Fase 10
-- Helpers residuales sin uso en RLS ni en el cliente actual.

REVOKE EXECUTE ON FUNCTION public.es_creador_mesa(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.es_participante_mesa(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.es_creador_mesa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.es_participante_mesa(uuid) TO service_role;
