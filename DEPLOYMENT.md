# Deploy limpio

La app web productiva vive en `web/`.

## Desde la raiz

Podes manejar la app web desde la raiz con estos comandos:

```bash
npm run web:dev
npm run web:build
npm run web:start
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

Si queres que Vercel no dependa de `Root Directory = web`, la solucion correcta no es un parche: hay que mover la app Next.js desde `web/` a la raiz del repo y dejar el backend Express como proyecto separado.
