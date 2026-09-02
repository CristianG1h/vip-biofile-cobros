// ============================================================================
// VIP SALUD OCUPACIONAL - SISTEMA DE COBROS + SINCRONIZACION BIOFILE
// Version 4.4.0
// ============================================================================
// Este archivo reemplaza la lista fija de correos por DIRECTORIO CLIENTES,
// recibe la sincronizacion diaria/semanal desde Render y hace UPSERT por factura.
//
// IMPORTANTE:
// 1) Dejar la Propiedad del script MODO_PRUEBA=true mientras se valida.
// 2) Crear la Propiedad del script SYNC_TOKEN con una clave larga y privada.
// 3) No escribir usuario/contraseña de Biofile dentro de Apps Script.
// ============================================================================

var SHEET_ID_CARTERA = "1vH1HJ1-__VSgXKrJY2Mn1dt-LVyzQTd6v_Ys9Nff4Rc";

var HOJA_FACTURAS = "Facturas";
var HOJA_IMPORTAR = "IMPORTAR";
var HOJA_CONDICIONES = "Condiciones de Pago";
var HOJA_DIRECTORIO = "DIRECTORIO CLIENTES";
var HOJA_HISTORIAL = "historial recordatorios";
var HOJA_LOG_SYNC = "LOG SINCRONIZACION";
var HOJA_PRUEBA = "PRUEBA COBROS";

var CORREO_VIP = "contabilidadvipso@gmail.com";
var CORREO_CONTABILIDAD = "contabilidadvipso@gmail.com";

var DATOS_BANCARIOS =
  "A nombre de: VIP SALUD OCUPACIONAL SAS - NIT 901434471-7\n" +
  "Bancolombia - Cuenta de Ahorros: 21700001442\n" +
  "Davivienda - Cuenta de Ahorros: 001600128670";

var HEADERS_FACTURAS = [
  "Fecha Factura", "N Factura", "NIT", "Cliente", "Valor Total",
  "Valor Abonado", "Saldo Pendiente", "Categoría", "Plazo",
  "Fecha de Vencimiento", "Correo de Facturación", "Pausar", "Estado"
];

var HEADERS_IMPORTAR = [
  "Fecha Factura", "N Factura", "NIT", "Cliente", "Valor Total",
  "Valor Abonado", "Saldo Pendiente", "Estado Biofile", "Correos Facturación"
];

var HEADERS_DIRECTORIO = [
  "Cliente", "Tipo", "NIT", "DV", "Correos Facturación", "Clave Cliente", "Estado Directorio"
];

var HEADERS_CONDICIONES = [
  "NIT", "Cliente", "Plazo Normal (días)", "Plazo Primera Factura (días)"
];

var HEADERS_HISTORIAL = [
  "Fecha envío", "N Factura", "Cliente", "Categoría", "Nivel", "Destinatarios"
];

var HEADERS_LOG = [
  "Fecha", "Tipo", "Recibidas", "Nuevas", "Actualizadas", "Sin cambio",
  "Sin directorio", "Conflictos directorio", "Detalle"
];

// ============================================================================
// MENÚ Y PREPARACIÓN
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Cobros VIP")
    .addItem("1. Preparar estructura", "prepararSistemaCobrosVIP")
    .addSeparator()
    .addItem("Actualizar Cartera desde IMPORTAR", "actualizarCarteraDesdeImportarManual")
    .addItem("Completar correos desde Directorio", "completarCorreosFacturacion")
    .addItem("Poblar Condiciones de Pago", "poblarCondicionesDePago")
    .addSeparator()
    .addItem("Prueba falsa segura", "probarAppsScriptConFacturaFalsa")
    .addItem("Ver modo actual", "mostrarModoActual")
    .addItem("Activar MODO PRUEBA", "activarModoPrueba")
    .addItem("Activar PRODUCCIÓN", "activarProduccion")
    .addSeparator()
    .addItem("Crear trigger diario de cobros", "crearTriggerVigilarCobros")
    .addToUi();
}

function prepararSistemaCobrosVIP() {
  asegurarEstructura_();

  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("MODO_PRUEBA") === null) {
    props.setProperty("MODO_PRUEBA", "true");
  }

  SpreadsheetApp.getUi().alert(
    "Estructura preparada.\n\n" +
    "El sistema queda en MODO PRUEBA hasta que lo cambies manualmente a producción.\n" +
    "Recuerda configurar también la propiedad SYNC_TOKEN."
  );
}

function asegurarEstructura_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  asegurarHoja_(ss, HOJA_FACTURAS, HEADERS_FACTURAS);
  asegurarHoja_(ss, HOJA_IMPORTAR, HEADERS_IMPORTAR);
  asegurarHoja_(ss, HOJA_CONDICIONES, HEADERS_CONDICIONES);
  asegurarHoja_(ss, HOJA_DIRECTORIO, HEADERS_DIRECTORIO);
  asegurarHoja_(ss, HOJA_HISTORIAL, HEADERS_HISTORIAL);
  asegurarHoja_(ss, HOJA_LOG_SYNC, HEADERS_LOG);
}

function asegurarHoja_(ss, nombre, headers) {
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) hoja = ss.insertSheet(nombre);

  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var actual = hoja.getRange(1, 1, 1, headers.length).getValues()[0];
    var vacio = actual.join("").trim() === "";
    if (vacio) hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  hoja.setFrozenRows(1);
  return hoja;
}

// ============================================================================
// WEB APP: RENDER -> APPS SCRIPT
// ============================================================================

function doGet() {
  return jsonResponse_({
    ok: true,
    servicio: "VIP Biofile Cobros",
    modoPrueba: getModoPrueba_(),
    fecha: new Date().toISOString()
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) {
      return jsonResponse_({ ok: false, error: "Hay otra sincronización en curso." });
    }

    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    validarToken_(body.token);
    asegurarEstructura_();

    if (body.action === "ping") {
      return jsonResponse_({ ok: true, data: { pong: true, modoPrueba: getModoPrueba_() } });
    }

    if (body.action === "import_directory") {
      var directorioResult = importarDirectorioPayload_(body.rows || [], body.meta || {});
      return jsonResponse_({ ok: true, data: directorioResult });
    }

    if (body.action === "weekly_context") {
      return jsonResponse_({ ok: true, data: obtenerContextoSemanal_() });
    }

    if (body.action === "sync_daily") {
      var dailyResult = sincronizarFacturas_(body.invoices || [], "DIARIO", body.meta || {});
      return jsonResponse_({ ok: true, data: dailyResult });
    }

    if (body.action === "sync_weekly") {
      var weeklyResult = sincronizarFacturas_(body.invoices || [], "SEMANAL", body.meta || {});
      return jsonResponse_({ ok: true, data: weeklyResult });
    }

    if (body.action === "sync_backfill") {
      var backfillResult = sincronizarFacturas_(body.invoices || [], "HISTORICO", body.meta || {});
      return jsonResponse_({ ok: true, data: backfillResult });
    }

    if (body.action === "cobro_plan") {
      var planResult = planificarCobrosDesdeBiofile_(body.invoices || [], body.meta || {});
      return jsonResponse_({ ok: true, data: planResult });
    }

    if (body.action === "cobro_send") {
      var sendResult = enviarCobrosDesdeBiofile_(body.invoices || [], body.meta || {});
      return jsonResponse_({ ok: true, data: sendResult });
    }

    if (body.action === "cobro_history") {
      var historyResult = obtenerHistorialAdmin_(body.limit || 100);
      return jsonResponse_({ ok: true, data: historyResult });
    }

    return jsonResponse_({ ok: false, error: "Acción no permitida: " + String(body.action || "") });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function validarToken_(token) {
  var esperado = PropertiesService.getScriptProperties().getProperty("SYNC_TOKEN");
  if (!esperado) throw new Error("Falta configurar SYNC_TOKEN en Propiedades del script.");
  if (!token || String(token) !== String(esperado)) throw new Error("Token inválido.");
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// DIRECTORIO DE CLIENTES (EXCEL BIOFILE)
// ============================================================================

function importarDirectorioPayload_(rows, meta) {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_DIRECTORIO, HEADERS_DIRECTORIO);

  var agrupados = {};
  var nitsPorClave = {};

  for (var i = 0; i < rows.length; i++) {
    var raw = rows[i] || {};
    var cliente = limpiarEspacios_(raw.cliente);
    var tipo = limpiarEspacios_(raw.tipo);
    var nit = normalizarNit_(raw.nit);
    var dv = String(raw.dv === undefined || raw.dv === null ? "" : raw.dv).replace(/\D/g, "");
    var correos = extraerCorreos_(raw.correos);
    var clave = normalizarCliente_(cliente);

    if (!cliente || !nit || !clave) continue;

    var groupKey = clave + "|" + nit;
    if (!agrupados[groupKey]) {
      agrupados[groupKey] = {
        cliente: cliente,
        tipo: tipo || "NIT",
        nit: nit,
        dv: dv,
        correos: {},
        clave: clave
      };
    }

    for (var e = 0; e < correos.length; e++) {
      agrupados[groupKey].correos[correos[e]] = true;
    }

    if (!nitsPorClave[clave]) nitsPorClave[clave] = {};
    nitsPorClave[clave][nit] = true;
  }

  var keys = Object.keys(agrupados).sort();
  var output = [];
  var conflictos = 0;
  var multiplesCorreos = 0;
  var sinCorreo = 0;

  for (var k = 0; k < keys.length; k++) {
    var item = agrupados[keys[k]];
    var emails = Object.keys(item.correos).sort();
    var nitsMismoNombre = Object.keys(nitsPorClave[item.clave] || {});
    var estado = nitsMismoNombre.length > 1
      ? "CONFLICTO NIT: " + nitsMismoNombre.join(" / ")
      : "OK";

    if (estado.indexOf("CONFLICTO") === 0) conflictos++;
    if (emails.length > 1) multiplesCorreos++;
    if (!emails.length) sinCorreo++;

    output.push([
      item.cliente,
      item.tipo,
      item.nit,
      item.dv,
      emails.join(","),
      item.clave,
      estado
    ]);
  }

  var oldRows = Math.max(0, hoja.getLastRow() - 1);
  if (oldRows > 0) hoja.getRange(2, 1, oldRows, HEADERS_DIRECTORIO.length).clearContent();

  if (output.length) {
    hoja.getRange(2, 3, output.length, 2).setNumberFormat("@");
    hoja.getRange(2, 1, output.length, HEADERS_DIRECTORIO.length).setValues(output);
  }

  var result = {
    filasRecibidas: rows.length,
    clientesImportados: output.length,
    conflictosNit: conflictos,
    clientesMultiplesCorreos: multiplesCorreos,
    clientesSinCorreo: sinCorreo
  };

  registrarLogSync_("DIRECTORIO", rows.length, 0, 0, 0, sinCorreo, conflictos, {
    meta: meta,
    result: result
  });

  return result;
}

function leerDirectorio_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_DIRECTORIO, HEADERS_DIRECTORIO);
  var data = hoja.getDataRange().getValues();
  var byKey = {};
  var byNit = {};

  for (var i = 1; i < data.length; i++) {
    var cliente = limpiarEspacios_(data[i][0]);
    var tipo = limpiarEspacios_(data[i][1]);
    var nit = normalizarNit_(data[i][2]);
    var dv = String(data[i][3] || "").replace(/\D/g, "");
    var correos = normalizarDestinatarios_(data[i][4]);
    var clave = limpiarEspacios_(data[i][5]) || normalizarCliente_(cliente);
    var estado = limpiarEspacios_(data[i][6]);
    if (!clave || !nit) continue;

    var entry = {
      cliente: cliente,
      tipo: tipo,
      nit: nit,
      dv: dv,
      correos: correos,
      clave: clave,
      estado: estado
    };

    if (!byKey[clave]) byKey[clave] = [];
    byKey[clave].push(entry);
    byNit[nit] = entry;
  }

  return { byKey: byKey, byNit: byNit };
}

function resolverDirectorio_(cliente, nitActual, directorio) {
  var nit = normalizarNit_(nitActual);
  if (nit && directorio.byNit[nit]) {
    return { entry: directorio.byNit[nit], conflicto: false };
  }

  var clave = normalizarCliente_(cliente);
  var entries = directorio.byKey[clave] || [];
  if (!entries.length) return { entry: null, conflicto: false };

  var nits = {};
  for (var i = 0; i < entries.length; i++) nits[entries[i].nit] = true;
  var listaNits = Object.keys(nits);

  if (listaNits.length > 1) {
    return { entry: null, conflicto: true, nits: listaNits };
  }

  return { entry: entries[0], conflicto: false };
}

// ============================================================================
// SINCRONIZACIÓN: INSERT / UPDATE POR N° FACTURA
// ============================================================================

function sincronizarFacturas_(invoices, tipo, meta) {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hojaFacturas = asegurarHoja_(ss, HOJA_FACTURAS, HEADERS_FACTURAS);
  var hojaCondiciones = asegurarHoja_(ss, HOJA_CONDICIONES, HEADERS_CONDICIONES);

  var data = hojaFacturas.getDataRange().getValues();
  if (!data.length) data = [HEADERS_FACTURAS.slice()];

  var condiciones = leerCondiciones_(hojaCondiciones);
  var directorio = leerDirectorio_();
  var filaPorFactura = {};
  var infoClientePorNit = {};

  for (var i = 1; i < data.length; i++) {
    asegurarColumnas_(data[i], HEADERS_FACTURAS.length);
    var facturaExistente = limpiarEspacios_(data[i][1]);
    var nitExistente = normalizarNit_(data[i][2]);
    if (facturaExistente) filaPorFactura[facturaExistente] = i;

    if (nitExistente && !infoClientePorNit[nitExistente]) {
      infoClientePorNit[nitExistente] = {
        categoria: limpiarEspacios_(data[i][7]) || "B",
        correo: normalizarDestinatarios_(data[i][10])
      };
    }
  }

  var nuevas = 0;
  var actualizadas = 0;
  var sinCambio = 0;
  var sinDirectorio = [];
  var conflictos = [];

  for (var j = 0; j < invoices.length; j++) {
    var incoming = normalizarFacturaEntrada_(invoices[j]);
    if (!incoming.nFactura || !incoming.cliente) continue;

    var indexExistente = filaPorFactura[incoming.nFactura];
    var row = indexExistente !== undefined ? data[indexExistente] : null;
    var nitActual = row ? normalizarNit_(row[2]) : normalizarNit_(incoming.nit);
    var dir = resolverDirectorio_(incoming.cliente, nitActual, directorio);

    if (!dir.entry) {
      if (dir.conflicto) {
        conflictos.push(incoming.nFactura + " - " + incoming.cliente + " [" + (dir.nits || []).join("/") + "]");
      } else {
        sinDirectorio.push(incoming.nFactura + " - " + incoming.cliente);
      }
    }

    var nitFinal = nitActual || (dir.entry ? dir.entry.nit : normalizarNit_(incoming.nit));
    var correosDirectorio = dir.entry ? dir.entry.correos : "";
    var correosEntrada = normalizarDestinatarios_(incoming.correosFacturacion);

    if (row) {
      var before = comparableFactura_(row);

      row[0] = incoming.fecha || row[0];
      if (nitFinal) row[2] = nitFinal;
      row[3] = incoming.cliente;
      row[4] = incoming.valorTotal;
      row[5] = incoming.valorAbonado;
      row[6] = incoming.saldoPendiente;

      var correoNuevo = correosEntrada || correosDirectorio;
      if (correoNuevo) row[10] = correoNuevo;

      row[12] = incoming.estadoInterno;

      var after = comparableFactura_(row);
      if (before !== after) actualizadas++;
      else sinCambio++;
      continue;
    }

    var infoPrev = nitFinal ? infoClientePorNit[nitFinal] : null;
    var categoriaFinal = infoPrev ? infoPrev.categoria : "B";
    var correoFinal = correosEntrada || correosDirectorio || (infoPrev ? infoPrev.correo : "");
    var condicion = nitFinal ? condiciones[nitFinal] : null;
    var esPrimeraFactura = !infoPrev;
    var plazoDias = 30;

    if (condicion) {
      if (esPrimeraFactura && Number(condicion.plazoPrimera) > 0) {
        plazoDias = Number(condicion.plazoPrimera);
      } else if (Number(condicion.plazoNormal) > 0) {
        plazoDias = Number(condicion.plazoNormal);
      }
    }

    var fechaFactura = parseFecha_(incoming.fecha) || new Date();
    var fechaVencimiento = sumarDias_(fechaFactura, plazoDias);

    var nuevaFila = [
      fechaFactura,
      incoming.nFactura,
      nitFinal,
      incoming.cliente,
      incoming.valorTotal,
      incoming.valorAbonado,
      incoming.saldoPendiente,
      categoriaFinal,
      plazoDias,
      fechaVencimiento,
      correoFinal,
      "",
      incoming.estadoInterno
    ];

    data.push(nuevaFila);
    filaPorFactura[incoming.nFactura] = data.length - 1;
    if (nitFinal) {
      infoClientePorNit[nitFinal] = { categoria: categoriaFinal, correo: correoFinal };
    }
    nuevas++;
  }

  var body = data.slice(1);
  if (body.length) {
    hojaFacturas.getRange(2, 1, body.length, HEADERS_FACTURAS.length).setValues(body);
    hojaFacturas.getRange(2, 1, body.length, 1).setNumberFormat("dd/MM/yyyy");
    hojaFacturas.getRange(2, 3, body.length, 1).setNumberFormat("@");
    hojaFacturas.getRange(2, 5, body.length, 3).setNumberFormat("#,##0");
    hojaFacturas.getRange(2, 10, body.length, 1).setNumberFormat("dd/MM/yyyy");
  }

  var result = {
    tipo: tipo,
    recibidas: invoices.length,
    nuevas: nuevas,
    actualizadas: actualizadas,
    sinCambio: sinCambio,
    sinDirectorio: sinDirectorio.length,
    conflictosDirectorio: conflictos.length,
    muestraSinDirectorio: sinDirectorio.slice(0, 20),
    muestraConflictos: conflictos.slice(0, 20)
  };

  registrarLogSync_(
    tipo,
    invoices.length,
    nuevas,
    actualizadas,
    sinCambio,
    sinDirectorio.length,
    conflictos.length,
    { meta: meta, result: result }
  );

  return result;
}

function normalizarFacturaEntrada_(raw) {
  raw = raw || {};
  var estadoBiofile = limpiarEspacios_(raw.estadoBiofile || raw.estado || "");
  return {
    fecha: raw.fecha || "",
    nFactura: limpiarEspacios_(raw.nFactura || raw.numero || ""),
    nit: normalizarNit_(raw.nit || ""),
    cliente: limpiarEspacios_(raw.cliente || ""),
    estadoBiofile: estadoBiofile,
    estadoInterno: estadoInternoDesdeBiofile_(estadoBiofile, raw.estadoInterno),
    valorTotal: numero_(raw.valorTotal),
    valorAbonado: numero_(raw.valorAbonado),
    saldoPendiente: numero_(raw.saldoPendiente !== undefined ? raw.saldoPendiente : raw.saldo),
    correosFacturacion: raw.correosFacturacion || raw.correos || ""
  };
}

function comparableFactura_(row) {
  return JSON.stringify({
    fecha: fechaISO_(row[0]),
    nit: normalizarNit_(row[2]),
    cliente: limpiarEspacios_(row[3]),
    total: numero_(row[4]),
    abono: numero_(row[5]),
    saldo: numero_(row[6]),
    correo: normalizarDestinatarios_(row[10]),
    estado: limpiarEspacios_(row[12])
  });
}

function obtenerContextoSemanal_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_FACTURAS, HEADERS_FACTURAS);
  var data = hoja.getDataRange().getValues();
  var abiertas = [];
  var oldest = null;

  for (var i = 1; i < data.length; i++) {
    var numero = limpiarEspacios_(data[i][1]);
    var saldo = numero_(data[i][6]);
    var estado = normalizarTexto_(data[i][12]);
    var abierta = numero && saldo > 0 &&
      estado !== "PAGADO" &&
      estado !== "ANULADA" &&
      estado !== "INCOBRABLE";

    if (!abierta) continue;
    abiertas.push(numero);

    var fecha = parseFecha_(data[i][0]);
    if (fecha && (!oldest || fecha.getTime() < oldest.getTime())) oldest = fecha;
  }

  return {
    oldestDate: oldest ? fechaISO_(oldest) : "",
    openInvoices: abiertas,
    totalOpen: abiertas.length
  };
}

// ============================================================================
// COMPATIBILIDAD: PESTAÑA IMPORTAR
// ============================================================================

function actualizarCarteraDesdeImportarManual() {
  var result = actualizarCarteraDesdeImportar();
  SpreadsheetApp.getUi().alert(
    "Actualización terminada.\n\n" +
    "Nuevas: " + result.nuevas + "\n" +
    "Actualizadas: " + result.actualizadas + "\n" +
    "Sin cambio: " + result.sinCambio + "\n" +
    "Sin directorio: " + result.sinDirectorio + "\n" +
    "Conflictos de directorio: " + result.conflictosDirectorio
  );
}

function actualizarCarteraDesdeImportar() {
  asegurarEstructura_();
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = ss.getSheetByName(HOJA_IMPORTAR);
  var data = hoja.getDataRange().getValues();
  var invoices = [];

  for (var i = 1; i < data.length; i++) {
    if (!data[i][1] || !data[i][3]) continue;
    invoices.push({
      fecha: data[i][0],
      nFactura: data[i][1],
      nit: data[i][2],
      cliente: data[i][3],
      valorTotal: data[i][4],
      valorAbonado: data[i][5],
      saldoPendiente: data[i][6],
      estadoBiofile: data[i][7] || "APROBADA",
      correosFacturacion: data[i][8] || ""
    });
  }

  var result = sincronizarFacturas_(invoices, "IMPORTAR_MANUAL", {});
  if (hoja.getLastRow() > 1) {
    hoja.getRange(2, 1, hoja.getLastRow() - 1, HEADERS_IMPORTAR.length).clearContent();
  }
  return result;
}

// ============================================================================
// CONDICIONES DE PAGO / CORREOS
// ============================================================================

function leerCondiciones_(hoja) {
  var data = hoja.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var nit = normalizarNit_(data[i][0]);
    if (!nit) continue;
    out[nit] = {
      plazoNormal: Number(data[i][2] || 30),
      plazoPrimera: Number(data[i][3] || 0)
    };
  }
  return out;
}

function poblarCondicionesDePago() {
  asegurarEstructura_();
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = ss.getSheetByName(HOJA_CONDICIONES);
  var directorio = leerDirectorio_();
  var actual = hoja.getDataRange().getValues();
  var existentes = {};

  for (var i = 1; i < actual.length; i++) {
    var nit = normalizarNit_(actual[i][0]);
    if (nit) existentes[nit] = true;
  }

  var agregar = [];
  var nits = Object.keys(directorio.byNit).sort();
  for (var j = 0; j < nits.length; j++) {
    var nitDir = nits[j];
    if (existentes[nitDir]) continue;
    var entry = directorio.byNit[nitDir];
    agregar.push([nitDir, entry.cliente, 30, ""]);
  }

  if (agregar.length) {
    hoja.getRange(hoja.getLastRow() + 1, 1, agregar.length, 4).setValues(agregar);
    hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).setNumberFormat("@");
  }

  SpreadsheetApp.getUi().alert(
    "Condiciones de Pago: se agregaron " + agregar.length +
    " clientes que no estaban configurados.\n\n" +
    "Se usó 30 días como plazo normal por defecto. Revisa los clientes que tengan condiciones especiales."
  );
}

function completarCorreosFacturacion() {
  asegurarEstructura_();
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = ss.getSheetByName(HOJA_FACTURAS);
  var data = hoja.getDataRange().getValues();
  var directorio = leerDirectorio_();
  var actualizados = 0;
  var sinCoincidencia = 0;

  for (var i = 1; i < data.length; i++) {
    var res = resolverDirectorio_(data[i][3], data[i][2], directorio);
    if (!res.entry || !res.entry.correos) {
      sinCoincidencia++;
      continue;
    }

    var nuevo = normalizarDestinatarios_(res.entry.correos);
    var actual = normalizarDestinatarios_(data[i][10]);
    if (nuevo && nuevo !== actual) {
      data[i][10] = nuevo;
      actualizados++;
    }
  }

  if (data.length > 1) {
    hoja.getRange(2, 1, data.length - 1, HEADERS_FACTURAS.length).setValues(data.slice(1));
  }

  SpreadsheetApp.getUi().alert(
    "Correos actualizados: " + actualizados + "\n" +
    "Facturas sin correo/directorio resoluble: " + sinCoincidencia
  );
}

// ============================================================================
// VIGILANCIA Y CORREOS DE COBRO
// ============================================================================

function vigilarCobros() {
  // Mantiene el nombre del trigger existente, pero usa el mismo motor central
  // que la consola administrativa. Las reglas de nivel siguen siendo calcularNivel().
  return vigilarCobrosCentral_();
}

function calcularNivel(categoria, diasVencido) {
  categoria = normalizarTexto_(categoria);
  diasVencido = Number(diasVencido);

  if (!isFinite(diasVencido)) return null;

  // Los niveles permanecen activos durante su rango.
  // Así no dependemos de ejecutar exactamente el día del umbral.
  if (categoria === "A") {
    if (diasVencido < 10) return null;
    if (diasVencido <= 18) return 1;
    if (diasVencido <= 27) return 2;
    if (diasVencido <= 36) return 3;
    if (diasVencido <= 45) return 4;
    if (diasVencido <= 54) return 5;
    if (diasVencido <= 63) return 6;
    if (diasVencido <= 72) return 7;
    return 8;
  }

  if (categoria === "B") {
    // Aviso preventivo: desde 5 días antes del vencimiento hasta el día anterior.
    if (diasVencido < -5) return null;
    if (diasVencido < 0) return 1;

    if (diasVencido <= 8) return 2;
    if (diasVencido <= 17) return 3;

    // Regla solicitada: 18 a 27 días permanece en nivel 4;
    // al llegar a 28 días pasa a nivel 5.
    if (diasVencido <= 27) return 4;
    if (diasVencido <= 36) return 5;
    if (diasVencido <= 45) return 6;
    if (diasVencido <= 54) return 7;
    return 8;
  }

  if (categoria === "C") {
    if (diasVencido < 0) return null;
    if (diasVencido <= 8) return 3;
    if (diasVencido <= 17) return 4;
    if (diasVencido <= 26) return 5;
    if (diasVencido <= 35) return 6;
    if (diasVencido <= 44) return 7;
    return 8;
  }

  return null;
}

function enviarRecordatorio_(cliente, nFactura, saldo, fechaVenc, diasVencido, correo, nivel, categoria) {
  var asunto = "Recordatorio de pago - Factura " + nFactura;
  var cuerpo = generarMensaje_(cliente, nFactura, saldo, fechaVenc, diasVencido, nivel);
  var opciones = { name: "VIP Salud Ocupacional - Cartera" };

  if (normalizarTexto_(categoria) === "C" && diasVencido >= 15) {
    opciones.cc = CORREO_CONTABILIDAD;
  }

  MailApp.sendEmail(correo, asunto, cuerpo, opciones);
}

function generarMensaje_(cliente, nFactura, saldo, fechaVenc, diasVencido, nivel) {
  var fechaTexto = Utilities.formatDate(fechaVenc, "America/Bogota", "dd/MM/yyyy");
  var saldoTexto = Number(saldo).toLocaleString("es-CO");

  var encabezado =
    "Cordial saludo, " + cliente + ",\n\n" +
    "Este es un mensaje automático de nuestro sistema de cartera. " +
    "Se detendrá automáticamente en cuanto se registre el pago.\n\n";

  var detalle =
    "Factura número: " + nFactura + "\n" +
    "Valor pendiente: $" + saldoTexto + "\n" +
    "Fecha de vencimiento: " + fechaTexto + "\n" +
    (diasVencido < 0
      ? "Faltan " + Math.abs(diasVencido) + " días para el vencimiento\n\n"
      : diasVencido === 0
        ? "La factura vence hoy\n\n"
        : "Días de mora: " + diasVencido + "\n\n");

  var pie =
    "\n\nDatos para el pago:\n" + DATOS_BANCARIOS +
    "\n\nSi ya realizó el pago, por favor ignore este mensaje y responda con el comprobante para actualizar nuestros registros.\n\n" +
    "Cordialmente,\nVIP Salud Ocupacional SAS";

  return encabezado + detalle + textoSegunNivel_(nivel) + pie;
}

function textoSegunNivel_(nivel) {
  var textos = {
    1: "Le recordamos amablemente que tiene una factura próxima a vencer o recién vencida.",
    2: "Le escribimos nuevamente para recordarle el pago pendiente indicado arriba.",
    3: "Notamos que el pago sigue pendiente. Agradecemos su gestión a la brevedad posible.",
    4: "Esta es una tercera notificación sobre el saldo pendiente. Por favor, priorice su gestión.",
    5: "El retraso en el pago ya es considerable. Le pedimos regularizar la situación pronto.",
    6: "Esta situación requiere atención inmediata de su parte para evitar mayores inconvenientes.",
    7: "Ante la persistencia de la mora, le solicitamos comunicarse con nosotros para acordar un plan de pago.",
    8: "De no recibir respuesta a la brevedad, nos veremos en la obligación de iniciar gestión de cobro jurídico para la recuperación de esta cartera."
  };
  return textos[nivel] || textos[1];
}

function avisarCarteraCritica_(cliente, nFactura, saldo, diasVencido, categoria) {
  var asunto = "ALERTA: Factura con más de 100 días en mora - " + nFactura;
  var cuerpo =
    "Cliente: " + cliente + "\n" +
    "Factura: " + nFactura + "\n" +
    "Categoría: " + categoria + "\n" +
    "Saldo pendiente: $" + Number(saldo).toLocaleString("es-CO") + "\n" +
    "Días en mora: " + diasVencido + "\n\n" +
    "Esta factura superó los 100 días de mora.";

  MailApp.sendEmail(CORREO_VIP, asunto, cuerpo, { name: "VIP Salud Ocupacional - Cartera" });
}

function registrarHistorial_(nFactura, cliente, categoria, nivel, correo) {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_HISTORIAL, HEADERS_HISTORIAL);
  hoja.appendRow([new Date(), nFactura, cliente, categoria, nivel, correo]);
}

function yaSeEnvioHoy_(nFactura, nivel) {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_HISTORIAL, HEADERS_HISTORIAL);
  if (hoja.getLastRow() < 2) return false;

  var datos = hoja.getDataRange().getValues();
  var hoy = Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd");

  for (var i = datos.length - 1; i >= 1; i--) {
    var fecha = parseFecha_(datos[i][0]);
    if (!fecha) continue;
    var fechaTexto = Utilities.formatDate(fecha, "America/Bogota", "yyyy-MM-dd");
    if (fechaTexto < hoy) break;
    if (fechaTexto === hoy && String(datos[i][1]) === String(nFactura) && Number(datos[i][4]) === Number(nivel)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// MODO PRUEBA / PRODUCCIÓN
// ============================================================================

function getModoPrueba_() {
  var value = PropertiesService.getScriptProperties().getProperty("MODO_PRUEBA");
  if (value === null || value === "") return true;
  return String(value).toLowerCase() !== "false";
}

function mostrarModoActual() {
  SpreadsheetApp.getUi().alert(
    getModoPrueba_()
      ? "MODO PRUEBA ACTIVO: no se envían correos reales."
      : "MODO PRODUCCIÓN ACTIVO: sí se pueden enviar correos reales."
  );
}

function activarModoPrueba() {
  PropertiesService.getScriptProperties().setProperty("MODO_PRUEBA", "true");
  SpreadsheetApp.getUi().alert("MODO PRUEBA activado. No se enviarán correos reales.");
}

function activarProduccion() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    "Activar PRODUCCIÓN",
    "Esto permitirá que vigilarCobros envíe correos reales a los clientes. ¿Deseas continuar?",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty("MODO_PRUEBA", "false");
  ui.alert("PRODUCCIÓN activada.");
}

function probarAppsScriptConFacturaFalsa() {
  asegurarEstructura_();
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = ss.getSheetByName(HOJA_PRUEBA) || ss.insertSheet(HOJA_PRUEBA);
  hoja.clearContents();

  var headers = ["Paso", "Factura", "Estado Biofile", "Total", "Abono", "Saldo", "Estado Interno"];
  var casos = [
    ["1. Creación", "FE-TEST-001", "APROBADA", 500000, 0, 500000],
    ["2. Pago parcial", "FE-TEST-001", "PAGO PARCIAL", 500000, 200000, 300000],
    ["3. Pago total", "FE-TEST-001", "PAGO TOTAL", 500000, 500000, 0],
    ["4. Anulación", "FE-TEST-002", "ANULADA", 300000, 0, 0]
  ];

  var rows = [];
  for (var i = 0; i < casos.length; i++) {
    rows.push(casos[i].concat([estadoInternoDesdeBiofile_(casos[i][2], "")]));
  }

  hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
  hoja.getRange(2, 1, rows.length, headers.length).setValues(rows);
  hoja.getRange(2, 4, rows.length, 3).setNumberFormat("#,##0");
  hoja.setFrozenRows(1);

  SpreadsheetApp.getUi().alert(
    "Prueba falsa creada en la pestaña '" + HOJA_PRUEBA + "'.\n\n" +
    "No se modificó Facturas y no se envió ningún correo."
  );
}

function crearTriggerVigilarCobros() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "vigilarCobros") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger("vigilarCobros")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  SpreadsheetApp.getUi().alert(
    "Trigger creado para ejecutar vigilarCobros diariamente alrededor de las 8:00 a. m.\n\n" +
    "Verifica que la zona horaria del proyecto Apps Script sea America/Bogota."
  );
}

// ============================================================================
// LOG
// ============================================================================

function registrarLogSync_(tipo, recibidas, nuevas, actualizadas, sinCambio, sinDirectorio, conflictos, detalle) {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_LOG_SYNC, HEADERS_LOG);
  var text = "";
  try { text = JSON.stringify(detalle || {}); } catch (ignore) { text = String(detalle || ""); }
  if (text.length > 20000) text = text.slice(0, 20000) + "...";

  hoja.appendRow([
    new Date(), tipo, recibidas, nuevas, actualizadas, sinCambio,
    sinDirectorio, conflictos, text
  ]);
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizarNit_(value) {
  return String(value === undefined || value === null ? "" : value).replace(/\D/g, "");
}

function limpiarEspacios_(value) {
  return String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();
}

function normalizarTexto_(value) {
  var text = limpiarEspacios_(value).toUpperCase();
  try {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (ignore) {
    return text;
  }
}

function normalizarCliente_(value) {
  return normalizarTexto_(value).replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

function extraerCorreos_(value) {
  var matches = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < matches.length; i++) {
    var email = String(matches[i]).toLowerCase();
    if (!seen[email]) {
      seen[email] = true;
      out.push(email);
    }
  }
  return out;
}

function normalizarDestinatarios_(value) {
  return extraerCorreos_(value).join(",");
}

function numero_(value) {
  if (typeof value === "number") return isNaN(value) ? 0 : value;
  var text = String(value === undefined || value === null ? "" : value)
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/[^0-9-]/g, "");
  return text ? Number(text) : 0;
}

function estadoInternoDesdeBiofile_(estadoBiofile, fallback) {
  var state = normalizarTexto_(estadoBiofile);
  if (state.indexOf("ANUL") >= 0) return "Anulada";
  if (state.indexOf("PAGO TOTAL") >= 0 || state === "PAGADA") return "Pagado";
  if (state.indexOf("PAGO PARCIAL") >= 0) return "Pago parcial";
  if (state.indexOf("APROBADA") >= 0 || state.indexOf("SIN PAGAR") >= 0 || state.indexOf("PROCESADA") >= 0) return "Pendiente";

  var fb = limpiarEspacios_(fallback);
  return fb || "Pendiente";
}

function parseFecha_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  var text = limpiarEspacios_(value);
  var m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function fechaISO_(value) {
  var d = parseFecha_(value);
  if (!d) return "";
  return Utilities.formatDate(d, "America/Bogota", "yyyy-MM-dd");
}

function sumarDias_(date, days) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function asegurarColumnas_(row, length) {
  while (row.length < length) row.push("");
  return row;
}
