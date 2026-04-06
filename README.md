# Insta Cli Inbox

Insta Cli Inbox es una aplicación web pensada como un CRM e inbox unificado para cuentas de Instagram. Permite conectar múltiples cuentas de IG (con o sin proxy), gestionar sesiones móviles persistentes, almacenar las conversaciones localmente y en Supabase, etiquetar chats, definir etapas con mensajes automáticos y follow‑ups, y visualizar métricas agregadas.

Este repositorio contiene un esqueleto funcional escrito en **Node.js puro** con Express. El objetivo es proporcionarte una base estructurada que puedas extender para cubrir todos los requerimientos descritos en el plan inicial. La estética general usa un tema azul y las vistas están implementadas con EJS.

## Características incluidas

* **Inicio de sesión con Supabase**: Autenticación de usuarios mediante correo y contraseña. Los perfiles se almacenan en Supabase en la tabla `profiles` donde se puede definir el rol (`owner` o `user`) y la fecha de expiración.
* **Gestión de cuentas de Instagram**: Permite almacenar credenciales y proxies en una base SQLite local y opcionalmente replicarlas en Supabase. Desde la página de cuentas se pueden iniciar sesiones de IG utilizando la librería `instagram‑private‑api`. Las sesiones persistentes se guardan en SQLite para reutilizarlas en futuras conexiones.
* **Inbox unificado**: Muestra la lista de hilos (conversaciones) agregando los mensajes almacenados en SQLite. Se pueden filtrar por “Todos”, “Calificadas” (chats con etiqueta `qualified`) o “Perdidas” (sin actividad en 2 semanas) y buscar por nombre de usuario. Al abrir un hilo se muestran los mensajes y se puede enviar una nueva respuesta, que se envía a Instagram a través de la API móvil y se guarda localmente y en Supabase.
* **Configuración de etapas y IA**: Se pueden crear etapas con múltiples mensajes y delays, definir follow‑ups, establecer un prompt de IA y las horas en que deben dispararse los follow‑ups. Esta información se almacena en la tabla `stages` de Supabase.
* **Dashboard y métricas básicas**: El panel principal muestra un resumen de mensajes entrantes y salientes de hoy, de la última semana y del último mes, así como la lista de cuentas conectadas. También se incluye una página de métricas con el mismo resumen.
* **Actualizaciones automáticas**: Al arrancar el servidor se ejecuta un verificador de versiones que consulta el repositorio configurado (variable `GITHUB_REPO`) en GitHub para saber si existe una versión más reciente. Solo emite una notificación en consola; no realiza la actualización automática.

## Requisitos

* Node.js ≥ 16.
* Tener un proyecto de Supabase configurado con las siguientes tablas:
  * `profiles(id uuid primary key, role text, expires_at timestamp)`
  * `accounts(...)` (opcional) para replicar datos de cuentas IG.
  * `chats(...)` (opcional) para replicar conversaciones.
  * `stages(...)` para almacenar la configuración de etapas.
* Crear un archivo `.env` basado en `.env.example` con las siguientes variables:
  * `SUPABASE_URL` – URL de tu proyecto Supabase.
  * `SUPABASE_ANON_KEY` – clave anónima para operaciones públicas (Auth).
  * `SUPABASE_SERVICE_KEY` – clave de servicio para operaciones del servidor (opcional).
  * `SESSION_SECRET` – secreto usado para firmar las cookies de sesión.
  * `GITHUB_REPO` – repositorio `owner/repo` donde se publican las actualizaciones del exe.

## Estructura de carpetas

```
insta-cli-inbox/
  index.js                ← Servidor Express
  package.json            ← Dependencias y scripts
  config/
    supabase.js           ← Cliente Supabase
    sqlite.js             ← Inicialización de SQLite y tablas locales
  models/                 ← Lógica de acceso a datos
  routes/                 ← Controladores de rutas Express
  util/
    updateChecker.js      ← Verifica actualizaciones en GitHub
    igMobile.js           ← Envoltorio para la API móvil de Instagram
  views/                  ← Plantillas EJS para la UI
  public/
    styles.css            ← Estilos base en color azul
  db/local.sqlite         ← Base de datos local (generada automáticamente)
```

## Cómo ejecutar

1. Instala las dependencias:

   ```bash
   npm install
   ```
2. Copia `.env.example` a `.env` y completa las variables necesarias.
3. Inicia el servidor:

   ```bash
   npm start
   ```

Por defecto escuchará en el puerto 3000. Puedes cambiarlo definiendo la variable `PORT` en tu `.env`.

## Notas y próximos pasos

* **Persistencia de cookies y sesiones**: Actualmente las sesiones serializadas de Instagram se almacenan en la tabla `sessions` de SQLite, pero no se encriptan. Considera cifrar estos datos en disco y rotar tus contraseñas periódicamente.
* **Automatización con Playwright**: El plan original contempla abrir instancias de Chrome aisladas mediante Playwright para cada cuenta con su proxy y perfil. Esta versión sólo implementa la autenticación y mensajería vía API móvil. Podés integrar Playwright en el futuro para iniciar sesión manualmente o interactuar con la interfaz web de IG.
* **IA y follow‑ups**: La integración con OpenAI no está implementada en esta base. El modelo contempla almacenar prompts y horas de follow‑up, pero será necesario llamar a la API de OpenAI y programar tareas para enviar mensajes automáticos.
* **Métricas avanzadas**: Las métricas actuales son básicas. Para reflejar tasas de respuesta, agendas de reuniones o ventas, se deben definir reglas claras sobre qué eventos contabilizar y cómo clasificarlos.
* **Exportación mensual y purga**: La descarga de CSV y eliminación de conversaciones de más de dos meses se dejó como tarea futura. Se pueden programar tareas con `node-cron` y utilizar la API de Supabase para generar archivos CSV.
* **Estilo y usabilidad**: El frontend utiliza EJS y un CSS sencillo en tonos azules. Sentite libre de sustituirlo por React, Vue u otro framework, y de mejorar la apariencia para acercarla a Instagram.

Con esta base tendrás un punto de partida claro y organizado para desarrollar el CRM conforme a tus necesidades. ¡Éxitos construyendo Insta Cli Inbox!