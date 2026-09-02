# Render Free Web Service

Este proyecto está preparado para desplegarse como **Web Service gratuito** en Render.

## Qué cambia frente al Cron Job

- Render mantiene un servidor HTTP.
- `GET /health` sirve para el health check y para tu servicio externo de keep-alive.
- El propio proceso revisa la hora de Colombia una vez por minuto.
- A partir de las **18:00 America/Bogota**, ejecuta la sincronización diaria una sola vez por proceso/día.
- Si ese día coincide con `WEEKLY_DAY` (0 = domingo), después ejecuta la revisión semanal.
- Si una ejecución automática falla, puede reintentarse después de `SCHEDULER_RETRY_MINUTES`.
- Si Render reinicia el servicio después de las 18:00, el diario puede volver a ejecutarse; la sincronización está diseñada para ser idempotente por N° de factura.

## Variables privadas que debes crear en Render

```text
BIOFILE_USUARIO
BIOFILE_CONTRASENA
APPS_SCRIPT_URL
APPS_SCRIPT_TOKEN
SERVICE_API_KEY
```

Genera `SERVICE_API_KEY` con una clave larga y distinta del token de Apps Script.

Las demás variables ya están declaradas en `render.yaml`.

## Rutas

Pública:

```text
GET /health
```

Protegidas con `X-API-Key: SERVICE_API_KEY` o `Authorization: Bearer SERVICE_API_KEY`:

```text
GET  /api/status
POST /api/apps-script/ping
POST /api/sync/daily
POST /api/sync/weekly
```

## Prueba manual

Una vez Render muestre una URL como:

```text
https://vip-biofile-cobros.onrender.com
```

Comprueba:

```powershell
Invoke-RestMethod https://vip-biofile-cobros.onrender.com/health
```

Para probar Apps Script desde Render:

```powershell
$headers = @{ "X-API-Key" = "TU_SERVICE_API_KEY" }
Invoke-RestMethod -Method Post -Uri "https://vip-biofile-cobros.onrender.com/api/apps-script/ping" -Headers $headers
```

Para lanzar la sincronización diaria manual:

```powershell
Invoke-RestMethod -Method Post -Uri "https://vip-biofile-cobros.onrender.com/api/sync/daily" -Headers $headers
```

La respuesta será `202 Accepted` y el trabajo continuará dentro del Web Service. Revisa los logs de Render o consulta `/api/status`.


## Consola administrativa

Después del despliegue abre:

```text
https://TU-SERVICIO.onrender.com/admin/console
```

Inicia sesión con el valor de `SERVICE_API_KEY`.

La consola no expone shell ni terminal Linux. Solo permite comandos controlados del sistema de cobros.

Para la primera activación:

1. `consultar-cartera --desde=2026-01-01`
2. `previsualizar-cobro --desde=2026-01-01`
3. Revisar destinatarios, niveles y saldos.
4. Activar PRODUCCIÓN manualmente en Apps Script.
5. `iniciar-cobro --desde=2026-01-01 --modo=real`
6. Revisar el resumen.
7. Pulsar `CONFIRMAR ENVÍO`.

El envío real vuelve a consultar Biofile con `Estado = CON DEUDA`. Si la cartera cambió entre preview y confirmación, cancela el envío y exige una nueva previsualización.
