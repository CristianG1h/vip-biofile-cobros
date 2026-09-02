import { logger } from "../logger.js";
import { dedupeInvoices } from "../domain/invoice.js";
import { parseEstadoCuentaRows } from "./estado-cuentas-parser.js";

const SELECTORS = {
  desde: "#TxtDesde",
  hasta: "#TxtHasta",
  estado: "#CbEstado",
  buscar: "#B_BH_BtnBuscar",
  grid: "#DivEstadoCuentas",
};

async function fillIfDifferent(page, selector, value) {
  const input = page.locator(selector).first();
  await input.waitFor({ state: "visible" });
  const current = String((await input.inputValue()) || "").trim();
  if (current === String(value).trim()) return false;
  await input.fill(String(value));
  await input.press("Tab").catch(() => {});
  return true;
}

async function selectTodas(page) {
  const select = page.locator(SELECTORS.estado).first();
  await select.waitFor({ state: "visible" });
  const current = await select.locator("option:checked").textContent().catch(() => "");
  if (String(current || "").trim().toUpperCase() === "TODAS") return false;

  const options = await select.locator("option").allTextContents();
  const index = options.findIndex((x) => String(x).trim().toUpperCase() === "TODAS");
  if (index < 0) throw new Error('Biofile no mostró la opción "TODAS" en Estado.');
  await select.selectOption({ index });
  return true;
}

async function clickSearch(page) {
  const button = page.locator(SELECTORS.buscar).first();
  await button.waitFor({ state: "visible" });
  await button.click();
  await page.locator(SELECTORS.grid).first().waitFor({ state: "attached" });
  await waitForGridResult(page);
  await page.waitForTimeout(300);
}

async function pageSizeSelect(page) {
  const selects = page.locator("select");
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const labels = (await select.locator("option").allTextContents()).map((x) => String(x).trim());
    if (["50", "100", "500", "1000"].every((v) => labels.includes(v))) return select;
  }
  return null;
}

async function setPageSize(page, size) {
  const select = await pageSizeSelect(page);
  if (!select) {
    logger.warn("No se encontró el selector de cantidad de registros.");
    return false;
  }

  const currentText = String((await select.locator("option:checked").textContent()) || "").trim();
  if (currentText === String(size)) return false;
  await select.selectOption({ label: String(size) });
  // Biofile usa postbacks/actualizaciones asíncronas. Damos tiempo a que
  // el grid termine de reconstruirse antes de leerlo.
  await page.waitForTimeout(900);
  await waitForGridResult(page);
  await page.waitForTimeout(300);
  return true;
}

async function waitForGridResult(page) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector("#DivEstadoCuentas");
      if (!root) return false;

      const dataCells = root.querySelectorAll("table tr td").length;
      if (dataCells > 0) return true;

      // Biofile también puede devolver una búsqueda válida con cero registros.
      const bodyText = String(document.body?.innerText || "");
      return /registros,\s*de un total de\s*0\b/i.test(bodyText) || /total de\s*0\b/i.test(bodyText);
    },
    null,
    { timeout: 15000 }
  ).catch(() => {});
}

async function readGrid(page) {
  const snapshot = await page.locator(SELECTORS.grid).evaluate((root) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const norm = (value) =>
      clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();

    // En Biofile el encabezado azul NO está dentro de #DivEstadoCuentas.
    // El div contiene principalmente las filas de datos. Por eso buscamos
    // el encabezado en toda la página y las filas dentro del div.
    const allRows = [...document.querySelectorAll("table tr")];
    const headerRow = allRows.find((tr) => {
      const text = norm(tr.innerText);
      return (
        text.includes("FACTURA") &&
        text.includes("NOMBRE DEL CLIENTE") &&
        text.includes("VR. TOTAL") &&
        text.includes("VR. SALDO")
      );
    });

    const headers = headerRow
      ? [...headerRow.querySelectorAll("th,td")].map((cell) => clean(cell.innerText))
      : [];

    const gridTables = [...root.querySelectorAll("table")];
    const cellRows = [];

    for (const table of gridTables) {
      for (const tr of table.querySelectorAll("tr")) {
        // Biofile incluye TD ocultos (por ejemplo NIT/campos internos) que NO
        // corresponden a las columnas visibles del encabezado azul. Si los
        // contamos, todas las columnas se corren y un APROBADA puede terminar
        // interpretado como otra cosa. Solo leemos celdas realmente visibles.
        const cells = [...tr.querySelectorAll(":scope > td")]
          .filter((cell) => {
            const style = window.getComputedStyle(cell);
            const hiddenByClass = cell.classList.contains("Invisible") || cell.closest(".Invisible");
            return !hiddenByClass && style.display !== "none" && style.visibility !== "hidden";
          })
          .map((cell) => clean(cell.innerText));
        if (cells.length >= 10) cellRows.push(cells);
      }
    }

    return {
      headers,
      cellRows,
      tableCount: gridTables.length,
      candidateRowCount: cellRows.length,
      gridText: clean(root.innerText).slice(0, 500),
    };
  });

  const invoices = parseEstadoCuentaRows(snapshot.cellRows, snapshot.headers);

  if (!invoices.length) {
    logger.warn("Biofile mostró Estado de Cuentas, pero no se pudieron convertir filas válidas.", {
      tableCount: snapshot.tableCount,
      candidateRowCount: snapshot.candidateRowCount,
      headers: snapshot.headers,
      gridText: snapshot.gridText,
    });
  } else {
    logger.info("Filas de Biofile interpretadas correctamente.", {
      candidateRows: snapshot.candidateRowCount,
      validInvoices: invoices.length,
      headersDetected: snapshot.headers.length > 0,
    });
  }

  return invoices;
}

async function totalPages(page) {
  const text = await page.locator("body").innerText();
  const match = text.match(/Página\s*N[°º]?\s*\d+\s*de\s*(\d+)/i);
  return match ? Math.max(1, Number(match[1])) : 1;
}

async function pageNumberSelect(page) {
  const selects = page.locator("select");
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const parentText = await select.locator("xpath=..").innerText().catch(() => "");
    if (/Página/i.test(parentText)) return select;
  }
  return null;
}

async function goToPage(page, number) {
  const select = await pageNumberSelect(page);
  if (!select) return false;
  const labels = (await select.locator("option").allTextContents()).map((x) => String(x).trim());
  if (!labels.includes(String(number))) return false;
  await select.selectOption({ label: String(number) });
  await waitForGridResult(page);
  await page.waitForTimeout(300);
  return true;
}

export async function queryEstadoCuentas(page, options) {
  const {
    desde,
    hasta,
    pageSize = null,
    daily = false,
  } = options;

  await page.locator(SELECTORS.estado).first().waitFor({ state: "visible" });

  // Para la consulta diaria, Biofile normalmente ya trae hoy por defecto.
  // Solo se corrige si por algún motivo no coincide.
  const changedDesde = await fillIfDifferent(page, SELECTORS.desde, desde);
  const changedHasta = await fillIfDifferent(page, SELECTORS.hasta, hasta);
  const changedEstado = await selectTodas(page);

  logger.info("Parámetros Biofile listos.", {
    desde,
    hasta,
    estado: "TODAS",
    resolucion: "sin modificar",
    daily,
    changedDesde,
    changedHasta,
    changedEstado,
  });

  // El usuario indicó que después de cambiar fecha o Estado hay que pulsar Buscar.
  await clickSearch(page);

  // Diario: no tocamos 50. Semanal/histórico: 1000.
  if (pageSize) await setPageSize(page, pageSize);

  let invoices = await readGrid(page);
  const pages = await totalPages(page);

  for (let current = 2; current <= pages; current++) {
    const moved = await goToPage(page, current);
    if (!moved) {
      logger.warn("No se pudo avanzar de página en Biofile.", { current, pages });
      break;
    }
    invoices.push(...(await readGrid(page)));
  }

  const deduped = dedupeInvoices(invoices);
  logger.info("Lectura de Estado de Cuentas completada.", {
    rows: invoices.length,
    uniqueInvoices: deduped.length,
    pages,
  });
  return deduped;
}
