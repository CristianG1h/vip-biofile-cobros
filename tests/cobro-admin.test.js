import test from "node:test";
import assert from "node:assert/strict";

import {
  COBRO_ESTADO,
  defaultCobroDesde,
  normalizeDesde,
  signatureForPlan,
} from "../src/jobs/cobro.js";
import { redactForLog } from "../src/logger.js";
import { renderAdminConsole } from "../src/admin-console.js";
import { todayISO } from "../src/utils/date.js";

test("la automatización de cobro usa exclusivamente CON DEUDA", () => {
  assert.equal(COBRO_ESTADO, "CON DEUDA");
});

test("la fecha inicial por defecto es 01/01/2026", () => {
  assert.equal(defaultCobroDesde(), "2026-01-01");
  assert.equal(normalizeDesde("2026-01-01"), "2026-01-01");
  assert.throws(() => normalizeDesde("01/01/2026"), /YYYY-MM-DD/);
});

test("la fecha actual se calcula en America/Bogota", () => {
  assert.match(todayISO("America/Bogota"), /^\d{4}-\d{2}-\d{2}$/);
});

test("la firma de confirmación cambia si cambia la cartera", () => {
  const a = {
    summary: { empresasConEnvio: 1, facturasConEnvio: 1, saldoAEnviar: 100 },
    groups: [{
      key: "1",
      cliente: "EMPRESA",
      correo: "a@b.com",
      accion: "SE_ENVIARIA_CORREO",
      nivel: 2,
      saldo: 100,
      facturas: [{ nFactura: "FE-1", saldo: 100, diasMora: 9, nivel: 2, accion: "SE_ENVIARIA_CORREO" }],
    }],
  };
  const b = structuredClone(a);
  b.groups[0].facturas[0].saldo = 90;
  assert.notEqual(signatureForPlan(a), signatureForPlan(b));
});

test("los secretos se enmascaran en logs", () => {
  const safe = redactForLog({
    usuario: "CRISTIAN",
    BIOFILE_CONTRASENA: "secreto",
    APPS_SCRIPT_TOKEN: "token",
    SERVICE_API_KEY: "key",
    nested: { authorization: "Bearer abc", ok: 123 },
  });
  assert.equal(safe.usuario, "CRISTIAN");
  assert.equal(safe.BIOFILE_CONTRASENA, "[REDACTED]");
  assert.equal(safe.APPS_SCRIPT_TOKEN, "[REDACTED]");
  assert.equal(safe.SERVICE_API_KEY, "[REDACTED]");
  assert.equal(safe.nested.authorization, "[REDACTED]");
  assert.equal(safe.nested.ok, 123);
});


import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Biofile selecciona Estado antes de Buscar y no usa fallback en cobro", () => {
  const source = fs.readFileSync(path.join(root, "src", "biofile", "estado-cuentas.js"), "utf8");
  const selected = source.indexOf("await selectEstadoExacto(page, estado)");
  const searched = source.indexOf("await clickSearch(page)", selected);
  assert.ok(selected >= 0, "Debe seleccionar Estado exacto");
  assert.ok(searched > selected, "Buscar debe ocurrir después de seleccionar Estado");
  assert.equal(source.includes("selectTodas(page)"), false);
});

test("preview de Apps Script no contiene ningún envío de correo", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  const start = source.indexOf("function planificarCobrosDesdeBiofile_");
  const end = source.indexOf("function cuerpoGrupoCobro_", start);
  assert.ok(start >= 0 && end > start);
  const previewSection = source.slice(start, end);
  assert.equal(previewSection.includes(".sendEmail("), false);
});

test("el envío real tiene lock y registra historial después del envío", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  assert.ok(source.includes("COBRO_REAL_EN_EJECUCION"));
  const sendStart = source.indexOf("MailApp.sendEmail(");
  const historyAfter = source.indexOf("registrarHistorial_(", sendStart);
  assert.ok(sendStart >= 0);
  assert.ok(historyAfter > sendStart, "El historial debe guardarse después del sendEmail exitoso");
});

test("la consola no expone una terminal de sistema", () => {
  const source = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
  assert.ok(source.includes("Comando no permitido. Esta consola no ejecuta comandos del sistema."));
  assert.equal(source.includes("child_process"), false);
  assert.equal(source.includes("exec("), false);
  assert.equal(source.includes("spawn("), false);
});

test("el envío real requiere segunda confirmación", () => {
  const source = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
  assert.ok(source.includes("prepareReal(desde)"));
  assert.ok(source.includes("/api/cobro/confirm-real"));
  assert.ok(source.includes("confirmationId"));
  assert.ok(source.includes("La cartera cambió desde la previsualización"));
});


test("la raíz y /health aceptan HEAD para UptimeRobot", () => {
  const source = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
  assert.ok(source.includes('req.method === "HEAD"') && source.includes('url.pathname === "/"'));
  assert.ok(source.includes('url.pathname === "/health"'));
});


test("la consola renderizada contiene JavaScript válido", () => {
  const html = renderAdminConsole();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "Debe existir script embebido");
  assert.doesNotThrow(() => new Function(match[1]));
});


test("los niveles se mantienen durante todo el rango", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosVIP.gs"), "utf8");
  const start = source.indexOf("function calcularNivel(");
  const end = source.indexOf("\nfunction ", start + 10);
  assert.ok(start >= 0 && end > start);
  const calcularNivel = new Function(
    'function normalizarTexto_(v){return String(v||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toUpperCase().trim();}' +
    source.slice(start, end) +
    "; return calcularNivel;"
  )();

  // Categoría B: regla solicitada por el usuario.
  assert.equal(calcularNivel("B", -8), null);
  assert.equal(calcularNivel("B", -5), 1);
  assert.equal(calcularNivel("B", -1), 1);
  assert.equal(calcularNivel("B", 0), 2);
  assert.equal(calcularNivel("B", 8), 2);
  assert.equal(calcularNivel("B", 9), 3);
  assert.equal(calcularNivel("B", 17), 3);
  assert.equal(calcularNivel("B", 18), 4);
  assert.equal(calcularNivel("B", 24), 4);
  assert.equal(calcularNivel("B", 27), 4);
  assert.equal(calcularNivel("B", 28), 5);
  assert.equal(calcularNivel("B", 36), 5);
  assert.equal(calcularNivel("B", 55), 8);

  // A y C también permanecen por rangos.
  assert.equal(calcularNivel("A", 10), 1);
  assert.equal(calcularNivel("A", 18), 1);
  assert.equal(calcularNivel("A", 19), 2);
  assert.equal(calcularNivel("C", 0), 3);
  assert.equal(calcularNivel("C", 8), 3);
  assert.equal(calcularNivel("C", 9), 4);
});

test("el preview conserva el correo aunque hoy no corresponda envío", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  const groupIndex = source.indexOf("g.correo = unionCorreos_([g.correo, f.correo]);");
  const sendIndex = source.indexOf('if (f.accion === "SE_ENVIARIA_CORREO")', groupIndex);
  assert.ok(groupIndex >= 0);
  assert.ok(sendIndex > groupIndex, "El correo debe agregarse antes de decidir si hoy se envía");
});

test("la consola muestra vencimiento futuro sin mora negativa", () => {
  const html = renderAdminConsole();
  assert.ok(html.includes('if(n<0) return "vence en "+Math.abs(n)+" días"'));
});


test("el gestor de cuota consulta la cuota real y conserva reserva", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  assert.ok(source.includes("MailApp.getRemainingDailyQuota()"));
  assert.ok(source.includes('"COBRO_RESERVA_CUOTA"'));
  assert.ok(source.includes("PENDIENTE_POR_CUOTA"));
  assert.ok(source.includes("destinatariosConsumidos"));
});

test("las empresas se priorizan por nivel y luego por mora", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  assert.ok(source.includes("return nivelB - nivelA"));
  assert.ok(source.includes("return moraB - moraA"));
});

test("un correo agrupado usa el nivel más alto de sus facturas", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  assert.ok(source.includes("Math.max(g.nivel, f.nivel)"));
  assert.ok(source.includes("var nivelMaximo = group.nivel || 1"));
  assert.ok(source.includes("textoSegunNivel_(nivelMaximo)"));
});

test("la cuota cuenta destinatarios únicos incluyendo CC", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  assert.ok(source.includes("var todos = extraerCorreos_([to, cc].join"));
  assert.ok(source.includes("cantidad: todos.length"));
});


test("la firma ignora cambios de cuota pero detecta cambios reales de cartera", () => {
  const base = {
    summary: {
      filtroBiofile: "CON DEUDA",
      desde: "2026-01-01",
      hasta: "2026-09-02",
      cuotaRestanteGmail: 100,
      reservaCuota: 10,
      cuotaOperativa: 90,
      destinatariosPlaneados: 120
    },
    groups: [{
      key: "900123456",
      cliente: "EMPRESA SAS",
      correo: "facturacion@empresa.com",
      accion: "SE_ENVIARIA_CORREO",
      nivel: 5,
      saldo: 500000,
      facturas: [{
        nFactura: "FE-1000",
        saldo: 500000,
        diasMora: 30,
        nivel: 5,
        accion: "SE_ENVIARIA_CORREO"
      }]
    }]
  };

  const cuotaCambio = structuredClone(base);
  cuotaCambio.summary.cuotaRestanteGmail = 87;
  cuotaCambio.summary.cuotaOperativa = 77;

  const saldoCambio = structuredClone(base);
  saldoCambio.groups[0].facturas[0].saldo = 400000;

  assert.equal(signatureForPlan(base), signatureForPlan(cuotaCambio));
  assert.notEqual(signatureForPlan(base), signatureForPlan(saldoCambio));
});
