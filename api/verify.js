const BASE_URL = "https://celps.nmdpra.gov.ng";
const VERIFY_ENDPOINT = `${BASE_URL}/Permit/VerifyPermit`;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,image/*,*/*;q=0.8",
};

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
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

    const cookieHeader = extractCookies(initRes);
    const initHtml = await initRes.text();
    const token = extractAntiForgeryToken(initHtml);

    // 2. POST LicenseNo and follow redirects to ExternalViewPermit -> roms.nmdpra.gov.ng/Application/ViewLicense/<id>
    const body = new URLSearchParams();
    body.set("LicenseNo", permitNo);
    if (token) {
      body.set("__RequestVerificationToken", token);
    }

    const postHeaders = {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": VERIFY_ENDPOINT,
      "Origin": BASE_URL,
      "X-Requested-With": "XMLHttpRequest",
    };
    if (cookieHeader) {
      postHeaders.Cookie = cookieHeader;
    }

    const postRes = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: postHeaders,
      body: body.toString(),
      redirect: "manual",
    });

    // Some endpoints return a 302 Location header (e.g., /Permit/ExternalViewPermit?id=...&code=...)
    let nextUrl = postRes.headers.get("location") || "";
    if (nextUrl) {
      nextUrl = new URL(nextUrl, VERIFY_ENDPOINT).href;
    }

    // If POST itself returned HTML containing a redirect or ViewLicense URL
    let postHtml = "";
    if (!nextUrl) {
      postHtml = await postRes.text();
      const viewLicenseMatch = postHtml.match(
        /(https?:\/\/roms\.nmdpra\.gov\.ng\/Application\/ViewLicense\/[^\s"'<>]+|\/Application\/ViewLicense\/[^\s"'<>]+|ExternalViewPermit\?[^\s"'<>]+)/i
      );
      if (viewLicenseMatch && viewLicenseMatch[1]) {
        nextUrl = new URL(viewLicenseMatch[1], VERIFY_ENDPOINT).href;
      }
    }

    // Follow ExternalViewPermit if present to get the final /Application/ViewLicense/<id> URL
    let finalLicenseUrl = "";
    if (nextUrl) {
      const followRes = await fetch(nextUrl, {
        headers: {
          ...BROWSER_HEADERS,
          "Referer": VERIFY_ENDPOINT,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        redirect: "follow",
      });
      finalLicenseUrl = followRes.url || nextUrl;
    }

    // Fallback if a numeric/alphanumeric licence ID was extracted from finalLicenseUrl
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

    const isNotFound = /not found|invalid permit|no record|does not exist|not filled correctly/i.test(plainText);

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
