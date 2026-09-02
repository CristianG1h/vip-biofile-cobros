import { config } from "./config.js";
import { logger } from "./logger.js";
import { runDaily } from "./jobs/daily.js";
import { runWeekly } from "./jobs/weekly.js";
import { runWeeklyDry } from "./jobs/weekly-dry.js";
import { runFakeTest } from "./jobs/fake.js";
import { runProjectDry } from "./jobs/project-dry.js";
import { runBackfill } from "./jobs/backfill.js";
import {
  previsualizarCobro,
  signatureForPlan,
  enviarCobroConfirmado,
  normalizeDesde,
} from "./jobs/cobro.js";
import { weekdayInZone } from "./utils/date.js";

function argument(name) {
  const prefix = `--${name}=`;
  const item = process.argv.find((x) => x.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}

async function withBiofile(callback) {
  const { createBiofileSession } = await import("./browser.js");
  const session = await createBiofileSession();
  try {
    await session.ensureLogin();
    return await callback(session.page);
  } finally {
    await session.close();
  }
}

async function main() {
  const mode = String(process.argv[2] || "auto").toLowerCase();

  if (mode === "fake") {
    await runFakeTest();
    return;
  }

  if (mode === "dry-biofile") {
    const isoDate = argument("fecha");
    await withBiofile((page) => runDaily(page, { dryRun: true, isoDate }));
    return;
  }

  if (mode === "dry-weekly") {
    const desde = argument("desde");
    const hasta = argument("hasta");
    await withBiofile((page) => runWeeklyDry(page, { desdeISO: desde, hastaISO: hasta }));
    return;
  }

  if (mode === "dry-project" || mode === "dry-project-demo") {
    const desde = argument("desde");
    const hasta = argument("hasta");
    const demoChanges = mode === "dry-project-demo";
    await withBiofile((page) => runProjectDry(page, { desdeISO: desde, hastaISO: hasta, demoChanges }));
    return;
  }

  if (mode === "backfill" || mode === "dry-backfill") {
    const desde = argument("desde");
    const hasta = argument("hasta");
    const dryRun = mode === "dry-backfill";
    await withBiofile((page) => runBackfill(page, { desdeISO: desde, hastaISO: hasta, dryRun }));
    return;
  }

  if (mode === "previsualizar-cobro" || mode === "consultar-cartera") {
    const desde = normalizeDesde(argument("desde") || "2026-01-01");
    await withBiofile(async (page) => {
      const preview = await previsualizarCobro(page, { desdeISO: desde });
      console.log(JSON.stringify(preview.plan, null, 2));
    });
    return;
  }

  if (mode === "iniciar-cobro") {
    const desde = normalizeDesde(argument("desde") || "2026-01-01");
    const real = String(argument("modo") || "").toLowerCase() === "real";
    if (!real) {
      throw new Error('El comando iniciar-cobro exige --modo=real.');
    }

    const { createInterface } = await import("node:readline/promises");
    const { stdin, stdout } = await import("node:process");

    await withBiofile(async (page) => {
      const preview = await previsualizarCobro(page, { desdeISO: desde });
      console.log("\nENVÍO REAL");
      console.log(JSON.stringify(preview.plan.summary, null, 2));
      console.log("\nESTÁ A PUNTO DE INICIAR EL ENVÍO REAL.");

      const rl = createInterface({ input: stdin, output: stdout });
      const answer = await rl.question('Escribe CONFIRMAR para continuar: ');
      rl.close();

      if (String(answer).trim().toUpperCase() !== "CONFIRMAR") {
        console.log("ENVÍO CANCELADO.");
        return;
      }

      const revalidated = await previsualizarCobro(page, { desdeISO: desde });
      if (signatureForPlan(revalidated.plan) !== signatureForPlan(preview.plan)) {
        throw new Error(
          "La cartera cambió desde la previsualización. No se envió nada; vuelve a ejecutar el comando."
        );
      }

      const sent = await enviarCobroConfirmado(revalidated, {
        source: "cli_real",
      });
      console.log(JSON.stringify(sent, null, 2));
    });
    return;
  }

  if (mode === "daily") {
    await withBiofile((page) => runDaily(page));
    return;
  }

  if (mode === "weekly") {
    await withBiofile((page) => runWeekly(page));
    return;
  }

  if (mode !== "auto") {
    throw new Error(`Modo desconocido: ${mode}. Use auto, daily, weekly, backfill, dry-backfill, consultar-cartera, previsualizar-cobro, iniciar-cobro, fake, dry-biofile, dry-weekly, dry-project o dry-project-demo.`);
  }

  await withBiofile(async (page) => {
    await runDaily(page);

    const weekday = weekdayInZone(config.timezone);
    if (weekday === config.weeklyDay) {
      logger.info("Hoy corresponde a la revisión semanal.", { weekday });
      await runWeekly(page);
    } else {
      logger.info("La revisión semanal no corresponde hoy.", {
        weekday,
        configuredWeeklyDay: config.weeklyDay,
      });
    }
  });
}

main()
  .then(() => logger.info("Proceso finalizado correctamente."))
  .catch((error) => {
    logger.error("Proceso finalizado con error.", {
      message: error.message,
      stack: error.stack,
    });
    process.exitCode = 1;
  });
