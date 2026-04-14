# Insta CLI Inbox Web

La app productiva de este repo vive en `web/` y corre con Next.js 14.

## OAuth soportado

El unico flujo OAuth soportado en esta app es `Instagram API with Instagram Login`.

- Callback publica canonica: `https://insta-cli-inbox.vercel.app/auth/callback`
- Ruta legacy bloqueada: `/api/meta/oauth/callback`
- Pantalla final interna del popup: `/meta/oauth/complete`

No se usa Instagram Basic Display.
No se usa Facebook Login como callback principal.
No se usa el backend Express legacy para este flujo.

## Desarrollo

```bash
npm run dev
```

## Produccion en Vercel

1. Configurar `web/` como `Root Directory`.
2. Definir `META_OAUTH_REDIRECT_URI` con la URL final exacta del deploy.
3. Cargar exactamente ese mismo valor en `OAuth redirect URIs` dentro de Meta.
4. En Meta App Dashboard agregar `Webhooks`, configurar el objeto `Instagram`, verificar `https://tu-dominio/api/webhook/instagram` con el mismo `META_WEBHOOK_VERIFY_TOKEN` del entorno y suscribir la app a los fields de Instagram que usa el proyecto.
5. Definir `CRON_SECRET` y dejar `web/vercel.json` activo para que `/api/automation/dispatch` procese etapas y followups.

La configuracion de webhooks de Instagram se hace desde Meta App Dashboard. Durante el callback OAuth la app solo persiste la cuenta conectada y la deja en `oauth_connected`. La cuenta pasa a `messaging_ready` recien cuando recibimos el primer webhook real o confirmamos una operacion real de mensajeria.

## Automatizaciones

- Los agentes y flujos se guardan en Supabase.
- Solo puede haber un agente activo por usuario.
- La API key de IA se guarda localmente en el navegador de cada usuario.
- El envio de etapas y followups corre por jobs via `/api/automation/dispatch`.
