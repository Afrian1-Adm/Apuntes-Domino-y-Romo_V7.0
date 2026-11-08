-- Envíos manuales de avisos del Club Dominó y Romo (sin envíos automáticos).
-- Los registros de app_notificaciones y su webhook Web Push existentes realizan la entrega.
CREATE TABLE IF NOT EXISTS public.admin_avisos_envios (
    id uuid PRIMARY KEY,
    creado_por uuid NOT NULL REFERENCES public.perfiles(id),
    tipo text NOT NULL CHECK (tipo IN ('jugada_extraordinaria', 'aviso_general', 'cambio_horario')),
    titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 5 AND 90),
    mensaje text NOT NULL CHECK (char_length(mensaje) BETWEEN 10 AND 500),
    destinatarios integer NOT NULL DEFAULT 0 CHECK (destinatarios >= 0),
    creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_avisos_envios_fecha_idx
  ON public.admin_avisos_envios (creado_en DESC);

ALTER TABLE public.admin_avisos_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_avisos_envios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_avisos_envios TO authenticated;

DROP POLICY IF EXISTS admin_avisos_envios_ver ON public.admin_avisos_envios;
CREATE POLICY admin_avisos_envios_ver ON public.admin_avisos_envios
  FOR SELECT TO authenticated USING (public.es_admin());

CREATE OR REPLACE FUNCTION public.admin_publicar_aviso(
    p_envio_id uuid, p_tipo text, p_titulo text, p_mensaje text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_autor uuid;
    v_nuevo uuid;
    v_tipo text := btrim(coalesce(p_tipo, ''));
    v_titulo text := btrim(coalesce(p_titulo, ''));
    v_mensaje text := btrim(coalesce(p_mensaje, ''));
    v_destinatarios integer;
    v_existente public.admin_avisos_envios%ROWTYPE;
BEGIN
    SELECT id INTO v_autor
    FROM public.perfiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND estado::text = 'aprobado'
      AND rol::text IN ('admin', 'super_admin')
      AND coalesce(es_manual, false) = false
    LIMIT 1;

    IF v_autor IS NULL THEN
        RAISE EXCEPTION 'No tienes permisos para enviar avisos del club.'
        USING ERRCODE = '42501';
    END IF;

    IF p_envio_id IS NULL THEN
        RAISE EXCEPTION 'Falta el identificador de envío.' USING ERRCODE = '22023';
    END IF;
    IF v_tipo NOT IN ('jugada_extraordinaria', 'aviso_general', 'cambio_horario') THEN
        RAISE EXCEPTION 'Selecciona un tipo de aviso válido.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_titulo) NOT BETWEEN 5 AND 90 THEN
        RAISE EXCEPTION 'El título debe tener entre 5 y 90 caracteres.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_mensaje) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION 'El mensaje debe tener entre 10 y 500 caracteres.' USING ERRCODE = '22023';
    END IF;

    -- Serializar las convocatorias del mismo administrador para respetar el límite.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('avisos-club:' || v_autor::text));

    SELECT * INTO v_existente FROM public.admin_avisos_envios WHERE id = p_envio_id;
    IF FOUND THEN
        IF v_existente.creado_por <> v_autor THEN
            RAISE EXCEPTION 'Identificador de aviso en uso.' USING ERRCODE = '22023';
        END IF;
        RETURN jsonb_build_object(
            'envio_id', v_existente.id, 'destinatarios', v_existente.destinatarios,
            'duplicado', true
        );
    END IF;

    IF (SELECT count(*) FROM public.admin_avisos_envios
        WHERE creado_por = v_autor AND creado_en > now() - interval '1 hour') >= 5 THEN
        RAISE EXCEPTION 'Límite de 5 avisos por hora alcanzado. Intenta más tarde.'
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer INTO v_destinatarios
    FROM public.perfiles
    WHERE estado::text = 'aprobado' AND auth_user_id IS NOT NULL
      AND rol::text IN ('jugador', 'admin', 'super_admin');

    IF v_destinatarios = 0 THEN
        RAISE EXCEPTION 'No hay jugadores aprobados para notificar.'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.admin_avisos_envios
        (id, creado_por, tipo, titulo, mensaje, destinatarios)
    VALUES (p_envio_id, v_autor, v_tipo, v_titulo, v_mensaje, v_destinatarios)
    RETURNING id INTO v_nuevo;

    PERFORM public.app_notificar_miembros_aprobados(
        'aviso_manual_' || v_tipo, v_titulo, v_mensaje,
        'lobby.html', 'aviso_manual:' || v_nuevo::text
    );

    RETURN jsonb_build_object(
        'envio_id', v_nuevo, 'destinatarios', v_destinatarios, 'duplicado', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_publicar_aviso(uuid,text,text,text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publicar_aviso(uuid,text,text,text)
    TO authenticated;

-- Avisos visibles en tiempo real para cada destinatario bajo la RLS existente.
DO $$
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = 'app_notificaciones'
  ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.app_notificaciones;
  END IF;
END;
$$;