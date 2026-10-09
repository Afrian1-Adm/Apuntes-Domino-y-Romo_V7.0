import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type NotificationRecord = {
  id: string
  destinatario_id: string | null
  tipo: string
  titulo: string
  mensaje: string
  url: string
  referencia: string
}

type WebhookPayload = {
  type: 'INSERT'
  table: string
  schema: string
  record: NotificationRecord
  old_record: null
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || supabaseUrl
  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''

  if (!supabaseUrl || !serviceKey) return json({ error: 'Falta la configuración de Supabase.' }, 500)

  if (request.method === 'GET') {
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: { user } } = await authClient.auth.getUser(token)
    if (!user) return json({ error: 'Sesión no válida.' }, 401)
    if (!vapidPublicKey) return json({ error: 'Falta VAPID_PUBLIC_KEY.' }, 503)
    return json({ publicKey: vapidPublicKey })
  }

  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  if (!vapidPublicKey || !vapidPrivateKey) return json({ error: 'Faltan las claves VAPID.' }, 503)
  if (!webhookSecret || request.headers.get('x-push-secret') !== webhookSecret) {
    return json({ error: 'Webhook no autorizado.' }, 401)
  }

  let payload: WebhookPayload
  try {
    payload = await request.json()
  } catch (_) {
    return json({ error: 'El cuerpo no contiene JSON válido.' }, 400)
  }

  if (payload.table !== 'app_notificaciones' || payload.type !== 'INSERT' || !payload.record?.id) {
    return json({ error: 'Evento no reconocido.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const notification = payload.record

  let subscriptionsQuery = admin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .eq('enabled', true)

  if (notification.destinatario_id) {
    subscriptionsQuery = subscriptionsQuery.eq('perfil_id', notification.destinatario_id)
  }

  const { data: subscriptions, error: subscriptionsError } = await subscriptionsQuery
  if (subscriptionsError) return json({ error: subscriptionsError.message }, 500)

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const pushPayload = JSON.stringify({
    title: notification.titulo,
    body: notification.mensaje,
    url: notification.url || 'lobby.html',
    tag: `${notification.tipo}:${notification.referencia}`.slice(0, 120),
    tipo: notification.tipo,
  })

  let sent = 0
  let expired = 0
  const failures: string[] = []

  await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, pushPayload, {
        TTL: 86400,
        urgency: notification.tipo === 'mesa_iniciada' || notification.tipo === 'tombola_seleccion'
          ? 'high'
          : 'normal',
      })
      sent += 1
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0)
      if (statusCode === 404 || statusCode === 410) {
        expired += 1
        await admin.from('push_subscriptions').delete().eq('id', subscription.id)
      } else {
        failures.push(String((error as Error)?.message || error))
      }
    }
  }))

  if (sent > 0) {
    await admin
      .from('app_notificaciones')
      .update({ enviado_at: new Date().toISOString() })
      .eq('id', notification.id)
  }

  return json({
    ok: sent > 0 && failures.length === 0,
    sent,
    expired,
    failures,
    noSubscriptions: (subscriptions || []).length === 0,
  })
})
