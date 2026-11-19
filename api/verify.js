const BASE_URL = "https://celps.nmdpra.gov.ng";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const permitNo = (req.query.permitNo || "").trim();
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
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `NMDPRA portal returned HTTP ${response.status}`,
      });
    }

    const html = await response.text();
    const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const isNotFound = /not found|invalid permit|no record|does not exist/i.test(plainText);
    const isExpired = /\bexpired\b/i.test(plainText);

    let downloadUrl = "";
    const pdfMatch = html.match(/href=["']([^"']*(?:pdf|download|print|permit)[^"']*)["']/i);
    if (pdfMatch) {
      try {
        downloadUrl = new URL(pdfMatch[1], BASE_URL).href;
      } catch {
        downloadUrl = "";
      }
    }

    const companyMatch =
      plainText.match(/Company\s*Name\s*[:\-]?\s*([A-Za-z0-9&.,'()\- ]{2,80}?)(?=\s+(?:Address|Permit|Expiry|Valid|Status|Category|Facility|LGA|State)\b|$)/i) ||
      plainText.match(/Applicant(?:\s*Name)?\s*[:\-]?\s*([A-Za-z0-9&.,'()\- ]{2,80}?)(?=\s+(?:Address|Permit|Expiry|Valid|Status|Category|Facility|LGA|State)\b|$)/i);

    const expiryMatch =
      plainText.match(/(?:Expiry|Expiration)\s*Date\s*[:\-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}|[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4})/i) ||
      plainText.match(/Valid\s*(?:Until|To)\s*[:\-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}|[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4})/i);

    const status = isNotFound ? "NOT FOUND" : isExpired ? "EXPIRED" : "VALID";

    return res.status(200).json({
      ok: !isNotFound,
      permitNo,
      status,
      company: companyMatch ? companyMatch[1].trim() : "",
      expiry: expiryMatch ? expiryMatch[1].trim() : "",
      downloadUrl,
      proxyDownloadUrl: downloadUrl
        ? `/api/download?url=${encodeURIComponent(downloadUrl)}`
        : "",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to verify permit",
    });
  }
}
