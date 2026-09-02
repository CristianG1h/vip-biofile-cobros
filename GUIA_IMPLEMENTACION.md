# Guía de implementación — Apps Script + GitHub + Render

## Orden recomendado

No actives producción de una vez. Sigue este orden:

1. Subir proyecto a GitHub.
2. Pegar `apps-script/CobrosVIP.gs` en Apps Script.
3. Ejecutar `prepararSistemaCobrosVIP`.
4. Configurar `SYNC_TOKEN` y `MODO_PRUEBA=true`.
5. Implementar Apps Script como aplicación web.
6. Configurar `.env` local con la URL y token.
7. Importar el Excel de clientes.
8. Ejecutar pruebas locales Biofile.
9. Configurar Render.
10. Hacer un `Trigger Run` manual en Render.
11. Revisar `LOG SINCRONIZACION` y `Facturas`.
12. Probar `vigilarCobros` todavía con `MODO_PRUEBA=true`.
13. Solo cuando todo esté correcto, activar producción.

---

# A. Instalar el nuevo Apps Script

## A1. Guardar copia del código actual

Haz el respaldo **fuera del proyecto Apps Script**: copia el código actual a un archivo `.txt`/`.js` en tu computador o descarga una copia del proyecto.

No dejes el código antiguo dentro de otro archivo `.gs` del mismo proyecto, porque funciones duplicadas como `vigilarCobros`, `onOpen` o `doPost` seguirían cargándose y podrían entrar en conflicto.

## A2. Pegar el código nuevo

En el proyecto Apps Script elimina/reemplaza el código anterior y deja como código activo el contenido de:

```text
apps-script/CobrosVIP.gs
```

Guarda.

## A3. Ejecutar preparación

Arriba, en el selector de funciones, elige:

```text
prepararSistemaCobrosVIP
```

Pulsa **Ejecutar**.

La primera vez Google solicitará permisos. Autoriza con la cuenta propietaria del Sheet.

Esto crea las pestañas que falten y deja `MODO_PRUEBA=true` si todavía no existe esa propiedad.

---

# B. Propiedades del script

En Apps Script abre:

**Configuración del proyecto → Propiedades del script**

Agrega:

```text
SYNC_TOKEN = UNA_CLAVE_LARGA_Y_PRIVADA
MODO_PRUEBA = true
```

Usa una clave aleatoria larga. La misma clave se pondrá después en Render como `APPS_SCRIPT_TOKEN`.

---

# C. Implementar como aplicación web

En Apps Script:

1. Pulsa **Implementar**.
2. **Nueva implementación**.
3. Tipo: **Aplicación web**.
4. Ejecutar como: **Yo / usuario que implementa**.
5. Acceso: **Cualquiera / Anyone**, para que Render pueda hacer el POST sin iniciar sesión de Google.
6. Implementar.
7. Copia la URL terminada en `/exec`.

Esa URL será:

```text
APPS_SCRIPT_URL
```

La aplicación web está protegida además por el `SYNC_TOKEN`; no compartas ni la URL ni el token públicamente.

---

# D. Prueba falsa del Apps Script

Desde el selector de funciones ejecuta:

```text
probarAppsScriptConFacturaFalsa
```

Debe crear la pestaña:

```text
PRUEBA COBROS
```

con una secuencia falsa:

- APROBADA → Pendiente
- PAGO PARCIAL → Pago parcial
- PAGO TOTAL → Pagado
- ANULADA → Anulada

No modifica `Facturas` y no envía correos.

---

# E. Importar el directorio de empresas

Después de implementar la Web App, en el computador:

1. Copia `.env.example` a `.env`.
2. Completa `APPS_SCRIPT_URL` y `APPS_SCRIPT_TOKEN`.
3. Copia el Excel a:

```text
private/Lista-de-Clientes.xlsx
```

4. Ejecuta:

```powershell
npm run importar:clientes -- "private/Lista-de-Clientes.xlsx"
```

Revisa `DIRECTORIO CLIENTES`.

Especialmente verifica:

- NIT y DV;
- empresas con dos o más correos;
- columna `Estado Directorio`;
- cualquier `CONFLICTO NIT`.

Las filas con conflicto no se usan automáticamente para asignar un NIT nuevo hasta que se resuelva la ambigüedad.

---

# F. Condiciones de pago

Desde Google Sheets abre:

**Cobros VIP → Poblar Condiciones de Pago**

El sistema agrega solamente NIT que todavía no estén en `Condiciones de Pago`.

Por defecto coloca:

```text
Plazo normal = 30 días
```

No sobrescribe condiciones existentes. Debes revisar manualmente los clientes con convenios especiales.

---

# G. Correos de facturación

La lista fija de correos del código anterior deja de ser la fuente principal.

Ahora la fuente es:

```text
DIRECTORIO CLIENTES
```

Una empresa puede tener:

```text
correo1@empresa.com,correo2@empresa.com,correo3@empresa.com
```

Todos se conservan y `GmailApp.sendEmail` recibe la lista separada por comas.

Puedes ejecutar manualmente:

```text
completarCorreosFacturacion
```

para refrescar la columna de correos de facturas ya existentes.

---

# H. Trigger de correos

Deja el proyecto en zona horaria:

```text
America/Bogota
```

Luego ejecuta una sola vez:

```text
crearTriggerVigilarCobros
```

Se crea un trigger diario alrededor de las 8:00 a. m.

Los triggers de Apps Script son de ventana horaria, por lo que no debe asumirse ejecución exacta al segundo.

---

# I. Modo prueba antes de producción

Mientras:

```text
MODO_PRUEBA=true
```

`vigilarCobros` calcula quién recibiría recordatorio y lo deja en el registro de ejecución, pero **no envía correos reales** y tampoco contamina el historial de envíos.

Cuando hayas verificado todo:

Google Sheets → **Cobros VIP → Activar PRODUCCIÓN**.

El sistema pide confirmación antes de cambiar a producción.

---

# J. Render

## J1. Crear el servicio

La opción más sencilla es usar **New → Blueprint** y seleccionar el repositorio privado `vip-biofile-cobros`.

Render detecta `render.yaml` y crea un **Cron Job Docker**.

## J2. Variables privadas

Configura:

```text
BIOFILE_USUARIO = tu usuario real
BIOFILE_CONTRASENA = tu contraseña real
APPS_SCRIPT_URL = URL /exec de Apps Script
APPS_SCRIPT_TOKEN = mismo valor de SYNC_TOKEN
```

Nunca las guardes en GitHub.

## J3. Horario

El Blueprint contiene:

```text
0 23 * * *
```

Render usa UTC. Colombia es UTC-5, por lo que corresponde a las **6:00 p. m.**.

## J4. Prueba manual de Render

Antes de esperar a las 6:00 p. m. usa:

```text
Trigger Run
```

El log debe mostrar:

1. login/session Biofile;
2. búsqueda del día;
3. facturas leídas;
4. respuesta correcta de Apps Script;
5. proceso finalizado correctamente.

Después revisa:

- `Facturas`;
- `LOG SINCRONIZACION`;
- que no haya facturas duplicadas.

---

# K. Qué pasa cada domingo

El mismo Cron Job corre primero el cierre diario.

Como `WEEKLY_DAY=0`, después ejecuta la revisión semanal:

1. pregunta a Apps Script la factura abierta más antigua;
2. consulta Biofile por meses desde esa fecha;
3. usa 1000 registros;
4. vuelve a leer abiertas y últimos 7 días;
5. actualiza pagos parciales, pagos totales y anulaciones;
6. recupera facturas recientes si faltó un cierre diario.

No se necesita un segundo servicio Render.
