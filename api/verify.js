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

function extractMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const val = clean(m[1]);
      if (val) return val;
    }
  }
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const permitNo = clean(req.query.permitNo);
  if (!permitNo) {
    return res.status(400).json({ ok: false, error: "No permit number supplied" });
  }

  try {
    // 1. GET VerifyPermit for anti-forgery token & cookies
    const initRes = await fetch(VERIFY_ENDPOINT, { headers: BROWSER_HEADERS });
    if (!initRes.ok) {
      return res.status(502).json({
        ok: false,
        error: `Failed to initialize NMDPRA verification page (HTTP ${initRes.status})`,
      });
    }

    const cookieHeader = extractCookies(initRes);
    const initHtml = await initRes.text();
    const token = extractAntiForgeryToken(initHtml);

    // 2. POST LicenseNo and follow redirects (e.g., ExternalViewPermit -> roms.nmdpra.gov.ng/...)
    const body = new URLSearchParams();
    body.set("LicenseNo", permitNo);
    if (token) body.set("__RequestVerificationToken", token);

    const postHeaders = {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": VERIFY_ENDPOINT,
      "Origin": BASE_URL,
      "X-Requested-With": "XMLHttpRequest",
    };
    if (cookieHeader) postHeaders.Cookie = cookieHeader;

    const finalRes = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: postHeaders,
      body: body.toString(),
      redirect: "follow",
    });

    const finalUrl = finalRes.url || VERIFY_ENDPOINT;
    const finalContentType = finalRes.headers.get("content-type") || "";

    // If the redirected final response is directly a PDF
    if (finalContentType.toLowerCase().includes("application/pdf")) {
      return res.status(200).json({
        ok: true,
        permitNo,
        status: "VALID",
        finalUrl,
        proxyPdfUrl: `/api/download?url=${encodeURIComponent(finalUrl)}`,
      });
    }

    // If the redirected final response is directly an image
    if (finalContentType.toLowerCase().startsWith("image/")) {
      return res.status(200).json({
        ok: true,
        permitNo,
        status: "VALID",
        finalUrl,
        proxyImageUrl: `/api/download?url=${encodeURIComponent(finalUrl)}`,
      });
    }

    const rawResponse = await finalRes.text();

    // Check if JSON
    try {
      const json = JSON.parse(rawResponse);
      const flat = JSON.stringify(json);
      const isNotFound = /not found|invalid|no record/i.test(flat);
      const isExpired = /\bexpired\b/i.test(flat);
      const directDoc = json.url || json.pdfUrl || json.downloadUrl || json.certificateUrl || "";
      let proxyPdfUrl = "";
      if (directDoc) {
        try {
          const abs = new URL(directDoc, finalUrl).href;
          proxyPdfUrl = `/api/download?url=${encodeURIComponent(abs)}`;
        } catch {}
      }

      return res.status(200).json({
        ok: !isNotFound,
        permitNo,
        status: isNotFound ? "NOT FOUND" : isExpired ? "EXPIRED" : "VALID",
        finalUrl,
        proxyPdfUrl,
        company: clean(json.companyName || json.CompanyName || json.applicant || ""),
        expiry: clean(json.expiryDate || json.ExpiryDate || json.validUntil || ""),
        address: clean(json.address || json.Address || json.facilityAddress || ""),
        rawExcerpt: JSON.stringify(json).slice(0, 1500),
      });
    } catch {}

    const text = rawResponse
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(tr|p|div|li|h[1-6]|dt|dd|br)>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " : ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();

    const flatText = text.replace(/\n+/g, " ");
    const isNotFound = /not found|invalid permit|no record|does not exist|not filled correctly/i.test(flatText);
    const isExpired = /\bexpired\b/i.test(flatText);

    // Look for embedded PDF/iframe/object/embed or image links on the final page
    let proxyPdfUrl = "";
    const docMatch = rawResponse.match(
      /(?:href|src|data)=["']([^"']*(?:\.pdf|pdf|certificate|permit|print|view)[^"']*)["']/i
    );
    if (docMatch && docMatch[1]) {
      try {
        const absDoc = new URL(docMatch[1], finalUrl).href;
        proxyPdfUrl = `/api/download?url=${encodeURIComponent(absDoc)}`;
      } catch {}
    }

    const company = extractMatch(flatText, [
      /Company\s*Name\s*[:\-]?\s*([A-Za-z0-9&.,'()\- ]{2,90}?)(?=\s+(?:Address|Permit|Licence|License|Expiry|Expiration|Issue|Valid|Status|Category|Facility|State|LGA)\b|$)/i,
      /Applicant(?:\s*Name)?\s*[:\-]?\s*([A-Za-z0-9&.,'()\- ]{2,90}?)(?=\s+(?:Address|Permit|Licence|License|Expiry|Expiration|Issue|Valid|Status|Category|Facility|State|LGA)\b|$)/i,
    ]);

    const expiry = extractMatch(flatText, [
      /(?:Expiry|Expiration)\s*Date\s*[:\-]?\s*([A-Za-z0-9,\/\-\s]{4,40}?)(?=\s+(?:Status|Company|Permit|Fee)\b|$)/i,
      /Valid\s*(?:Until|To)\s*[:\-]?\s*([A-Za-z0-9,\/\-\s]{4,40}?)(?=\s+(?:Status|Company|Permit|Fee)\b|$)/i,
    ]);

    const address = extractMatch(flatText, [
      /(?:Address\s*of\s*Premises|Premises\s*Address|Facility\s*Address|Address|Location)\s*[:\-]?\s*([A-Za-z0-9&.,'()\/\-\s]{4,120}?)(?=\s+(?:Expiry|Expiration|Issue|Valid|Status|Product|Fee|State|LGA)\b|$)/i,
    ]);

    return res.status(200).json({
      ok: !isNotFound,
      permitNo,
      status: isNotFound ? "NOT FOUND" : isExpired ? "EXPIRED" : "VALID",
      finalUrl,
      proxyPdfUrl,
      company,
      expiry,
      address,
      rawExcerpt: text.slice(0, 1500),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to verify permit",
    });
  }
}
