// ============================================================================
// VIP COBROS - VALIDACION SEGURA DE ESTADOS EN HOJA FACTURAS
// ============================================================================
// Corrige la validacion de la columna M (Estado) para que coincida con los
// estados que CobrosVIP.gs genera al sincronizar Biofile.
//
// No modifica facturas, saldos, correos ni historial y no envia correos.
// ============================================================================

var ESTADOS_FACTURA_VALIDOS = [
  "Pendiente",
  "Pago parcial",
  "Pagado",
  "Anulada",
  "Incobrable"
];

function validacionEstadosCorrecta_(regla) {
  if (!regla) return false;
  if (regla.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return false;
  if (regla.getAllowInvalid()) return false;

  var criteriaValues = regla.getCriteriaValues() || [];
  var lista = criteriaValues[0] || [];
  if (!Array.isArray(lista)) return false;
  if (lista.length !== ESTADOS_FACTURA_VALIDOS.length) return false;

  for (var i = 0; i < ESTADOS_FACTURA_VALIDOS.length; i++) {
    if (String(lista[i]) !== String(ESTADOS_FACTURA_VALIDOS[i])) return false;
  }
  return true;
}

function asegurarValidacionEstadoFacturas_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_FACTURAS, HEADERS_FACTURAS);

  // Revisamos las filas que actualmente tienen datos. Si una sola regla falta
  // o no coincide, reparamos toda la columna disponible para que las siguientes
  // sincronizaciones tambien queden protegidas.
  var ultimaFilaUsada = Math.max(2, hoja.getLastRow());
  var filasARevisar = Math.max(1, ultimaFilaUsada - 1);
  var reglasActuales = hoja.getRange(2, 13, filasARevisar, 1).getDataValidations();
  var necesitaReparacion = false;

  for (var i = 0; i < reglasActuales.length; i++) {
    if (!validacionEstadosCorrecta_(reglasActuales[i][0])) {
      necesitaReparacion = true;
      break;
    }
  }

  if (!necesitaReparacion) {
    return {
      reparada: false,
      estados: ESTADOS_FACTURA_VALIDOS.slice()
    };
  }

  var regla = SpreadsheetApp.newDataValidation()
    .requireValueInList(ESTADOS_FACTURA_VALIDOS, true)
    .setAllowInvalid(false)
    .setHelpText("Estados permitidos: " + ESTADOS_FACTURA_VALIDOS.join(", "))
    .build();

  var filasDisponibles = Math.max(1, hoja.getMaxRows() - 1);
  hoja.getRange(2, 13, filasDisponibles, 1).setDataValidation(regla);

  return {
    reparada: true,
    filasProtegidas: filasDisponibles,
    estados: ESTADOS_FACTURA_VALIDOS.slice()
  };
}

function repararValidacionEstadoFacturas() {
  var result = asegurarValidacionEstadoFacturas_();
  SpreadsheetApp.getUi().alert(
    result.reparada
      ? "VALIDACION REPARADA.\n\nLa columna Estado ahora permite:\n- Pendiente\n- Pago parcial\n- Pagado\n- Anulada\n- Incobrable\n\nNo se modificaron facturas ni se enviaron correos."
      : "La validacion de la columna Estado ya estaba correcta.\n\nNo se modificaron facturas ni se enviaron correos."
  );
  return result;
}
