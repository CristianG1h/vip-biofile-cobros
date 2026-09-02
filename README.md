# VIP Biofile Cobros — versión final 4.0.0

Robot de sincronización de **Biofile → Sistema de Cobros VIP**.

El proyecto está dividido en tres piezas:

1. **GitHub:** código fuente y documentación.
2. **Render Cron Job:** entra a Biofile automáticamente a las 6:00 p. m. Colombia.
3. **Google Apps Script:** recibe las facturas, las inserta/actualiza en `CARTERA VIP COBROS` y ejecuta la lógica de cobro.

El Excel exportado de clientes de Biofile **NO se sube a GitHub**. Se utiliza una sola vez (y cada vez que quieras refrescarlo) para alimentar la pestaña `DIRECTORIO CLIENTES`.

---

## 1. Qué hace el robot diariamente

A las **6:00 p. m. Colombia**:

1. Abre `https://vipso.biofile.com.co/Factura/EstadoCuentas.aspx`.
2. Inicia sesión si hace falta.
3. Usa la fecha del día en `Fecha Desde` y `Fecha Hasta`.
4. Cambia **Estado = TODAS**.
5. **No modifica Resolución**.
6. No toca el selector de 50 registros en el proceso diario.
7. Pulsa **Buscar**.
8. Lee directamente la tabla de Biofile.
9. Envía a Apps Script: fecha, factura, cliente, estado, total, abono y saldo.
10. Apps Script cruza el cliente con `DIRECTORIO CLIENTES` para obtener NIT y todos sus correos.
11. Apps Script hace UPSERT por `N Factura`:
    - si no existe: **INSERTA**;
    - si ya existe: **ACTUALIZA**;
    - si no cambió: **NO DUPLICA**.

---

## 2. Qué hace una vez por semana

Por defecto el **domingo a las 6:00 p. m.**, después del proceso diario:

1. Apps Script indica al robot cuál es la factura abierta más antigua y cuáles siguen abiertas.
2. El robot consulta Biofile desde esa fecha hasta hoy.
3. Divide la consulta por meses para no cargar una búsqueda enorme.
4. Usa **Estado = TODAS**.
5. Usa **1000 registros por página**.
6. Revisa si una factura cambió:
   - `APROBADA` / `SIN PAGAR` → `Pendiente`.
   - `PAGO PARCIAL` → `Pago parcial` y actualiza abono/saldo.
   - `PAGO TOTAL` / `PAGADA` → `Pagado`.
   - `ANULADA` → `Anulada`.
7. También revisa los últimos 7 días para recuperar una factura si el cierre diario falló.
8. `Pagado` y `Anulada` dejan de recibir cobros.

---

## 3. Instalación local — solo la primera vez

Requisito: **Node.js 20.10 o superior**.

Dentro de la carpeta del proyecto:

```powershell
npm install
```

Después instala Chromium para las pruebas locales:

```powershell
npx playwright install chromium
```

`npm install` se hace una vez por computador/carpeta nueva. Si borras `node_modules` o vuelves a clonar el repositorio, debes ejecutarlo otra vez.

### Configuración local

Copia:

```text
.env.example
```

a:

```text
.env
```

Completa únicamente en `.env`:

```text
BIOFILE_USUARIO=...
BIOFILE_CONTRASENA=...
APPS_SCRIPT_URL=...
APPS_SCRIPT_TOKEN=...
HEADLESS=false
```

`.env` está excluido por `.gitignore` y **no debe subirse a GitHub**.

---

## 4. Pruebas disponibles

### Prueba falsa — sin Biofile

```powershell
npm run prueba
```

No entra a Biofile, no toca Google y no envía correos.

### Prueba Biofile de hoy

```powershell
npm run prueba:biofile
```

Solo lectura. Debe mostrar las facturas del día.

### Prueba semanal real

```powershell
npm run prueba:semana
```

Solo lectura. Consulta los últimos 7 días con 1000 registros.

### Prueba integral del proyecto

```powershell
npm run prueba:proyecto
```

Simula cierres diarios y una comparación semanal sin escribir en Google Sheets.

### Comprobación de código

```powershell
npm run check
```

Valida sintaxis Node, sintaxis del Apps Script y pruebas automáticas.

---

## 5. Importar el Excel de empresas de Biofile

Coloca el Excel exportado de Biofile dentro de:

```text
private/Lista-de-Clientes.xlsx
```

Asegúrate de que `.env` ya tenga:

```text
APPS_SCRIPT_URL=...
APPS_SCRIPT_TOKEN=...
```

Ejecuta:

```powershell
npm run importar:clientes -- "private/Lista-de-Clientes.xlsx"
```

El importador reconoce las columnas del Excel de Biofile:

- Nombre del Acuerdo Comercial, Contrato o Convenio
- Tipo
- N° de Identificación del Cliente
- Dv
- Correo Electrónico

Hace lo siguiente:

- limpia NIT con espacios/puntos/guiones;
- conserva DV;
- detecta uno, dos, tres o más correos en una misma celda;
- elimina correos duplicados;
- crea/actualiza `DIRECTORIO CLIENTES`;
- marca conflictos cuando el mismo nombre aparece con NIT distintos.

El Excel queda en `private/` y **no se sube a GitHub**.

---

## 6. Subir a GitHub

Crea un repositorio **privado** llamado:

```text
vip-biofile-cobros
```

No agregues README ni `.gitignore` desde GitHub porque ya vienen en este proyecto.

Luego, en PowerShell dentro de esta carpeta:

```powershell
git init
git add .
git commit -m "Proyecto final Biofile Cobros"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/vip-biofile-cobros.git
git push -u origin main
```

Después de `npm install`, se generará `package-lock.json`. Es recomendable incluirlo en el commit siguiente:

```powershell
git add package-lock.json
git commit -m "Agregar lock de dependencias"
git push
```

Nunca subas:

- `.env`
- usuario o contraseña de Biofile
- token de Apps Script
- el Excel de clientes
- `node_modules`

---

## 7. Render

El repositorio incluye `render.yaml` y `Dockerfile`.

La programación es:

```text
0 23 * * *
```

Render interpreta el cron en UTC; `23:00 UTC` corresponde a **6:00 p. m. Colombia**.

Variables privadas que debes crear en Render:

```text
BIOFILE_USUARIO
BIOFILE_CONTRASENA
APPS_SCRIPT_URL
APPS_SCRIPT_TOKEN
```

Variables ya definidas en el Blueprint:

```text
HEADLESS=true
TIMEZONE=America/Bogota
WEEKLY_DAY=0
WEEKLY_RECOVERY_DAYS=7
```

`WEEKLY_DAY=0` significa domingo.

En Render no debes ejecutar manualmente `npm install`: Docker lo hace durante la construcción de la imagen.

---

## 8. Apps Script

El código completo está en:

```text
apps-script/CobrosVIP.gs
```

La guía exacta para instalarlo está en:

```text
GUIA_IMPLEMENTACION.md
```

El Apps Script crea/usa:

- `Facturas`
- `IMPORTAR`
- `Condiciones de Pago`
- `DIRECTORIO CLIENTES`
- `historial recordatorios`
- `LOG SINCRONIZACION`
- `PRUEBA COBROS` (solo pruebas falsas)

---

## 9. Seguridad del cobro

Nunca se envía recordatorio cuando:

- saldo pendiente <= 0;
- `Pausar = SI`;
- no existe correo;
- estado = `Pagado`;
- estado = `Anulada`;
- estado = `Incobrable`;
- la factura todavía no cumple la regla de días de su categoría.

Además, el mismo nivel no se envía dos veces el mismo día.

El sistema inicia en **MODO PRUEBA**. El modo producción se activa manualmente desde el menú `Cobros VIP` de Google Sheets.


---

## Consola administrativa 4.3

La operación manual segura se realiza en `/admin/console` y está protegida por `SERVICE_API_KEY`.

El flujo de cobro manual consulta Biofile con:

- Fecha Desde configurable (por defecto `2026-01-01`).
- Fecha Hasta calculada en `America/Bogota`.
- Estado seleccionado exactamente como `CON DEUDA`.
- 1000 registros y recorrido de todas las páginas.
- Validación adicional `Vr. Saldo > 0`.

Comandos permitidos:

```text
estado
consultar-cartera --desde=2026-01-01
previsualizar-cobro --desde=2026-01-01
iniciar-cobro --desde=2026-01-01 --modo=real
ver-historial
ver-logs
```

No existe shell ni ejecución arbitraria de comandos.

Consulta `ADMIN_CONSOLE.md` para el procedimiento completo de preview y primer envío real.
