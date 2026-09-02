import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "./config.js";
import { logger } from "./logger.js";

async function isVisible(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export async function createBiofileSession() {
  const creds = config.requireBiofileCredentials();
  ensureDir(config.browser.authPath);

  const launchOptions = {
    headless: config.browser.headless,
    args: config.browser.args,
  };
  if (config.browser.executablePath) launchOptions.executablePath = config.browser.executablePath;

  const browser = await chromium.launch(launchOptions);
  const contextOptions = {
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
  };
  if (fs.existsSync(config.browser.authPath)) {
    contextOptions.storageState = config.browser.authPath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(config.browser.timeout);
  page.on("dialog", async (dialog) => {
    logger.warn("Biofile mostró un diálogo del navegador.", {
      type: dialog.type(),
      message: dialog.message(),
    });
    await dialog.accept().catch(() => {});
  });

  async function isLoginPage() {
    return (
      /IniciarSesion/i.test(page.url()) ||
      (await isVisible(page.locator('input[type="password"]:visible')))
    );
  }

  async function ensureLogin() {
    logger.info("Abriendo Estado de Cuentas y verificando sesión de Biofile.");
    await page.goto(config.biofile.estadoCuentasUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    if (await isLoginPage()) {
      logger.info("No hay sesión activa. Iniciando sesión en Biofile.");

      const user = config.biofile.loginUserSelector
        ? page.locator(config.biofile.loginUserSelector).first()
        : page.locator('input[type="text"]:visible').first();
      const password = config.biofile.loginPasswordSelector
        ? page.locator(config.biofile.loginPasswordSelector).first()
        : page.locator('input[type="password"]:visible').first();

      await user.fill(creds.usuario);
      await password.fill(creds.contrasena);

      let button;
      if (config.biofile.loginButtonSelector) {
        button = page.locator(config.biofile.loginButtonSelector).first();
      } else {
        button = page.getByRole("button", { name: /Ingresar al sistema/i }).first();
        if (!(await isVisible(button))) {
          button = page.locator('input[type="submit"]:visible').first();
        }
      }

      await button.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(1800);

      if (await isLoginPage()) {
        throw new Error(
          "Biofile no permitió iniciar sesión. Revisa BIOFILE_USUARIO/BIOFILE_CONTRASENA o los selectores de login."
        );
      }

      await context.storageState({ path: config.browser.authPath }).catch(() => {});
      logger.info("Sesión de Biofile iniciada correctamente.");
    } else {
      logger.info("Biofile conservó una sesión válida.");
    }

    if (!/Factura\/EstadoCuentas\.aspx/i.test(page.url())) {
      await page.goto(config.biofile.estadoCuentasUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
    }
  }

  async function close() {
    await context.storageState({ path: config.browser.authPath }).catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return { browser, context, page, ensureLogin, close };
}
