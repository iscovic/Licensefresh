const BASE_URL = "https://celps.nmdpra.gov.ng";
const VERIFY_ENDPOINT = `${BASE_URL}/Permit/VerifyPermit`;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,image/*,*/*;q=0.8",
};

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  }
  const raw = response.headers.get("set-cookie") || "";
  return raw
    .split(/,(?=\s*[A-Za-z0-9_\-.]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookies(...cookieStrings) {
  const map = new Map();
  for (const group of cookieStrings) {
    if (!group) continue;
    for (const part of group.split(";")) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        map.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
      }
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function extractAntiForgeryToken(html) {
  const m =
    html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i) ||
    html.match(/value=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i);
  return m ? m[1] : "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const permitNo = clean(req.query.permitNo);
  if (!permitNo) {
    return res.status(400).json({
      ok: false,
      error: "No permit number supplied",
    });
  }

  try {
    // 1. GET VerifyPermit to get anti-forgery token and session cookies
    const initRes = await fetch(VERIFY_ENDPOINT, {
      headers: BROWSER_HEADERS,
    });

    if (!initRes.ok) {
      return res.status(502).json({
        ok: false,
        error: `Failed to initialize NMDPRA verification page (HTTP ${initRes.status})`,
      });
    }

    let cookieHeader = extractCookies(initRes);
    const initHtml = await initRes.text();
    const token = extractAntiForgeryToken(initHtml);

    // 2. POST LicenseNo and check for redirect or HTML link
    const body = new URLSearchParams();
    body.set("LicenseNo", permitNo);
    if (token) {
      body.set("__RequestVerificationToken", token);
    }

    const postHeaders = {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: VERIFY_ENDPOINT,
      Origin: BASE_URL,
      "X-Requested-With": "XMLHttpRequest",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    const postRes = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: postHeaders,
      body: body.toString(),
      redirect: "manual",
    });

    cookieHeader = mergeCookies(cookieHeader, extractCookies(postRes));

    let nextUrl = decodeHtmlEntities(postRes.headers.get("location") || "");
    if (nextUrl) {
      nextUrl = new URL(nextUrl, VERIFY_ENDPOINT).href;
    }

    let postHtml = "";
    if (!nextUrl) {
      postHtml = await postRes.text();
      const viewLicenseMatch = postHtml.match(
        /(https?:\/\/roms\.nmdpra\.gov\.ng\/Application\/ViewLicense\/[^\s"'<>]+|\/Application\/ViewLicense\/[^\s"'<>]+|ExternalViewPermit\?[^\s"'<>]+)/i
      );
      if (viewLicenseMatch && viewLicenseMatch[1]) {
        const cleanMatch = decodeHtmlEntities(viewLicenseMatch[1]);
        nextUrl = new URL(cleanMatch, VERIFY_ENDPOINT).href;
      }
    }

    // 3. Follow redirect/link to see where NMDPRA actually leads
    let finalLicenseUrl = "";
    if (nextUrl) {
      const followRes = await fetch(nextUrl, {
        headers: {
          ...BROWSER_HEADERS,
          Referer: VERIFY_ENDPOINT,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        redirect: "follow",
      });

      const resolvedUrl = decodeHtmlEntities(followRes.url || nextUrl);
      if (followRes.ok) {
        finalLicenseUrl = resolvedUrl;
      } else {
        return res.status(200).json({
          ok: false,
          permitNo,
          resolvedUrl,
          error: `NMDPRA permit link returned HTTP ${followRes.status}`,
        });
      }
    }

    if (finalLicenseUrl) {
      return res.status(200).json({
        ok: true,
        permitNo,
        finalUrl: finalLicenseUrl,
        proxyPdfUrl: `/api/download?url=${encodeURIComponent(finalLicenseUrl)}`,
      });
    }

    const plainText = postHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const isNotFound =
      /not found|invalid permit|no record|does not exist|not filled correctly/i.test(
        plainText
      );

    return res.status(200).json({
      ok: false,
      permitNo,
      error: isNotFound
        ? `No licence record found on NMDPRA for ${permitNo}`
        : "Could not resolve the final ViewLicense PDF URL from NMDPRA",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to verify permit",
    });
  }
}
