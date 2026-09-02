# Verificación del proyecto final 4.0.0

Antes de subir a GitHub ejecuta:

```powershell
npm install
npx playwright install chromium
npm run check
```

Después prueba en este orden:

```powershell
npm run prueba
npm run prueba:biofile
npm run prueba:semana
npm run prueba:proyecto
```

Cuando Apps Script ya esté implementado:

```powershell
npm run importar:clientes -- "private/Lista-de-Clientes.xlsx"
```

## Validaciones esperadas

- `prueba`: no usa Biofile ni Google.
- `prueba:biofile`: solo lectura del día.
- `prueba:semana`: solo lectura últimos 7 días, Estado TODAS, 1000 registros.
- `prueba:proyecto`: simula flujo diario + semanal sin escritura.
- `importar:clientes`: únicamente actualiza `DIRECTORIO CLIENTES` vía Apps Script.
- Apps Script empieza con `MODO_PRUEBA=true`.
- Render solo se activa después de verificar el Web App.

## Regla crítica

Nunca activar producción de correos hasta verificar que:

1. NIT corresponde al cliente correcto.
2. Correos corresponden al cliente correcto.
3. Facturas APROBADAS conservan saldo correcto.
4. PAGO PARCIAL actualiza saldo y abono.
5. PAGO TOTAL queda Pagado.
6. ANULADA queda Anulada.
7. No se generan duplicados por N° Factura.
