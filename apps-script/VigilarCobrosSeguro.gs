// ============================================================================
// VIP COBROS - TRIGGER AUTOMATICO SEGURO
// Version 1.0
// ============================================================================
// Objetivo:
// - Reemplazar el uso automatico del antiguo vigilarCobros basado solo en Sheet.
// - Consultar Biofile EN VIVO mediante Render antes de cualquier envio.
// - Reutilizar el flujo seguro ya existente de preparar + confirmar cobro real.
// - Render vuelve a consultar Biofile durante la confirmacion antes de enviar.
//
// IMPORTANTE:
// - NO poner la SERVICE_API_KEY directamente en este archivo.
// - Guardarla en Propiedades del script como RENDER_SERVICE_API_KEY.
// - El primer envio real debe haber sido confirmado manualmente antes de activar
//   este trigger.
// ============================================================================

var RENDER_COBROS_URL_DEFAULT = "https://vip-biofile-cobros.onrender.com";
var COBRO_AUTOMATICO_DESDE = "2026-01-01";

function configuracionRenderCobrosSeguro_() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = String(
    props.getProperty("RENDER_COBROS_URL") || RENDER_COBROS_URL_DEFAULT
  ).trim().replace(/\/+$/, "");

  var apiKey = String(
    props.getProperty("RENDER_SERVICE_API_KEY") ||
    props.getProperty("SERVICE_API_KEY") ||
    ""
  ).trim();

  if (!baseUrl) {
    throw new Error("Falta configurar RENDER_COBROS_URL.");
  }
  if (!apiKey) {
    throw new Error(
      "Falta configurar RENDER_SERVICE_API_KEY en Propiedades del script. " +
      "Debe tener el mismo valor de SERVICE_API_KEY configurado en Render."
    );
  }

  return { baseUrl: baseUrl, apiKey: apiKey };
}

function llamarRenderCobrosSeguro_(path, payload) {
  var cfg = configuracionRenderCobrosSeguro_();
  var response = UrlFetchApp.fetch(cfg.baseUrl + path, {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": cfg.apiKey
    },
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
    followRedirects: true
  });

  var status = response.getResponseCode();
  var text = response.getContentText();
  var data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (parseError) {
    throw new Error(
      "Render devolvio una respuesta no JSON. HTTP " + status + ": " +
      String(text || "").slice(0, 500)
    );
  }

  if (status < 200 || status >= 300 || data.ok === false) {
    throw new Error(
      "Render rechazo la operacion. HTTP " + status + ": " +
      String(data.error || data.message || text || "Error desconocido").slice(0, 700)
    );
  }

  return data;
}

function primerEnvioRealConfirmado_() {
  var value = PropertiesService.getScriptProperties()
    .getProperty("PRIMER_ENVIO_REAL_CONFIRMADO");
  return String(value || "").toLowerCase() === "true";
}

function previsualizarVigilarCobrosSeguro() {
  var command = "previsualizar-cobro --desde=" + COBRO_AUTOMATICO_DESDE;
  var result = llamarRenderCobrosSeguro_("/api/admin/command", {
    command: command
  });

  var summary = result && result.plan ? result.plan.summary : null;
  Logger.log(
    "PREVIEW AUTOMATICO SEGURO | NO SE ENVIARON CORREOS | " +
    JSON.stringify(summary || result)
  );
  console.log(
    "PREVIEW AUTOMATICO SEGURO | NO SE ENVIARON CORREOS | " +
    JSON.stringify(summary || result)
  );

  return result;
}

function vigilarCobrosSeguro() {
  // Barrera 1: Apps Script debe seguir en PRODUCCION.
  if (getModoPrueba_()) {
    Logger.log("COBRO AUTOMATICO BLOQUEADO: MODO PRUEBA esta activo.");
    return {
      ok: false,
      enviado: false,
      motivo: "MODO_PRUEBA"
    };
  }

  // Barrera 2: exige haber realizado primero un envio real manual y controlado.
  if (!primerEnvioRealConfirmado_()) {
    Logger.log(
      "COBRO AUTOMATICO BLOQUEADO: el primer envio real aun no ha sido " +
      "confirmado manualmente desde la consola."
    );
    return {
      ok: false,
      enviado: false,
      motivo: "PRIMER_ENVIO_REAL_NO_CONFIRMADO"
    };
  }

  // Paso 1: Render consulta Biofile EN VIVO con CON DEUDA y prepara el envio.
  var prepareCommand =
    "iniciar-cobro --desde=" + COBRO_AUTOMATICO_DESDE + " --modo=real";

  var prepared = llamarRenderCobrosSeguro_("/api/admin/command", {
    command: prepareCommand
  });

  var confirmationId = String(prepared.confirmationId || "").trim();
  if (!confirmationId) {
    throw new Error(
      "Render no devolvio confirmationId. No se autorizo ningun envio."
    );
  }

  var summary = prepared && prepared.plan ? prepared.plan.summary : {};
  Logger.log(
    "COBRO AUTOMATICO PREPARADO | confirmationId=" + confirmationId +
    " | resumen=" + JSON.stringify(summary || {})
  );

  // Paso 2: confirmar el identificador recien generado.
  // El servidor NO envia inmediatamente con el preview viejo: al recibir esta
  // confirmacion vuelve a entrar a Biofile, consulta CON DEUDA otra vez y
  // compara la firma antes de iniciar los correos.
  var confirmed = llamarRenderCobrosSeguro_("/api/cobro/confirm-real", {
    confirmationId: confirmationId
  });

  Logger.log(
    "COBRO AUTOMATICO ACEPTADO POR RENDER | " + JSON.stringify(confirmed)
  );
  console.log(
    "COBRO AUTOMATICO ACEPTADO POR RENDER | " + JSON.stringify(confirmed)
  );

  return {
    ok: true,
    accepted: true,
    confirmationId: confirmationId,
    preview: summary,
    render: confirmed
  };
}

function crearTriggerVigilarCobrosSeguro() {
  var triggers = ScriptApp.getProjectTriggers();
  var eliminados = 0;

  // Elimina tanto el trigger antiguo como una version previa del seguro para
  // garantizar que nunca queden dos procesos de cobro programados en paralelo.
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === "vigilarCobros" || handler === "vigilarCobrosSeguro") {
      ScriptApp.deleteTrigger(triggers[i]);
      eliminados++;
    }
  }

  var trigger = ScriptApp.newTrigger("vigilarCobrosSeguro")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  Logger.log(
    "TRIGGER SEGURO CREADO | funcion=vigilarCobrosSeguro | hora~08:00 | " +
    "timezone=America/Bogota | triggersAnterioresEliminados=" + eliminados +
    " | id=" + trigger.getUniqueId()
  );

  return {
    ok: true,
    funcion: "vigilarCobrosSeguro",
    horaAproximada: "08:00",
    timezoneEsperada: "America/Bogota",
    triggersAnterioresEliminados: eliminados,
    triggerId: trigger.getUniqueId()
  };
}

function estadoVigilarCobrosSeguro() {
  var props = PropertiesService.getScriptProperties();
  var triggers = ScriptApp.getProjectTriggers();
  var encontrados = [];

  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === "vigilarCobros" || handler === "vigilarCobrosSeguro") {
      encontrados.push(handler);
    }
  }

  var result = {
    modoProduccion: !getModoPrueba_(),
    primerEnvioRealConfirmado: primerEnvioRealConfirmado_(),
    renderUrlConfigurada: Boolean(
      String(props.getProperty("RENDER_COBROS_URL") || RENDER_COBROS_URL_DEFAULT).trim()
    ),
    renderApiKeyConfigurada: Boolean(
      String(
        props.getProperty("RENDER_SERVICE_API_KEY") ||
        props.getProperty("SERVICE_API_KEY") ||
        ""
      ).trim()
    ),
    triggersCobro: encontrados
  };

  Logger.log("ESTADO VIGILAR COBROS SEGURO | " + JSON.stringify(result));
  console.log("ESTADO VIGILAR COBROS SEGURO | " + JSON.stringify(result));
  return result;
}
