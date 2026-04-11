# Insta CLI Inbox

La app productiva de este repo vive en `web/`.

## Estado actual

- Frontend y backend productivo actuales: Next.js 14 en `web/`
- Flujo OAuth soportado: `Instagram API with Instagram Login`
- Callback publica canonica: `https://insta-cli-inbox.vercel.app/auth/callback`
- Ruta legacy bloqueada para detectar mala configuracion: `/api/meta/oauth/callback`

## Importante

El codigo legacy de Express, EJS e `instagram-private-api` que sigue en la raiz no forma parte del flujo Meta OAuth actual.

Si vas a desplegar o configurar login con Meta:

1. Usa `web/` como `Root Directory` en Vercel.
2. Configura `META_OAUTH_REDIRECT_URI` con la URL final exacta del deploy.
3. Carga exactamente esa misma URL en `OAuth redirect URIs` dentro de Meta.

## Comandos desde la raiz

```bash
npm run dev
npm run build
npm run start
```

Mas detalle operativo en [DEPLOYMENT.md](./DEPLOYMENT.md) y [web/README.md](./web/README.md).
