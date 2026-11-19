const BASE_URL = "https://celps.nmdpra.gov.ng";

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
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
    return res.status(400).json({
      ok: false,
      error: "No permit number supplied",
    });
  }

  const nmdpraUrl = `${BASE_URL}/Permit/VerifyPermit?PermitNo=${encodeURIComponent(permitNo)}`;

  try {
    const response = await fetch(nmdpraUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": `${BASE_URL}/Permit/VerifyPermit`,
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `NMDPRA portal returned HTTP ${response.status}`,
      });
    }

    const html = await response.text();
    const text = html
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

    const flat = text.replace(/\n+/g, " ");
    const isNotFound = /not found|invalid permit|no record|does not exist|record not found/i.test(flat);
    const isExpired = /\bexpired\b/i.test(flat);

    const company = extractMatch(flat, [
      /Company\s*Name\s*[:\-]?\s*([A-Za-z0-9&.,'()\- ]{2,90}?)(?=\s+(?:Address|Permit|Licence|License|Expiry|Expiration|Issue|Valid|Status|Category|Facility|State|LGA)\b|$)/i,
      /Applicant(?:\s*Name)?\s*[:\-]?\s*([A-Za-z0-9&.,'()\- ]{2,90}?)(?=\s+(?:Address|Permit|Licence|License|Expiry|Expiration|Issue|Valid|Status|Category|Facility|State|LGA)\b|$)/i,
    ]);

    const expiry = extractMatch(flat, [
      /(?:Expiry|Expiration)\s*Date\s*[:\-]?\s*([A-Za-z0-9,\/\-\s]{4,40}?)(?=\s+(?:Status|Company|Permit|Fee)\b|$)/i,
      /Valid\s*(?:Until|To)\s*[:\-]?\s*([A-Za-z0-9,\/\-\s]{4,40}?)(?=\s+(?:Status|Company|Permit|Fee)\b|$)/i,
    ]);

    const address = extractMatch(flat, [
      /(?:Address\s*of\s*Premises|Premises\s*Address|Facility\s*Address|Address|Location)\s*[:\-]?\s*([A-Za-z0-9&.,'()\/\-\s]{4,120}?)(?=\s+(?:Expiry|Expiration|Issue|Valid|Status|Product|Fee|State|LGA)\b|$)/i,
    ]);

    let proxyImageUrl = "";
    const imgMatches = Array.from(html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi))
      .map((m) => m[1])
      .filter((src) => src && !/logo|icon|favicon|avatar|spinner/i.test(src));
    const bestImg = imgMatches.find((src) => /permit|licence|license|cert|print|scan|doc/i.test(src));
    if (bestImg) {
      try {
        proxyImageUrl = `/api/download?url=${encodeURIComponent(new URL(bestImg, BASE_URL).href)}`;
      } catch {
        proxyImageUrl = "";
      }
    }

    let proxyPdfUrl = "";
    const pdfMatch = html.match(/href=["']([^"']*(?:\.pdf|pdf|download|print)[^"']*)["']/i);
    if (pdfMatch && pdfMatch[1]) {
      try {
        proxyPdfUrl = `/api/download?url=${encodeURIComponent(new URL(pdfMatch[1], BASE_URL).href)}`;
      } catch {
        proxyPdfUrl = "";
      }
    }

    return res.status(200).json({
      ok: !isNotFound,
      permitNo,
      status: isNotFound ? "NOT FOUND" : isExpired ? "EXPIRED" : "VALID",
      company,
      expiry,
      address,
      proxyImageUrl,
      proxyPdfUrl,
      rawExcerpt: text.slice(0, 1500),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to verify permit",
    });
  }
}
