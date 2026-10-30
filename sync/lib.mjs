// Pure helpers for the IMAP sync (no network). Tested by sync/test-lib.mjs.
import { readFileSync, existsSync } from "node:fs";

/** Minimal .env reader: KEY=value lines, # comments, optional quotes. */
export function loadEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** Date -> "YYYY-MM-DDTHH:MM" in the given IANA time zone (same format as the agenda tool). */
export function toLocalIso(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * Plain, short body for the agent: drop quoted replies and old thread history,
 * collapse whitespace, cut to maxChars.
 */
export function cleanBody({ text, html }, maxChars = 1500) {
  let body = text && text.trim() ? text : html ? htmlToText(html) : "";
  const lines = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    // Stop at the start of quoted history ("On ... wrote:", "El ... escribió:", "-----Original Message-----")
    if (/^(on .+ wrote:|el .+ escribi[oó]:|-{2,}\s*original message\s*-{2,}|-{2,}\s*mensaje original\s*-{2,})$/i.test(t)) break;
    if (t.startsWith(">")) continue;
    lines.push(t);
  }
  body = lines.join(" ").replace(/\s+/g, " ").trim();
  if (body.length > maxChars) body = body.slice(0, maxChars).trimEnd() + " [...]";
  return body;
}

/** Parsed message (mailparser) + IMAP metadata -> agenda inbox entry. */
export function toInboxEntry({ uid, parsed, internalDate, timeZone, maxChars }) {
  const date = parsed.date instanceof Date && !isNaN(parsed.date) ? parsed.date : internalDate;
  return {
    id: uid,
    from: parsed.from?.text ?? "(unknown sender)",
    received: toLocalIso(date, timeZone),
    subject: parsed.subject ?? "(no subject)",
    body: cleanBody({ text: parsed.text, html: typeof parsed.html === "string" ? parsed.html : "" }, maxChars),
  };
}
