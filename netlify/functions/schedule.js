const FACULTY = 283;
const GROUP = 48434;
const GROUP_NAME = "561-61 ИП";
const WEEKS_BACK = 1;
const WEEKS_AHEAD = 8;
const TZ = "Europe/Moscow";
const BASE = (d) =>
  `https://www.kstu.ru/www_Ggrid.jsp?f=${FACULTY}&g=${GROUP}&d=${d}`;

const DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;
const TIME_RE = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/;
const PERIOD_RE = /^\d{1,2}\s+\S+\s*[-–]\s*\d{1,2}\s+\S+$/;

function decode(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseTables(html) {
  const tables = [];
  const stack = [];
  let row = null, cell = null, bold = 0, buf = "";
  const flush = () => {
    if (cell && buf.trim()) cell.push({ text: buf.replace(/\s+/g, " ").trim(), bold: bold > 0 });
    buf = "";
  };
  const re = /<(\/?)([a-zA-Z0-9]+)[^>]*>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      if (cell) buf += decode(m[3]);
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!closing) {
      if (tag === "table") stack.push([]);
      else if (tag === "tr" && stack.length) row = [];
      else if ((tag === "td" || tag === "th") && row) { cell = []; buf = ""; }
      else if (cell) {
        if (tag === "b" || tag === "strong") { flush(); bold++; }
        else if (["br", "p", "div", "li", "a"].includes(tag)) flush();
      }
    } else {
      if ((tag === "td" || tag === "th") && cell) { flush(); if (row) row.push(cell); cell = null; }
      else if (tag === "tr" && row) { if (stack.length) stack[stack.length - 1].push(row); row = null; }
      else if (tag === "table" && stack.length) tables.push(stack.pop());
      else if (cell) {
        if (tag === "b" || tag === "strong") { flush(); bold = Math.max(0, bold - 1); }
        else if (["p", "div", "li", "a"].includes(tag)) flush();
      }
    }
  }
  return tables;
}

const cellText = (c) => c.map((t) => t.text).join(" ");

function splitEntries(cell) {
  const entries = [];
  let cur = null;
  for (const t of cell) {
    if (t.bold || !cur) {
      cur = { room: t.bold ? t.text : "", lines: t.bold ? [] : [t.text] };
      entries.push(cur);
    } else cur.lines.push(t.text);
  }
  const out = [];
  for (const e of entries) {
    let subject = "", teachers = [];
    for (const line of e.lines) {
      if (PERIOD_RE.test(line)) continue;
      if (!subject) subject = line;
      else teachers.push(line.replace(/^[,\s]+|[,\s]+$/g, ""));
    }
    if (subject) out.push({ room: e.room, subject, teachers: teachers.filter(Boolean) });
  }
  return out;
}

function parseWeek(html) {
  const events = [], seen = new Set();
  for (const table of parseTables(html)) {
    let headerDates = null;
    for (const row of table) {
      const texts = row.map(cellText);
      if (!texts.length) continue;
      const hasDate = texts.some((t) => DATE_RE.test(t));
      if (hasDate && !TIME_RE.test(texts[0])) {
        headerDates = texts.map((t) => {
          const d = t.match(DATE_RE);
          return d ? `${d[3]}${d[2]}${d[1]}` : null;
        });
        continue;
      }
      if (!headerDates) continue;
      const tm = texts[0].match(TIME_RE);
      if (!tm) continue;
      const start = [Number(tm[1]), Number(tm[2])];
      const end = [Number(tm[3]), Number(tm[4])];
      row.forEach((cell, idx) => {
        if (idx === 0 || idx >= headerDates.length || !headerDates[idx]) return;
        for (const e of splitEntries(cell)) {
          const key = [headerDates[idx], start.join(":"), e.subject, e.room].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          events.push({ date: headerDates[idx], start, end, ...e });
        }
      });
    }
  }
  return events;
}

const esc = (s) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

function fold(line) {
  const out = [];
  let cur = "", size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (size + n > 74) { out.push(cur); cur = " " + ch; size = 1 + n; }
    else { cur += ch; size += n; }
  }
  out.push(cur);
  return out.join("\r\n");
}

const pad = (n) => String(n).padStart(2, "0");
function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function buildIcs(events) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const L = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//schedule-ics//KSTU//RU",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:Расписание ${GROUP_NAME}`, `X-WR-TIMEZONE:${TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    "BEGIN:VTIMEZONE", `TZID:${TZ}`, "BEGIN:STANDARD", "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0300", "TZOFFSETTO:+0300", "TZNAME:MSK", "END:STANDARD", "END:VTIMEZONE",
  ];
  events.sort((a, b) =>
    (a.date + pad(a.start[0]) + pad(a.start[1])).localeCompare(b.date + pad(b.start[0]) + pad(b.start[1])));
  for (const e of events) {
    const st = `${e.date}T${pad(e.start[0])}${pad(e.start[1])}00`;
    const en = `${e.date}T${pad(e.end[0])}${pad(e.end[1])}00`;
    L.push(
      "BEGIN:VEVENT", `UID:${hash(`${st}|${e.subject}|${e.room}|${GROUP}`)}@schedule-ics`,
      `DTSTAMP:${now}`, `DTSTART;TZID=${TZ}:${st}`, `DTEND;TZID=${TZ}:${en}`,
      `SUMMARY:${esc(e.subject)}`, `LOCATION:${esc(e.room)}`,
      `DESCRIPTION:${esc(e.teachers.join(", "))}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT30M",
      `DESCRIPTION:${esc(e.subject)}`, "END:VALARM", "END:VEVENT"
    );
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

function mondayMoscow() {
  const t = new Date(Date.now() + 3 * 3600 * 1000);
  const day = (t.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - day));
}

async function loadEvents() {
  const monday = mondayMoscow();
  const jobs = [];
  for (let w = -WEEKS_BACK; w <= WEEKS_AHEAD; w++) {
    const d = new Date(monday.getTime() + w * 7 * 86400000).toISOString().slice(0, 10);
    jobs.push(
      fetch(BASE(d), { headers: { "User-Agent": "Mozilla/5.0 (schedule-ics)" } })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
        .then(parseWeek)
        .catch((err) => { console.warn("week", d, String(err)); return []; })
    );
  }
  return (await Promise.all(jobs)).flat();
}

exports.handler = async (event) => {
  const debug = event.queryStringParameters && event.queryStringParameters.debug;
  const events = await loadEvents();
  if (debug) {
    const text = events
      .map((e) => `${e.date} ${pad(e.start[0])}:${pad(e.start[1])}-${pad(e.end[0])}:${pad(e.end[1])} ${e.room} | ${e.subject} | ${e.teachers.join(", ")}`)
      .join("\n") || "Пар не найдено";
    return { statusCode: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text };
  }
  if (!events.length) {
    return { statusCode: 502, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Расписание сейчас недоступно, попробуйте позже" };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="schedule.ics"',
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, max-age=10800, stale-while-revalidate=86400",
    },
    body: buildIcs(events),
  };
};
