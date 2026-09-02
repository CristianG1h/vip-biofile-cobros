# Verificación – VIP Biofile Cobros 4.3.0

Fecha de revisión: 2026-09-02.

## Sintaxis

Se validaron como JavaScript/V8 sin errores de sintaxis:

- src/server.js
- src/admin-console.js
- src/jobs/cobro.js
- src/jobs/backfill.js
- src/biofile/estado-cuentas.js
- src/apps-script-client.js
- src/logger.js
- src/index.js
- tests/cobro-admin.test.js
- scripts/check.mjs
- apps-script/CobrosVIP.gs
- apps-script/CobrosAdmin.gs

Resultado: **12/12 OK**.

## Comprobaciones de seguridad y reglas

Resultado: **14/14 OK**.

1. Estado exacto se selecciona antes de Buscar.
2. No existe fallback `selectTodas` para el flujo de cobro.
3. Preview no contiene llamadas a `GmailApp.sendEmail`.
4. El historial se registra después de un envío exitoso.
5. Existe lock de cobro real.
6. El primer envío automático está bloqueado hasta el primer envío manual confirmado.
7. El Web Service no usa `child_process` ni `spawn`.
8. Comandos arbitrarios están bloqueados.
9. El envío real exige segunda confirmación.
10. Se revalida la cartera antes del envío.
11. `vigilarCobros` reutiliza el motor central.
12. Reglas de categoría A conservadas.
13. Reglas de categoría B conservadas.
14. Reglas de categoría C conservadas.

## Protección de secretos

- `.env` permanece ignorado por Git.
- No se encontró la contraseña de Biofile en el repositorio.
- No se encontró el token usado durante configuración en el repositorio.
- Logger enmascara campos y valores de contraseña/token/API key.
- La consola usa SERVICE_API_KEY mediante cookie HttpOnly; no se coloca la clave en la URL.

## Primer envío real

No se ejecutó ningún correo real durante desarrollo.

La primera ejecución real solo puede ocurrir cuando el operador:

1. entra a `/admin/console`;
2. ejecuta preview;
3. activa PRODUCCIÓN en Apps Script;
4. inicia el modo real;
5. confirma una segunda vez el envío.
