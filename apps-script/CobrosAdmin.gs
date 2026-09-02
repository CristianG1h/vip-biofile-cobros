// ============================================================================
// VIP COBROS - MOTOR CENTRAL DE COBRO / CONSOLA ADMIN
// Version 4.4.0
// ============================================================================
// Este archivo reutiliza las reglas existentes definidas en CobrosVIP.gs:
// - calcularNivel()
// - textoSegunNivel_()
// - leerDirectorio_()
// - leerCondiciones_()
// - resolverDirectorio_()
// - registrarHistorial_()
// - avisarCarteraCritica_()
// - helpers de fechas, NIT, correos y montos.
//
// NO define nuevas reglas de niveles. Solo centraliza preview/envío y agrupación.
// ============================================================================

var HOJA_LOG_COBROS_ADMIN = "LOG COBROS ADMIN";
var HEADERS_LOG_COBROS_ADMIN = [
  "Fecha/Hora", "Proceso ID", "Empresa", "Facturas", "Saldo",
  "Días Mora", "Nivel", "Destinatario", "Resultado", "Detalle"
];

function asegurarLogCobrosAdmin_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  return asegurarHoja_(ss, HOJA_LOG_COBROS_ADMIN, HEADERS_LOG_COBROS_ADMIN);
}

function registrarLogCobroAdmin_(row) {
  var hoja = asegurarLogCobrosAdmin_();
  hoja.appendRow([
    new Date(),
    limpiarEspacios_(row.processId),
    limpiarEspacios_(row.empresa),
    limpiarEspacios_(row.facturas),
    numero_(row.saldo),
    limpiarEspacios_(row.diasMora),
    limpiarEspacios_(row.nivel),
    normalizarDestinatarios_(row.destinatario),
    limpiarEspacios_(row.resultado),
    limpiarEspacios_(row.detalle)
  ]);
}

function leerHistorialNivelesEnviados_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_HISTORIAL, HEADERS_HISTORIAL);
  var data = hoja.getDataRange().getValues();
  var out = {};

  for (var i = 1; i < data.length; i++) {
    var factura = limpiarEspacios_(data[i][1]);
    var nivel = Number(data[i][4]);
    if (!factura || !isFinite(nivel) || nivel < 1) continue;
    if (!out[factura]) out[factura] = {};
    out[factura][nivel] = true;
  }

  return out;
}

function leerContextoFacturas_() {
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = asegurarHoja_(ss, HOJA_FACTURAS, HEADERS_FACTURAS);
  var data = hoja.getDataRange().getValues();
  var byFactura = {};
  var primeraFechaPorNit = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    asegurarColumnas_(row, HEADERS_FACTURAS.length);
    var factura = limpiarEspacios_(row[1]);
    var nit = normalizarNit_(row[2]);
    if (factura) byFactura[factura] = row;

    var fecha = parseFecha_(row[0]);
    if (nit && fecha) {
      if (!primeraFechaPorNit[nit] || fecha.getTime() < primeraFechaPorNit[nit].getTime()) {
        primeraFechaPorNit[nit] = fecha;
      }
    }
  }

  return {
    rows: data,
    byFactura: byFactura,
    primeraFechaPorNit: primeraFechaPorNit
  };
}

function fechaInicioIgual_(a, b) {
  if (!a || !b) return false;
  return fechaISO_(a) === fechaISO_(b);
}

function calcularPlazoParaCobro_(nit, fechaFactura, existingRow, condiciones, contexto) {
  var existingPlazo = existingRow ? Number(existingRow[8] || 0) : 0;
  if (existingPlazo > 0) return existingPlazo;

  var condicion = nit ? condiciones[nit] : null;
  if (!condicion) return 30;

  var primera = nit && fechaInicioIgual_(fechaFactura, contexto.primeraFechaPorNit[nit]);
  if (primera && Number(condicion.plazoPrimera) > 0) {
    return Number(condicion.plazoPrimera);
  }

  if (Number(condicion.plazoNormal) > 0) {
    return Number(condicion.plazoNormal);
  }

  return 30;
}

function unionCorreos_(values) {
  return normalizarDestinatarios_((values || []).join(","));
}

function obtenerReservaCuotaCobros_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("COBRO_RESERVA_CUOTA");
  var value = Number(raw === null || raw === "" ? 10 : raw);
  if (!isFinite(value) || value < 0) value = 10;
  return Math.floor(value);
}

function obtenerEstadoCuotaCobros_() {
  var restante = Number(MailApp.getRemainingDailyQuota());
  if (!isFinite(restante) || restante < 0) restante = 0;

  var reserva = obtenerReservaCuotaCobros_();
  return {
    restante: restante,
    reserva: reserva,
    operativa: Math.max(0, restante - reserva)
  };
}

function obtenerInfoDestinatariosGrupo_(group) {
  var to = normalizarDestinatarios_(group && group.correo ? group.correo : "");
  var necesitaCC = false;

  var facturas = group && group.facturas ? group.facturas : [];
  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    if (f.accion !== "SE_ENVIARIA_CORREO") continue;
    if (
      normalizarTexto_(f.categoria) === "C" &&
      Number(f.diasMora || 0) >= 15
    ) {
      necesitaCC = true;
      break;
    }
  }

  var cc = "";
  if (necesitaCC) {
    var correoContabilidad = normalizarDestinatarios_(CORREO_CONTABILIDAD);
    var listaTo = extraerCorreos_(to);
    var listaCc = extraerCorreos_(correoContabilidad);
    var existe = {};

    for (var j = 0; j < listaTo.length; j++) existe[listaTo[j]] = true;

    var ccFinal = [];
    for (var k = 0; k < listaCc.length; k++) {
      if (!existe[listaCc[k]]) {
        existe[listaCc[k]] = true;
        ccFinal.push(listaCc[k]);
      }
    }
    cc = ccFinal.join(",");
  }

  var todos = extraerCorreos_([to, cc].join(","));
  return {
    to: to,
    cc: cc,
    cantidad: todos.length
  };
}

function prepararFacturaCobro_(raw, hoy, directorio, condiciones, contexto, historial) {
  raw = raw || {};

  var incoming = normalizarFacturaEntrada_(raw);
  if (!incoming.nFactura || !incoming.cliente) return null;
  if (numero_(incoming.saldoPendiente) <= 0) return null;

  var existing = contexto.byFactura[incoming.nFactura] || null;
  var nitActual = existing ? normalizarNit_(existing[2]) : normalizarNit_(incoming.nit);
  var dir = resolverDirectorio_(incoming.cliente, nitActual, directorio);

  var nit = nitActual || (dir.entry ? dir.entry.nit : normalizarNit_(incoming.nit));
  var fechaFactura = parseFecha_(incoming.fecha || (existing ? existing[0] : ""));
  if (!fechaFactura) return null;
  fechaFactura.setHours(0, 0, 0, 0);

  var categoria = existing ? limpiarEspacios_(existing[7]) : "";
  if (!categoria) categoria = "B";

  var plazo = calcularPlazoParaCobro_(
    nit,
    fechaFactura,
    existing,
    condiciones,
    contexto
  );

  var fechaVencimiento = existing ? parseFecha_(existing[9]) : null;
  if (!fechaVencimiento) fechaVencimiento = sumarDias_(fechaFactura, plazo);
  fechaVencimiento.setHours(0, 0, 0, 0);

  var diasMora = Math.round(
    (hoy.getTime() - fechaVencimiento.getTime()) / 86400000
  );

  var correos = unionCorreos_([
    incoming.correosFacturacion,
    existing ? existing[10] : "",
    dir.entry ? dir.entry.correos : ""
  ]);

  var estado = normalizarTexto_(incoming.estadoInterno || incoming.estadoBiofile);
  if (estado === "PAGADO" || estado === "ANULADA" || estado === "INCOBRABLE") {
    return null;
  }

  var nivel = calcularNivel(categoria, diasMora);
  var nivelesEnviados = historial[incoming.nFactura] || {};
  var accion = "NO_CORRESPONDE_HOY";

  if (!correos) {
    accion = "OMITIDO_SIN_CORREO";
  } else if (diasMora < 0) {
    // La regla existente de categoría B puede devolver nivel 1 a -5 días.
    // Si calcularNivel ya devuelve nivel, respetamos esa regla.
    if (nivel !== null && !nivelesEnviados[nivel]) accion = "SE_ENVIARIA_CORREO";
  } else if (nivel !== null && nivelesEnviados[nivel]) {
    accion = "NIVEL_YA_ENVIADO";
  } else if (nivel !== null) {
    accion = "SE_ENVIARIA_CORREO";
  }

  if (nivel !== null && nivelesEnviados[nivel]) {
    accion = "NIVEL_YA_ENVIADO";
  }

  return {
    fechaFactura: fechaISO_(fechaFactura),
    nFactura: incoming.nFactura,
    nit: nit,
    cliente: incoming.cliente,
    estadoBiofile: incoming.estadoBiofile,
    estadoInterno: incoming.estadoInterno,
    valorTotal: numero_(incoming.valorTotal),
    valorAbonado: numero_(incoming.valorAbonado),
    saldo: numero_(incoming.saldoPendiente),
    categoria: categoria,
    plazo: plazo,
    fechaVencimiento: fechaISO_(fechaVencimiento),
    diasMora: diasMora,
    nivel: nivel,
    correo: correos,
    accion: accion,
    conflictoDirectorio: !!dir.conflicto
  };
}

function planificarCobrosDesdeBiofile_(invoices, meta) {
  asegurarEstructura_();

  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var condiciones = leerCondiciones_(ss.getSheetByName(HOJA_CONDICIONES));
  var directorio = leerDirectorio_();
  var contexto = leerContextoFacturas_();
  var historial = leerHistorialNivelesEnviados_();

  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  var facturas = [];
  for (var i = 0; i < invoices.length; i++) {
    var item = prepararFacturaCobro_(
      invoices[i],
      hoy,
      directorio,
      condiciones,
      contexto,
      historial
    );
    if (item && item.saldo > 0) facturas.push(item);
  }

  var grouped = {};
  for (var j = 0; j < facturas.length; j++) {
    var f = facturas[j];
    var key = f.nit || normalizarCliente_(f.cliente);
    if (!grouped[key]) {
      grouped[key] = {
        key: key,
        cliente: f.cliente,
        correo: "",
        saldo: 0,
        saldoTotalEmpresa: 0,
        nivel: null,
        maxDiasMora: null,
        destinatariosCuota: 0,
        estadoCuota: "NO_APLICA",
        accion: "SIN_ENVIO",
        facturas: []
      };
    }

    var g = grouped[key];
    g.saldoTotalEmpresa += f.saldo;
    g.facturas.push(f);

    // Mostrar siempre los correos encontrados en el preview, aunque hoy no toque enviar.
    g.correo = unionCorreos_([g.correo, f.correo]);

    if (f.accion === "SE_ENVIARIA_CORREO") {
      g.saldo += f.saldo;
      g.nivel = g.nivel === null ? f.nivel : Math.max(g.nivel, f.nivel);
      g.maxDiasMora = g.maxDiasMora === null
        ? Number(f.diasMora || 0)
        : Math.max(g.maxDiasMora, Number(f.diasMora || 0));
      g.accion = "SE_ENVIARIA_CORREO";
    }
  }

  var groups = Object.keys(grouped)
    .map(function(k) { return grouped[k]; })
    .sort(function(a, b) {
      var aEnvio = a.accion === "SE_ENVIARIA_CORREO" ? 1 : 0;
      var bEnvio = b.accion === "SE_ENVIARIA_CORREO" ? 1 : 0;
      if (aEnvio !== bEnvio) return bEnvio - aEnvio;

      var nivelA = Number(a.nivel || 0);
      var nivelB = Number(b.nivel || 0);
      if (nivelA !== nivelB) return nivelB - nivelA;

      var moraA = Number(a.maxDiasMora || 0);
      var moraB = Number(b.maxDiasMora || 0);
      if (moraA !== moraB) return moraB - moraA;

      return normalizarCliente_(a.cliente).localeCompare(normalizarCliente_(b.cliente));
    });

  var saldoTotal = 0;
  var saldoAEnviar = 0;
  var facturasConEnvio = 0;
  var empresasConEnvio = 0;
  var destinatariosPlaneados = 0;

  for (var x = 0; x < groups.length; x++) {
    saldoTotal += groups[x].saldoTotalEmpresa;
    if (groups[x].accion === "SE_ENVIARIA_CORREO") {
      empresasConEnvio++;
      saldoAEnviar += groups[x].saldo;

      var infoDest = obtenerInfoDestinatariosGrupo_(groups[x]);
      groups[x].destinatariosCuota = infoDest.cantidad;
      destinatariosPlaneados += infoDest.cantidad;

      for (var y = 0; y < groups[x].facturas.length; y++) {
        if (groups[x].facturas[y].accion === "SE_ENVIARIA_CORREO") {
          facturasConEnvio++;
        }
      }
    }
  }

  var cuota = obtenerEstadoCuotaCobros_();
  var cupoPreview = cuota.operativa;
  var empresasQueCabenHoy = 0;
  var destinatariosQueCabenHoy = 0;
  var empresasPendientesPorCuota = 0;
  var bloqueadoPorPrioridad = false;

  for (var q = 0; q < groups.length; q++) {
    var grupoCuota = groups[q];
    if (grupoCuota.accion !== "SE_ENVIARIA_CORREO") continue;

    var costo = Number(grupoCuota.destinatariosCuota || 0);
    if (
      !bloqueadoPorPrioridad &&
      costo > 0 &&
      costo <= cupoPreview
    ) {
      grupoCuota.estadoCuota = "CABRIA_HOY";
      cupoPreview -= costo;
      empresasQueCabenHoy++;
      destinatariosQueCabenHoy += costo;
    } else {
      grupoCuota.estadoCuota = "PENDIENTE_POR_CUOTA";
      empresasPendientesPorCuota++;
      bloqueadoPorPrioridad = true;
    }
  }

  return {
    meta: meta || {},
    summary: {
      filtroBiofile: "CON DEUDA",
      desde: limpiarEspacios_((meta || {}).desde),
      hasta: limpiarEspacios_((meta || {}).hasta),
      facturasConSaldo: facturas.length,
      empresas: groups.length,
      saldoTotal: saldoTotal,
      empresasConEnvio: empresasConEnvio,
      facturasConEnvio: facturasConEnvio,
      saldoAEnviar: saldoAEnviar,
      cuotaRestanteGmail: cuota.restante,
      reservaCuota: cuota.reserva,
      cuotaOperativa: cuota.operativa,
      destinatariosPlaneados: destinatariosPlaneados,
      empresasQueCabenHoy: empresasQueCabenHoy,
      destinatariosQueCabenHoy: destinatariosQueCabenHoy,
      empresasPendientesPorCuota: empresasPendientesPorCuota
    },
    groups: groups
  };
}

function textoEstadoVencimiento_(diasMora) {
  var dias = Number(diasMora || 0);
  if (dias < 0) return "Vence en " + Math.abs(dias) + " días";
  if (dias === 0) return "Vence hoy";
  return "Mora: " + dias + " días";
}

function cuerpoGrupoCobro_(group) {
  var facturas = [];
  var nivelMaximo = group.nivel || 1;

  for (var i = 0; i < group.facturas.length; i++) {
    var f = group.facturas[i];
    if (f.accion !== "SE_ENVIARIA_CORREO") continue;
    facturas.push(
      "- " + f.nFactura +
      " | Saldo: $" + Number(f.saldo).toLocaleString("es-CO") +
      " | Vencimiento: " + f.fechaVencimiento +
      " | " + textoEstadoVencimiento_(f.diasMora)
    );
  }

  return (
    "Cordial saludo, " + group.cliente + ",\n\n" +
    "Este es un mensaje automático de nuestro sistema de cartera. " +
    "Se detendrá automáticamente en cuanto se registre el pago.\n\n" +
    "Facturas incluidas en este recordatorio:\n" +
    facturas.join("\n") +
    "\n\nTotal pendiente incluido: $" +
    Number(group.saldo).toLocaleString("es-CO") +
    "\n\n" +
    textoSegunNivel_(nivelMaximo) +
    "\n\nDatos para el pago:\n" + DATOS_BANCARIOS +
    "\n\nSi ya realizó el pago, por favor ignore este mensaje y responda con el comprobante para actualizar nuestros registros.\n\n" +
    "Cordialmente,\nVIP Salud Ocupacional SAS"
  );
}

function esErrorGeneralCorreo_(err) {
  var text = normalizarTexto_(err && err.message ? err.message : err);
  return (
    text.indexOf("QUOTA") >= 0 ||
    text.indexOf("SERVICE INVOKED TOO MANY TIMES") >= 0 ||
    text.indexOf("DAILY LIMIT") >= 0
  );
}

function tomarLockCobro_(processId) {
  var props = PropertiesService.getScriptProperties();
  var actual = limpiarEspacios_(props.getProperty("COBRO_REAL_EN_EJECUCION"));
  if (actual) {
    throw new Error("YA EXISTE UN PROCESO DE COBRO EN EJECUCIÓN");
  }
  props.setProperty("COBRO_REAL_EN_EJECUCION", processId);
}

function liberarLockCobro_(processId) {
  var props = PropertiesService.getScriptProperties();
  var actual = limpiarEspacios_(props.getProperty("COBRO_REAL_EN_EJECUCION"));
  if (actual === limpiarEspacios_(processId)) {
    props.deleteProperty("COBRO_REAL_EN_EJECUCION");
  }
}

function enviarCobrosDesdeBiofile_(invoices, meta) {
  if (getModoPrueba_()) {
    throw new Error(
      "MODO PRUEBA está activo. No se permite envío real hasta activar PRODUCCIÓN manualmente."
    );
  }

  var processId = limpiarEspacios_((meta || {}).processId) || Utilities.getUuid();
  tomarLockCobro_(processId);

  try {
    var plan = planificarCobrosDesdeBiofile_(invoices, meta);
    var enviadosEmpresas = 0;
    var enviadosFacturas = 0;
    var omitidos = 0;
    var errores = 0;
    var destinatariosConsumidos = 0;
    var empresasPendientesPorCuota = 0;
    var finalizadoPorCuota = false;
    var cuotaInicial = obtenerEstadoCuotaCobros_();
    var reservaCuota = cuotaInicial.reserva;

    for (var i = 0; i < plan.groups.length; i++) {
      var group = plan.groups[i];
      if (group.accion !== "SE_ENVIARIA_CORREO" || !group.correo) {
        omitidos++;
        continue;
      }

      var facturasEnvio = [];
      var maxDias = 0;

      for (var j = 0; j < group.facturas.length; j++) {
        var f = group.facturas[j];
        if (f.accion !== "SE_ENVIARIA_CORREO") continue;
        facturasEnvio.push(f);
        maxDias = Math.max(maxDias, Number(f.diasMora || 0));
      }

      if (!facturasEnvio.length) {
        omitidos++;
        continue;
      }

      var infoDestinatarios = obtenerInfoDestinatariosGrupo_(group);
      var cuotaAhora = obtenerEstadoCuotaCobros_();

      if (
        infoDestinatarios.cantidad <= 0 ||
        infoDestinatarios.cantidad > cuotaAhora.operativa
      ) {
        finalizadoPorCuota = true;

        // Mantener prioridad estricta: no saltamos a empresas de menor nivel
        // solo para aprovechar uno o dos destinatarios sobrantes.
        for (var p = i; p < plan.groups.length; p++) {
          var pendiente = plan.groups[p];
          if (pendiente.accion !== "SE_ENVIARIA_CORREO") continue;

          empresasPendientesPorCuota++;
          var infoPendiente = obtenerInfoDestinatariosGrupo_(pendiente);

          registrarLogCobroAdmin_({
            processId: processId,
            empresa: pendiente.cliente,
            facturas: (pendiente.facturas || [])
              .filter(function(item) { return item.accion === "SE_ENVIARIA_CORREO"; })
              .map(function(item) { return item.nFactura; })
              .join(", "),
            saldo: pendiente.saldo,
            diasMora: pendiente.maxDiasMora,
            nivel: pendiente.nivel,
            destinatario: pendiente.correo,
            resultado: "PENDIENTE_POR_CUOTA",
            detalle:
              "Necesita " + infoPendiente.cantidad +
              " destinatarios. Cuota restante=" + cuotaAhora.restante +
              ", reserva=" + reservaCuota +
              ", operativa=" + cuotaAhora.operativa
          });
        }
        break;
      }

      try {
        var asunto =
          "Recordatorio de pago - " + group.cliente +
          " - " + facturasEnvio.length +
          (facturasEnvio.length === 1 ? " factura" : " facturas");

        var opciones = { name: "VIP Salud Ocupacional - Cartera" };
        if (infoDestinatarios.cc) opciones.cc = infoDestinatarios.cc;

        MailApp.sendEmail(
          infoDestinatarios.to,
          asunto,
          cuerpoGrupoCobro_(group),
          opciones
        );

        destinatariosConsumidos += infoDestinatarios.cantidad;

        // Registro inmediato por factura. Solo después de sendEmail exitoso.
        for (var k = 0; k < facturasEnvio.length; k++) {
          var item = facturasEnvio[k];

          registrarHistorial_(
            item.nFactura,
            item.cliente,
            item.categoria,
            item.nivel,
            group.correo
          );

          registrarLogCobroAdmin_({
            processId: processId,
            empresa: item.cliente,
            facturas: item.nFactura,
            saldo: item.saldo,
            diasMora: item.diasMora,
            nivel: item.nivel,
            destinatario: group.correo,
            resultado: "ENVIADO",
            detalle: "Correo agrupado enviado correctamente"
          });

          enviadosFacturas++;

          if (item.diasMora >= 100) {
            try {
              // La reserva existe precisamente para alertas internas y otros usos.
              // Si ya no queda cuota, la alerta se omite sin afectar el envío al cliente.
              if (MailApp.getRemainingDailyQuota() > 0) {
                avisarCarteraCritica_(
                  item.cliente,
                  item.nFactura,
                  item.saldo,
                  item.diasMora,
                  item.categoria
                );
              }
            } catch (ignoreAlert) {}
          }
        }

        enviadosEmpresas++;
      } catch (err) {
        errores++;

        registrarLogCobroAdmin_({
          processId: processId,
          empresa: group.cliente,
          facturas: facturasEnvio.map(function(f) { return f.nFactura; }).join(", "),
          saldo: group.saldo,
          diasMora: maxDias,
          nivel: group.nivel,
          destinatario: group.correo,
          resultado: "ERROR",
          detalle: String(err && err.message ? err.message : err).slice(0, 500)
        });

        if (esErrorGeneralCorreo_(err)) throw err;
        // Error individual: continuar con la siguiente empresa.
      }
    }

    if (
      enviadosFacturas > 0 &&
      (limpiarEspacios_((meta || {}).source) === "admin_console_real" ||
       limpiarEspacios_((meta || {}).source) === "cli_real")
    ) {
      PropertiesService.getScriptProperties()
        .setProperty("PRIMER_ENVIO_REAL_CONFIRMADO", "true");
    }

    return {
      processId: processId,
      summary: plan.summary,
      enviadosEmpresas: enviadosEmpresas,
      enviadosFacturas: enviadosFacturas,
      omitidos: omitidos,
      errores: errores,
      destinatariosConsumidos: destinatariosConsumidos,
      cuotaInicial: cuotaInicial.restante,
      reservaCuota: reservaCuota,
      cuotaRestante: Number(MailApp.getRemainingDailyQuota()),
      empresasPendientesPorCuota: empresasPendientesPorCuota,
      finalizadoPorCuota: finalizadoPorCuota
    };
  } finally {
    liberarLockCobro_(processId);
  }
}

function obtenerHistorialAdmin_(limit) {
  var max = Number(limit || 100);
  if (!isFinite(max) || max < 1) max = 100;
  max = Math.min(500, Math.floor(max));

  var hoja = asegurarLogCobrosAdmin_();
  var lastRow = hoja.getLastRow();
  if (lastRow < 2) return [];

  var count = Math.min(max, lastRow - 1);
  var rows = hoja.getRange(lastRow - count + 1, 1, count, HEADERS_LOG_COBROS_ADMIN.length).getValues();
  var out = [];

  for (var i = rows.length - 1; i >= 0; i--) {
    out.push({
      fecha: rows[i][0] instanceof Date ? rows[i][0].toISOString() : String(rows[i][0] || ""),
      processId: limpiarEspacios_(rows[i][1]),
      empresa: limpiarEspacios_(rows[i][2]),
      facturas: limpiarEspacios_(rows[i][3]),
      saldo: numero_(rows[i][4]),
      diasMora: limpiarEspacios_(rows[i][5]),
      nivel: limpiarEspacios_(rows[i][6]),
      destinatario: normalizarDestinatarios_(rows[i][7]),
      resultado: limpiarEspacios_(rows[i][8]),
      detalle: limpiarEspacios_(rows[i][9])
    });
  }

  return out;
}

function facturasAbiertasDesdeSheet_() {
  asegurarEstructura_();
  var ss = SpreadsheetApp.openById(SHEET_ID_CARTERA);
  var hoja = ss.getSheetByName(HOJA_FACTURAS);
  var data = hoja.getDataRange().getValues();
  var out = [];

  for (var i = 1; i < data.length; i++) {
    var saldo = numero_(data[i][6]);
    var estado = normalizarTexto_(data[i][12]);
    if (saldo <= 0) continue;
    if (estado === "PAGADO" || estado === "ANULADA" || estado === "INCOBRABLE") continue;

    out.push({
      fecha: data[i][0],
      nFactura: data[i][1],
      nit: data[i][2],
      cliente: data[i][3],
      valorTotal: data[i][4],
      valorAbonado: data[i][5],
      saldoPendiente: data[i][6],
      estadoInterno: data[i][12],
      correosFacturacion: data[i][10]
    });
  }

  return out;
}

function vigilarCobrosCentral_() {
  var invoices = facturasAbiertasDesdeSheet_();
  var meta = {
    desde: "",
    hasta: Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd"),
    filtroBiofile: "SHEET",
    source: "trigger_vigilarCobros",
    processId: "scheduler-" + Utilities.getUuid()
  };

  var preview = planificarCobrosDesdeBiofile_(invoices, meta);

  if (getModoPrueba_()) {
    Logger.log(
      "MODO PRUEBA - vigilarCobrosCentral | empresasConEnvio=" +
      preview.summary.empresasConEnvio +
      " | facturasConEnvio=" + preview.summary.facturasConEnvio +
      " | saldoAEnviar=" + preview.summary.saldoAEnviar
    );
    return preview;
  }

  var primerEnvio = PropertiesService.getScriptProperties()
    .getProperty("PRIMER_ENVIO_REAL_CONFIRMADO");

  if (String(primerEnvio || "").toLowerCase() !== "true") {
    Logger.log(
      "ENVÍO AUTOMÁTICO BLOQUEADO: el primer envío real todavía no ha sido confirmado manualmente desde la consola."
    );
    return preview;
  }

  return enviarCobrosDesdeBiofile_(invoices, meta);
}
