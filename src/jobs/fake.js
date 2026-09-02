import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { planSync } from "../domain/sync-plan.js";
import { normalizeInvoice } from "../domain/invoice.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../fixtures/facturas-prueba.json");

export async function runFakeTest() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const current = fixture.existing.map(normalizeInvoice);

  console.log("\n=== PRUEBA FALSA / SEGURA ===");
  console.log("No entra a Biofile, no toca Google Sheets y no envía correos.\n");

  for (const step of fixture.steps) {
    const plan = planSync(current, step.biofile);
    console.log(`--- ${step.name} ---`);
    console.log(`Nuevas: ${plan.inserts.length}`);
    console.log(`Actualizadas: ${plan.updates.length}`);
    console.log(`Sin cambios: ${plan.unchanged.length}`);

    for (const insert of plan.inserts) {
      console.log(`INSERT ${insert.nFactura} -> ${insert.estadoInterno} | saldo $${insert.saldoPendiente}`);
      current.push(insert);
    }

    for (const update of plan.updates) {
      console.log(
        `UPDATE ${update.after.nFactura}: ${update.before.estadoInterno} -> ${update.after.estadoInterno}` +
        ` | abono ${update.before.valorAbonado} -> ${update.after.valorAbonado}` +
        ` | saldo ${update.before.saldoPendiente} -> ${update.after.saldoPendiente}`
      );
      const index = current.findIndex((x) => x.nFactura === update.after.nFactura);
      current[index] = update.after;
    }
    console.log();
  }

  console.log("Estado final simulado:");
  console.table(
    current.map((x) => ({
      Factura: x.nFactura,
      EstadoBiofile: x.estadoBiofile,
      EstadoInterno: x.estadoInterno,
      Abono: x.valorAbonado,
      Saldo: x.saldoPendiente,
    }))
  );

  return current;
}
