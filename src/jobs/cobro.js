import crypto from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { queryEstadoCuentas } from "../biofile/estado-cuentas.js";
import { dedupeInvoices } from "../domain/invoice.js";
import { isoToBiofile, monthRanges, todayISO } from "../utils/date.js";
import {
  planCobrosInAppsScript,
  sendCobrosInAppsScript,
} from "../apps-script-client.js";

export const COBRO_ESTADO = "CON DEUDA";

export function defaultCobroDesde() {
  return "2026-01-01";
}

export function normalizeDesde(value) {
  const desde = String(value || defaultCobroDesde()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    throw new Error(`Fecha desde inválida: ${desde}. Use YYYY-MM-DD.`);
  }
  return desde;
}

export async function consultarCarteraBiofile(page, { desdeISO = "", hastaISO = "" } = {}) {
  const desde = normalizeDesde(desdeISO);
  const hasta = String(hastaISO || todayISO(config.timezone)).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw new Error(`Fecha hasta inválida: ${hasta}. Use YYYY-MM-DD.`);
  }

  const ranges = monthRanges(desde, hasta);
  if (!ranges.length) {
    throw new Error(`Rango inválido para cartera: ${desde} -> ${hasta}`);
  }

  const collected = [];
  logger.info("Iniciando consulta de cartera en Biofile.", {
    desde,
    hasta,
    estado: COBRO_ESTADO,
    pageSize: 1000,
  });

  for (const range of ranges) {
    logger.info("Consultando tramo de cartera en Biofile.", range);
    const rows = await queryEstadoCuentas(page, {
      desde: isoToBiofile(range.startISO),
      hasta: isoToBiofile(range.endISO),
      daily: false,
      pageSize: 1000,
      estado: COBRO_ESTADO,
    });

    collected.push(...rows.filter((row) => Number(row.saldoPendiente || 0) > 0));
  }

  const invoices = dedupeInvoices(collected).filter(
    (invoice) => Number(invoice.saldoPendiente || 0) > 0
  );

  logger.info("Consulta de cartera Biofile completada.", {
    facturasConSaldo: invoices.length,
    desde,
    hasta,
    estado: COBRO_ESTADO,
  });

  return { desde, hasta, invoices };
}

export async function previsualizarCobro(page, { desdeISO = "", hastaISO = "" } = {}) {
  const consulta = await consultarCarteraBiofile(page, { desdeISO, hastaISO });
  const plan = await planCobrosInAppsScript(consulta.invoices, {
    desde: consulta.desde,
    hasta: consulta.hasta,
    filtroBiofile: COBRO_ESTADO,
    source: "admin_console_preview",
  });

  return {
    ...consulta,
    plan,
  };
}

export async function ejecutarCobroReal(
  page,
  { desdeISO = "", hastaISO = "", processId = "" } = {}
) {
  const consulta = await consultarCarteraBiofile(page, { desdeISO, hastaISO });
  const id = processId || crypto.randomUUID();

  const result = await sendCobrosInAppsScript(consulta.invoices, {
    desde: consulta.desde,
    hasta: consulta.hasta,
    filtroBiofile: COBRO_ESTADO,
    source: "admin_console_real",
    processId: id,
  });

  return {
    ...consulta,
    processId: id,
    result,
  };
}

export function signatureForPlan(plan) {
  const stable = {
    summary: plan?.summary || {},
    groups: Array.isArray(plan?.groups)
      ? plan.groups.map((group) => ({
          key: group.key,
          cliente: group.cliente,
          correo: group.correo,
          accion: group.accion,
          nivel: group.nivel,
          saldo: group.saldo,
          invoices: Array.isArray(group.facturas)
            ? group.facturas.map((invoice) => ({
                nFactura: invoice.nFactura,
                saldo: invoice.saldo,
                diasMora: invoice.diasMora,
                nivel: invoice.nivel,
                accion: invoice.accion,
              }))
            : [],
        }))
      : [],
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable))
    .digest("hex");
}

export async function enviarCobroConfirmado(
  consulta,
  { processId = "", source = "admin_console_real" } = {}
) {
  const id = processId || crypto.randomUUID();
  const result = await sendCobrosInAppsScript(consulta.invoices || [], {
    desde: consulta.desde,
    hasta: consulta.hasta,
    filtroBiofile: COBRO_ESTADO,
    source,
    processId: id,
  });

  return {
    processId: id,
    result,
  };
}
