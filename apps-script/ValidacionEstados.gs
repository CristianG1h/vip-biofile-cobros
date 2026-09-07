// ============================================================================
// VIP COBROS - VALIDACION SEGURA DE ESTADOS EN HOJA FACTURAS
// Version 1.2 - SIN ALERT BLOQUEANTE
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
  var ultimaFilaObjetivo = Math.max(1000, ultimaFilaUsada + 500);
  var cantidad = ultimaFilaObjetivo - 1;

  aplicarValidacionEstadoRango_(hoja, 2, cantidad);
  SpreadsheetApp.flush();

  return {
    ok: true,
    reparada: true,
    desdeFila: 2,
    hastaFila: ultimaFilaObjetivo,
    filasProtegidas: cantidad,
    estados: ESTADOS_FACTURA_VALIDOS.slice()
  };
}

function repararValidacionEstadoFacturas() {
  var result = asegurarValidacionEstadoFacturas_();

  // No usar SpreadsheetApp.getUi().alert() aquí: ejecutada desde el editor,
  // esa llamada es bloqueante y puede agotar los 6 minutos de Apps Script.
  Logger.log("VALIDACION REPARADA: " + JSON.stringify(result));
  console.log("VALIDACION REPARADA: " + JSON.stringify(result));

  return result;
}
