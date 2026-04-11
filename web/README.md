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
