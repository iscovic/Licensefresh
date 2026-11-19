const BASE_URL = "https://celps.nmdpra.gov.ng";

function cleanText(val) {
  return String(val || "").replace(/\s+/g, " ").trim();
}

function extractField(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const cleaned = cleanText(m[1]);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const permitNo = cleanText(req.query.permitNo);
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

    // Convert table cells and line breaks into readable text
    const structuredText = html
      .replace(/<\/(tr|p|div|li|h[1-6]|dt|dd)>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " : ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();

    const flatText = structuredText.replace(/\n+/g, " ");

    const isNotFound = /not found|invalid permit|no record|does not exist|record not found/i.test(flatText);
    const isExpired = /\bexpired\b/i.test(flatText);

    let downloadUrl = "";
    const pdfMatch = html.match(/href=["']([^"']*(?:pdf|download|print|certificate|permit)[^"']*)["']/i);
    if (pdfMatch) {
      try {
        downloadUrl = new URL(pdfMatch[1], BASE_URL).href;
      } catch {
        downloadUrl = "";
      }
    }

    const stopWords = "(?:Company|Applicant|Permit|Licence|License|Expiry|Expiration|Issue|Issued|Valid|Status|Category|Facility|Premises|Address|State|LGA|Product|Volume|Capacity|Fee|Amount|Date)\\b|$";

    const company = extractField(flatText, [
      new RegExp(`Company\\s*Name\\s*[:\\-]?\\s*([^\\n]{2,100}?)(?=\\s+${stopWords})`, "i"),
      new RegExp(`Applicant(?:\\s*Name)?\\s*[:\\-]?\\s*([^\\n]{2,100}?)(?=\\s+${stopWords})`, "i"),
      new RegExp(`Operator\\s*[:\\-]?\\s*([^\\n]{2,100}?)(?=\\s+${stopWords})`, "i"),
    ]);

    const cic = extractField(flatText, [
      /(?:Company\s*Identification\s*Code|CIC|RC\s*No\.?|CAC\s*No\.?)\s*[:\-]?\s*([A-Za-z0-9\-\/]+)/i,
    ]);

    const companyAddress = extractField(flatText, [
      new RegExp(`(?:Company\\s*Address|Applicant\\s*Address|Head\\s*Office|Registered\\s*Address)\\s*[:\\-]?\\s*([^\\n]{3,140}?)(?=\\s+${stopWords})`, "i"),
    ]);

    const premises = extractField(flatText, [
      new RegExp(`(?:Address\\s*of\\s*Premises|Premises\\s*Address|Facility\\s*Address|Site\\s*Address|Location|Address)\\s*[:\\-]?\\s*([^\\n]{3,140}?)(?=\\s+${stopWords})`, "i"),
    ]);

    const products = extractField(flatText, [
      new RegExp(`(?:Name\\(s\\)\\s*of\\s*Product|Products?|Storage\\s*(?:of|Capacity)|Commodity|Petroleum\\s*Product)\\s*[:\\-]?\\s*([^\\n]{2,160}?)(?=\\s+(?:Address|Premises|Expiry|Issue|Date|Fee|Status)\\b|$)`, "i"),
    ]);

    const dated = extractField(flatText, [
      /(?:Issue\s*Date|Issued\s*Date|Date\s*Issued|Dated)\s*[:\-]?\s*([A-Za-z0-9,\/\-\s]{4,45}?)(?=\s+(?:Expiry|Expiration|Valid|Fee|Status)\b|$)/i,
    ]);

    const fee = extractField(flatText, [
      /(?:Fee|Amount\s*Paid|Payment)\s*[:\-]?\s*([₦N0-9,.\sA-Za-z()]{2,60}?)(?=\s+(?:Expiry|Expiration|Valid|Date|Status)\b|$)/i,
    ]);

    const expiry = extractField(flatText, [
      /(?:Expiry\s*Date|Expiration\s*Date|Valid\s*(?:Until|To)|Expires\s*On)\s*[:\-]?\s*([A-Za-z0-9,\/\-\s]{4,40}?)(?=\s+(?:Status|Company|Permit|Fee)\b|$)/i,
    ]);

    const status = isNotFound ? "NOT FOUND" : isExpired ? "EXPIRED" : "VALID";

    return res.status(200).json({
      ok: !isNotFound,
      permitNo,
      status,
      company,
      cic,
      companyAddress,
      premises,
      products,
      dated,
      fee,
      expiry,
      downloadUrl,
      proxyDownloadUrl: downloadUrl
        ? `/api/download?url=${encodeURIComponent(downloadUrl)}`
        : "",
      rawExcerpt: structuredText.slice(0, 1200),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to verify permit",
    });
  }
}
