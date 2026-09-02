# Consola administrativa VIP Cobros

## Seguridad

La consola está en:

```text
/admin/console
```

El acceso usa `SERVICE_API_KEY`. La clave se escribe en un formulario y el servidor crea una cookie HttpOnly temporal. No se coloca la clave en la URL.

La consola NO ejecuta bash, sh, npm, node, curl ni comandos arbitrarios. Solo acepta:

```text
estado
consultar-cartera --desde=2026-01-01
previsualizar-cobro --desde=2026-01-01
iniciar-cobro --desde=2026-01-01 --modo=real
ver-historial
ver-logs
```

## Consulta de cartera

Para preview y envío real:

- Fecha Desde: la indicada, por defecto 01/01/2026.
- Fecha Hasta: fecha actual en `America/Bogota`.
- Estado: `CON DEUDA`, seleccionado por texto exacto.
- Si Biofile no confirma `CON DEUDA`, el proceso se detiene.
- Nunca cae a `TODAS` como fallback.
- Se usan 1000 registros y se recorren todas las páginas.
- Se descarta cualquier factura con saldo menor o igual a cero.

Las sincronizaciones diaria y semanal existentes conservan su comportamiento porque necesitan consultar cambios de estado, incluyendo pagos y anulaciones.

## Apps Script

La versión administrativa usa dos archivos del repositorio:

```text
apps-script/CobrosVIP.gs
apps-script/CobrosAdmin.gs
```

En Apps Script:

1. Reemplaza el contenido de `Código.gs` por `CobrosVIP.gs`.
2. Crea un archivo nuevo llamado `CobrosAdmin.gs`.
3. Pega el contenido de `apps-script/CobrosAdmin.gs`.
4. Guarda.
5. Conserva `SYNC_TOKEN`.
6. Mantén `MODO_PRUEBA=true` durante preview.
7. Implementar > Administrar implementaciones > Editar > Nueva versión > Implementar.

No se envían correos durante `cobro_plan`/preview.

## Primera carga histórica

Para que la hoja Facturas tenga el histórico y pueda respetar condiciones/plazos:

```powershell
git pull
npm install
npm run sync:backfill -- --desde=2026-01-01
```

La carga histórica sincroniza datos, pero no envía correos.

## Primer PREVIEW

Desde la consola:

```text
previsualizar-cobro --desde=2026-01-01
```

Revisar:

- número de empresas;
- facturas con saldo;
- saldo total;
- días de mora;
- nivel;
- destinatarios;
- acción por factura.

## Primer envío REAL

El primer envío real está bloqueado para el scheduler hasta que exista un envío confirmado manualmente.

1. Revisar preview.
2. En Apps Script usar `Activar PRODUCCIÓN`.
3. En la consola ejecutar:

```text
iniciar-cobro --desde=2026-01-01 --modo=real
```

4. La consola vuelve a mostrar el resumen.
5. Pulsar `CONFIRMAR ENVÍO`.
6. El sistema vuelve a consultar Biofile.
7. Si la cartera cambió, cancela y exige nueva previsualización.
8. Si coincide, envía empresa por empresa.

Después de cada correo exitoso se registra inmediatamente el historial. Un error individual no detiene a las demás empresas. Un error general de cuota/correo sí detiene el proceso.

## Historial y duplicados

`historial recordatorios` continúa siendo la fuente que impide repetir el mismo nivel para una factura.

Los detalles de ejecución se guardan además en:

```text
LOG COBROS ADMIN
```

Los errores no se registran como enviados.

## Scheduler

El scheduler de Render sigue sincronizando Biofile diariamente a las 18:00 hora Colombia y realiza revisión semanal según `WEEKLY_DAY`.

El trigger `vigilarCobros` de Apps Script conserva su nombre y ahora reutiliza el mismo motor de planificación/envío. Antes del primer envío manual confirmado, el envío automático permanece bloqueado.
