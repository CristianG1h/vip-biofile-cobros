// ============================================================================
// VIP COBROS - VALIDACION SEGURA DE ESTADOS EN HOJA FACTURAS
// Version 1.1
// ============================================================================
// Corrige la validacion de la columna M (Estado) para que coincida con los
// estados que CobrosVIP.gs genera al sincronizar Biofile.
//
// IMPORTANTE:
// - No modifica facturas, saldos, correos ni historial.
// - No envia correos.
// - No recorre toda la capacidad de la hoja: trabaja solo sobre las filas
//   usadas mas un margen de seguridad para evitar timeouts de Apps Script.
// ============================================================================

var ESTADOS_FACTURA_VALIDOS = [
  "Pendiente",
  "Pago parcial",
  "Pagado",
  "Anulada",
  "Incobrable"
];

function construirReglaEstadoFactura_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(ESTADOS_FACTURA_VALIDOS, true)
    .setAllowInvalid(false)
    .setHelpText("Estados permitidos: " + ESTADOS_FACTURA_VALIDOS.join(", "))
    .build();
}

function aplicarValidacionEstadoRango_(hoja, filaInicio, cantidadFilas) {
  filaInicio = Math.max(2, Number(filaInicio || 2));
  cantidadFilas = Math.max(1, Number(cantidadFilas || 1));

  var ultimaNecesaria = filaInicio + cantidadFilas - 1;
  if (ultimaNecesaria > hoja.getMaxRows()) {
    hoja.insertRowsAfter(
      hoja.getMaxRows(),
      ultimaNecesaria - hoja.getMaxRows()
    );
  }

  hoja
    .getRange(filaInicio, 13, cantidadFilas, 1)
    .setDataValidation(construirReglaEstadoFactura_());
}

function asegurarValidacionEstadoFacturas_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_FACTURAS, HEADERS_FACTURAS);

  var ultimaFilaUsada = Math.max(2, hoja.getLastRow());

  // Cubrimos las filas actuales + 500 filas futuras, con un minimo de 1000.
  // Esto evita recorrer decenas de miles de filas vacias y elimina el timeout.
  var ultimaFilaObjetivo = Math.max(1000, ultimaFilaUsada + 500);
  var cantidad = ultimaFilaObjetivo - 1;

  aplicarValidacionEstadoRango_(hoja, 2, cantidad);
  SpreadsheetApp.flush();

  return {
    reparada: true,
    desdeFila: 2,
    hastaFila: ultimaFilaObjetivo,
    filasProtegidas: cantidad,
    estados: ESTADOS_FACTURA_VALIDOS.slice()
  };
}

function repararValidacionEstadoFacturas() {
  var result = asegurarValidacionEstadoFacturas_();

  SpreadsheetApp.getUi().alert(
    "VALIDACION REPARADA.\n\n" +
    "La columna Estado ahora permite:\n" +
    "- Pendiente\n" +
    "- Pago parcial\n" +
    "- Pagado\n" +
    "- Anulada\n" +
    "- Incobrable\n\n" +
    "Filas protegidas: 2 a " + result.hastaFila + ".\n\n" +
    "No se modificaron facturas ni se enviaron correos."
  );

  return result;
}
