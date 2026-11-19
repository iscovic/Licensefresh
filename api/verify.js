const BASE_URL = "https://celps.nmdpra.gov.ng";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const permitNo = String(req.query.permitNo || "").trim();
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
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
        "Referer": `${BASE_URL}/Permit/VerifyPermit`,
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `NMDPRA portal returned HTTP ${response.status}`,
      });
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("image/")) {
      const buf = Buffer.from(await response.arrayBuffer());
      return res.status(200).json({
        ok: true,
        permitNo,
        imageDataUrl: `data:${contentType};base64,${buf.toString("base64")}`,
      });
    }

    if (contentType.includes("application/pdf")) {
      return res.status(200).json({
        ok: true,
        permitNo,
        proxyPdfUrl: `/api/download?url=${encodeURIComponent(nmdpraUrl)}`,
      });
    }

    const html = await response.text();
    const isNotFound = /not found|invalid permit|no record|does not exist|record not found/i.test(html);

    // Check for inline data URI image
    const dataImgMatch = html.match(/src=["'](data:image\/[^"']+)["']/i);
    if (dataImgMatch && dataImgMatch[1]) {
      return res.status(200).json({
        ok: true,
        permitNo,
        imageDataUrl: dataImgMatch[1],
      });
    }

    // Collect candidate <img> tags and ignore tiny logos/icons if a larger licence image is present
    const imgMatches = Array.from(html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi))
      .map((m) => m[1])
      .filter((src) => src && !/logo|icon|favicon|avatar|spinner/i.test(src));

    const bestImg = imgMatches.find((src) => /permit|licence|license|cert|print|scan|image|doc/i.test(src)) || imgMatches[0] || "";
    let proxyImageUrl = "";
    if (bestImg) {
      try {
        const resolved = new URL(bestImg, BASE_URL).href;
        proxyImageUrl = `/api/download?url=${encodeURIComponent(resolved)}`;
      } catch {
        proxyImageUrl = "";
      }
    }

    // Check for PDF or document link
    let proxyPdfUrl = "";
    const pdfMatch = html.match(/href=["']([^"']*(?:\.pdf|pdf|download|print|certificate|permit)[^"']*)["']/i);
    if (pdfMatch && pdfMatch[1]) {
      try {
        const resolvedPdf = new URL(pdfMatch[1], BASE_URL).href;
        proxyPdfUrl = `/api/download?url=${encodeURIComponent(resolvedPdf)}`;
      } catch {
        proxyPdfUrl = "";
      }
    }

    const hasDocument = Boolean(proxyImageUrl || proxyPdfUrl);

    return res.status(200).json({
      ok: !isNotFound && hasDocument,
      permitNo,
      proxyImageUrl,
      proxyPdfUrl,
      error: isNotFound
        ? `No record found on NMDPRA for ${permitNo}`
        : !hasDocument
        ? "No licence image or PDF link found in NMDPRA response"
        : "",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to verify permit",
    });
  }
}
