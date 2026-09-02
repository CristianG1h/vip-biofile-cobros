import test from "node:test";
import assert from "node:assert/strict";

import {
  COBRO_ESTADO,
  defaultCobroDesde,
  normalizeDesde,
  signatureForPlan,
} from "../src/jobs/cobro.js";
import { redactForLog } from "../src/logger.js";
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
