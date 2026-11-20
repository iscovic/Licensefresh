const ALLOWED_HOSTS = new Set([
  "celps.nmdpra.gov.ng",
  "roms.nmdpra.gov.ng",
]);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractCookies(response) {
  const cookies = [];
  if (typeof response.headers.getSetCookie === "function") {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0].trim();
      if (pair && pair.includes("=")) cookies.push(pair);
    }
  } else {
    const raw = response.headers.get("set-cookie") || "";
    for (const part of raw.split(/,(?=\s*[A-Za-z0-9_\-.]+=)/)) {
      const pair = part.split(";")[0].trim();
      if (pair && pair.includes("=")) cookies.push(pair);
    }
  }
  return cookies.join("; ");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function followPermitRedirects(startUrl, maxHops = 6) {
  let currentUrl = startUrl;
  let cookieJar = "";

  for (let hop = 0; hop < maxHops; hop += 1) {
    const parsed = new URL(currentUrl);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      throw new Error(`Blocked redirect host: ${parsed.hostname}`);
    }

    const headers = {
      ...BROWSER_HEADERS,
      Referer: "https://celps.nmdpra.gov.ng/Permit/VerifyPermit",
      ...(cookieJar ? { Cookie: cookieJar } : {}),
    };

    const res = await fetchWithTimeout(currentUrl, {
      method: "GET",
      headers,
      redirect: "manual",
    });

    const newCookies = extractCookies(res);
    if (newCookies) {
      cookieJar = [cookieJar, newCookies].filter(Boolean).join("; ");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error(`Redirect (${res.status}) missing Location header`);
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      const html = await res.text();
      const metaOrLink = html.match(
        /(https?:\/\/roms\.nmdpra\.gov\.ng\/Application\/ViewLicense\/[^\s"'<>]+|\/Application\/ViewLicense\/[^\s"'<>]+)/i
      );
      if (metaOrLink && metaOrLink[1]) {
        currentUrl = new URL(metaOrLink[1], currentUrl).href;
        continue;
      }
    }

    return res;
  }

  throw new Error("Too many redirects while resolving permit PDF");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const rawParam = req.query?.url;
  if (!rawParam) {
    return res.status(400).json({ ok: false, error: "No URL" });
  }

  let targetUrl;
  try {
    const decoded = decodeHtmlEntities(decodeURIComponent(String(rawParam)));
    const parsed = new URL(decoded);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ ok: false, error: "Invalid protocol" });
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return res.status(403).json({ ok: false, error: "Host not allowed" });
    }
    targetUrl = parsed.href;
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid target URL" });
  }

  try {
    const pdfRes = await followPermitRedirects(targetUrl);
    if (!pdfRes.ok) {
      return res.status(502).json({
        ok: false,
        error: `Upstream NMDPRA response failed (HTTP ${pdfRes.status})`,
      });
    }

    const arrayBuffer = await pdfRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = pdfRes.headers.get("content-type") || "application/pdf";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buffer);
  } catch (err) {
    const message =
      err?.name === "AbortError"
        ? "Timed out downloading licence PDF from NMDPRA"
        : err?.message || "Failed to download licence PDF";
    return res.status(502).json({ ok: false, error: message });
  }
}
