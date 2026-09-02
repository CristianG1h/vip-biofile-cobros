import { config } from "../config.js";
import { logger } from "../logger.js";
import { queryEstadoCuentas } from "../biofile/estado-cuentas.js";
import { dedupeInvoices, normalizeInvoice } from "../domain/invoice.js";
import { planSync } from "../domain/sync-plan.js";
import { isoToBiofile, minusDaysISO, monthRanges, todayISO } from "../utils/date.js";

function validarISO(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${label} debe tener formato AAAA-MM-DD. Ejemplo: 2026-08-26`);
  }
  return value;
}

function utcDate(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Fecha ISO inválida: ${iso}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

function diasEntre(desdeISO, hastaISO) {
  const start = utcDate(desdeISO);
  const end = utcDate(hastaISO);
  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(toISO(cursor));
  }
  return days;
}

function clone(invoice) {
  return normalizeInvoice(JSON.parse(JSON.stringify(invoice)));
}

export function baseDemoPendiente(invoice) {
  const current = clone(invoice);
  if (!["Pagado", "Pago parcial", "Anulada"].includes(current.estadoInterno)) return current;

  return normalizeInvoice({
    ...current,
    estadoBiofile: "APROBADA",
    valorAbonado: 0,
    saldoPendiente: current.valorTotal,
  });
}

export function diferencias(before, after) {
  const changes = [];
  const fields = [
    ["Estado", before.estadoInterno, after.estadoInterno],
    ["Estado Biofile", before.estadoBiofile, after.estadoBiofile],
    ["Abono", before.valorAbonado, after.valorAbonado],
    ["Saldo", before.saldoPendiente, after.saldoPendiente],
    ["Total", before.valorTotal, after.valorTotal],
    ["Cliente", before.cliente, after.cliente],
  ];
  for (const [field, a, b] of fields) {
    if (String(a) !== String(b)) changes.push(`${field}: ${a} -> ${b}`);
  }
  return changes;
}

async function consultarDia(page, iso) {
  const biofileDate = isoToBiofile(iso);
  return queryEstadoCuentas(page, {
    desde: biofileDate,
    hasta: biofileDate,
    daily: true,
    pageSize: null,
  });
}

async function consultarRangoSemanal(page, desde, hasta) {
  const collected = [];
  for (const range of monthRanges(desde, hasta)) {
    logger.info("PRUEBA PROYECTO: consulta final semanal en Biofile.", range);
    const rows = await queryEstadoCuentas(page, {
      desde: isoToBiofile(range.startISO),
      hasta: isoToBiofile(range.endISO),
      daily: false,
      pageSize: 1000,
    });
    collected.push(...rows);
  }
  return dedupeInvoices(collected);
}

/**
 * Prueba integral del proyecto SIN Google Sheets y SIN correos.
 *
 * Fase 1: reproduce cada día del rango como si el cron diario hubiera corrido.
 * Fase 2: construye una cartera virtual en memoria por N° Factura.
 * Fase 3: vuelve a consultar el rango completo como revisión semanal.
 * Fase 4: informa qué sería INSERT / UPDATE / SIN CAMBIO.
 *
 * demoChanges=true permite demostrar ahora mismo los UPDATE usando datos reales
 * actuales de Biofile pero una línea base artificial claramente marcada como DEMO.
 * No afirma que esos fueran los estados históricos reales.
 */
export async function runProjectDry(
  page,
  { desdeISO = "", hastaISO = "", demoChanges = false } = {}
) {
  const today = todayISO(config.timezone);
  const hasta = hastaISO ? validarISO(hastaISO, "--hasta") : today;
  const desde = desdeISO ? validarISO(desdeISO, "--desde") : minusDaysISO(hasta, 6);

  if (desde > hasta) {
    throw new Error(`La fecha desde (${desde}) no puede ser posterior a hasta (${hasta}).`);
  }

  const days = diasEntre(desde, hasta);
  if (days.length > 31) {
    throw new Error("La prueba integral permite máximo 31 días para no cargar innecesariamente Biofile.");
  }

  logger.info("PRUEBA INTEGRAL DEL PROYECTO: SOLO LECTURA.", {
    desde,
    hasta,
    dias: days.length,
    demoChanges,
    googleSheets: "NO",
    appsScript: "NO",
    correos: "NO",
  });

  const virtual = new Map();
  const dailyResults = [];

  // ----------------------------------------------------------
  // FASE 1: como si hubiera corrido el bot cada día a las 6 pm.
  // ----------------------------------------------------------
  for (const day of days) {
    logger.info("PRUEBA PROYECTO: ejecutando cierre diario virtual.", { fecha: day });
    const invoices = await consultarDia(page, day);
    const actions = [];

    for (const invoice of invoices) {
      const current = virtual.get(invoice.nFactura);
      if (!current) {
        virtual.set(invoice.nFactura, clone(invoice));
        actions.push({
          Factura: invoice.nFactura,
          Accion: "INSERTAR",
          Estado: invoice.estadoInterno,
          Abono: invoice.valorAbonado,
          Saldo: invoice.saldoPendiente,
        });
      } else {
        const plan = planSync([current], [invoice]);
        if (plan.updates.length) {
          virtual.set(invoice.nFactura, clone(invoice));
          actions.push({
            Factura: invoice.nFactura,
            Accion: "ACTUALIZAR",
            Estado: invoice.estadoInterno,
            Abono: invoice.valorAbonado,
            Saldo: invoice.saldoPendiente,
          });
        } else {
          actions.push({
            Factura: invoice.nFactura,
            Accion: "SIN CAMBIO",
            Estado: invoice.estadoInterno,
            Abono: invoice.valorAbonado,
            Saldo: invoice.saldoPendiente,
          });
        }
      }
    }

    dailyResults.push({ day, invoices: invoices.length, actions });
    logger.info("Cierre diario virtual completado.", {
      fecha: day,
      encontradas: invoices.length,
      carteraVirtual: virtual.size,
    });
    if (actions.length) console.table(actions);
  }

  // ----------------------------------------------------------
  // DEMO opcional: convierte temporalmente facturas que HOY
  // aparecen pagadas/parciales/anuladas en una base Pendiente.
  // Así se demuestra el UPDATE semanal sin esperar una semana real.
  // ----------------------------------------------------------
  const demoModified = [];
  if (demoChanges) {
    for (const [number, invoice] of virtual.entries()) {
      const demoBase = baseDemoPendiente(invoice);
      if (
        demoBase.estadoInterno !== invoice.estadoInterno ||
        demoBase.valorAbonado !== invoice.valorAbonado ||
        demoBase.saldoPendiente !== invoice.saldoPendiente
      ) {
        virtual.set(number, demoBase);
        demoModified.push({
          Factura: number,
          BaseDemo: `${demoBase.estadoInterno} / abono ${demoBase.valorAbonado} / saldo ${demoBase.saldoPendiente}`,
          BiofileActual: `${invoice.estadoInterno} / abono ${invoice.valorAbonado} / saldo ${invoice.saldoPendiente}`,
        });
      }
    }

    logger.warn(
      "MODO DEMO DE CAMBIOS ACTIVADO: la línea base fue alterada SOLO EN MEMORIA para demostrar qué actualizaría el semanal. No representa el estado histórico real de esas facturas.",
      { facturasDemo: demoModified.length }
    );
    if (demoModified.length) console.table(demoModified);
  }

  // ----------------------------------------------------------
  // FASE 2: revisión semanal real de Biofile.
  // ----------------------------------------------------------
  const weeklyInvoices = await consultarRangoSemanal(page, desde, hasta);
  const virtualBeforeWeekly = [...virtual.values()];
  const weeklyPlan = planSync(virtualBeforeWeekly, weeklyInvoices);

  const updateRows = weeklyPlan.updates.map(({ before, after }) => ({
    Factura: after.nFactura,
    Accion: "ACTUALIZAR",
    Antes: `${before.estadoInterno} | abono ${before.valorAbonado} | saldo ${before.saldoPendiente}`,
    Despues: `${after.estadoInterno} | abono ${after.valorAbonado} | saldo ${after.saldoPendiente}`,
    Cambios: diferencias(before, after).join("; "),
  }));

  const insertRows = weeklyPlan.inserts.map((invoice) => ({
    Factura: invoice.nFactura,
    Accion: "INSERTAR (no apareció en cierres diarios)",
    Despues: `${invoice.estadoInterno} | abono ${invoice.valorAbonado} | saldo ${invoice.saldoPendiente}`,
  }));

  const unchangedRows = weeklyPlan.unchanged.map((invoice) => ({
    Factura: invoice.nFactura,
    Accion: "SIN CAMBIO",
    Estado: invoice.estadoInterno,
    Abono: invoice.valorAbonado,
    Saldo: invoice.saldoPendiente,
  }));

  logger.info("RESULTADO FINAL DE LA PRUEBA INTEGRAL.", {
    diasProcesados: days.length,
    facturasEnCarteraVirtual: virtual.size,
    facturasReleidasSemanal: weeklyInvoices.length,
    insertar: insertRows.length,
    actualizar: updateRows.length,
    sinCambio: unchangedRows.length,
    demoChanges,
  });

  if (updateRows.length) {
    console.log("\n=== FACTURAS QUE EL PROYECTO MODIFICARÍA EN LA REVISIÓN SEMANAL ===");
    console.table(updateRows);
  }

  if (insertRows.length) {
    console.log("\n=== FACTURAS QUE EL SEMANAL RECUPERARÍA PORQUE NO APARECIERON EN EL DIARIO ===");
    console.table(insertRows);
  }

  console.log("\n=== FACTURAS SIN CAMBIO (muestra máxima 20) ===");
  console.table(unchangedRows.slice(0, 20));

  logger.info("PRUEBA INTEGRAL COMPLETADA: no se realizó ninguna escritura ni envío.");

  return {
    dryRun: true,
    desde,
    hasta,
    dailyResults,
    demoChanges,
    demoModified,
    weekly: {
      queried: weeklyInvoices.length,
      inserts: insertRows,
      updates: updateRows,
      unchanged: unchangedRows,
    },
  };
}
