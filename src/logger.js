const MAX_LOGS = 300;
const recent = [];

function secretKey(key) {
  return /(password|contrasena|contraseña|token|secret|api.?key|authorization|cookie|storage.?state|credential)/i.test(
    String(key || "")
  );
}

function redact(value, depth = 0) {
  if (depth > 6) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = secretKey(key) ? "[REDACTED]" : redact(item, depth + 1);
    }
    return out;
  }

  return value;
}

function push(entry) {
  recent.push(entry);
  if (recent.length > MAX_LOGS) recent.splice(0, recent.length - MAX_LOGS);
}

function line(level, message, data) {
  const safeData = data === undefined ? undefined : redact(data);
  const at = new Date().toISOString();
  const extra = safeData === undefined ? "" : ` ${JSON.stringify(safeData)}`;
  console.log(`[${at}] [${level}] ${message}${extra}`);
  push({ at, level, message: String(message || ""), data: safeData });
}

export const logger = {
  info: (message, data) => line("INFO", message, data),
  warn: (message, data) => line("WARN", message, data),
  error: (message, data) => line("ERROR", message, data),
};

export function recentLogs(limit = 150) {
  const max = Math.max(1, Math.min(300, Number(limit) || 150));
  return recent.slice(-max);
}

export function redactForLog(value) {
  return redact(value);
}
