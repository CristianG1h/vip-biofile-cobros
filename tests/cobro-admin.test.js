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

test("preview de Apps Script no contiene envío de Gmail", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  const start = source.indexOf("function planificarCobrosDesdeBiofile_");
  const end = source.indexOf("function cuerpoGrupoCobro_", start);
  assert.ok(start >= 0 && end > start);
  const previewSection = source.slice(start, end);
  assert.equal(previewSection.includes("GmailApp.sendEmail"), false);
});

test("el envío real tiene lock y registra historial después del envío", () => {
  const source = fs.readFileSync(path.join(root, "apps-script", "CobrosAdmin.gs"), "utf8");
  assert.ok(source.includes("COBRO_REAL_EN_EJECUCION"));
  const sendStart = source.indexOf("GmailApp.sendEmail(");
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
