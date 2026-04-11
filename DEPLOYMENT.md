# Deploy limpio

La app web productiva vive en `web/`.

## Desde la raiz

Podes manejar la app web desde la raiz con estos comandos:

```bash
npm run dev
npm run build
npm run start
```

## Variables

Para evitar confusiones:

- `SUPABASE_URL` y `SUPABASE_ANON_KEY` siguen sirviendo como base comun.
- La app Next.js tambien acepta `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Si solo definis las variables legacy, `web/next.config.mjs` las expone al cliente web.

## Vercel

La forma prolija de desplegar este repo en Vercel es:

1. Importar el repositorio.
2. Configurar `web` como `Root Directory`.
3. Definir estas variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SERVICE_KEY`
   - `META_APP_ID`
   - `NEXT_PUBLIC_META_APP_ID`
   - `META_APP_SECRET`
   - `META_WEBHOOK_VERIFY_TOKEN`
   - `META_OAUTH_REDIRECT_URI`
   - `META_OAUTH_STATE_SECRET`

## Meta OAuth

El unico flujo OAuth soportado en la app productiva es `Instagram API with Instagram Login`.

Para que el login de Instagram funcione sin el error `redirect_uri is identical`, la configuracion del App Dashboard tiene que coincidir exactamente con el deploy:

1. En Vercel, usar `web/` como `Root Directory`.
2. En `META_OAUTH_REDIRECT_URI`, cargar la URL final exacta del deploy, por ejemplo:

```bash
https://insta-cli-inbox.vercel.app/auth/callback
```

3. En Meta App Dashboard ir a `Instagram > API setup with Instagram login > Business login settings`.
4. En `OAuth redirect URIs`, registrar exactamente la misma URL, sin cambiar dominio, protocolo, path, slash final, query string ni hash.
5. No cargar `/api/meta/oauth/callback`. Esa ruta queda bloqueada a proposito para detectar configuraciones viejas.

Si la URL en Meta y la URL en Vercel no son identicas byte por byte, Meta permite abrir el dialogo pero rechaza el intercambio del `code` por token.

## Meta Webhooks

Ademas del OAuth, la app de Meta tiene que tener Webhooks configurado a nivel aplicacion. Sin eso, la conexion puede abrir el popup y hasta emitir token, pero fallar cuando el backend intenta activar `/{ig_user_id}/subscribed_apps`.

Configuralo asi:

1. En Meta App Dashboard agregar el producto `Webhooks`.
2. Configurar el objeto `Instagram`.
3. En `Callback URL`, cargar la URL publica exacta del deploy:

```bash
https://insta-cli-inbox.vercel.app/api/webhook/instagram
```

4. En `Verify token`, usar exactamente el mismo valor que `META_WEBHOOK_VERIFY_TOKEN`.
5. Verificar y guardar el endpoint.
6. Suscribir la app a los fields del objeto `Instagram` que usa este proyecto:
   - `messages`
   - `message_reactions`
   - `messaging_seen`
   - `messaging_postbacks`
   - `messaging_referral`
   - `messaging_optins`

Si este paso falta, Meta suele rechazar la activacion por cuenta con errores poco claros, incluido `Unsupported request - method type: post` al intentar `POST /{ig_user_id}/subscribed_apps`.

Si queres que Vercel no dependa de `Root Directory = web`, la solucion correcta no es un parche: hay que mover la app Next.js desde `web/` a la raiz del repo y dejar el backend Express como proyecto separado.
