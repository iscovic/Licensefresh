export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { permitNo } = req.query;

  if (!permitNo) {
    return res.status(400).json({
      ok: false,
      error: "No permit number supplied",
    });
  }

  const nmdpraUrl =
    `https://celps.nmdpra.gov.ng/Permit/VerifyPermit?PermitNo=${encodeURIComponent(permitNo)}`;

  try {
    const response = await fetch(nmdpraUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html",
      },
    });

    const html = await response.text();

    const isNotFound = /not found|invalid|no record/i.test(html);
    const isExpired = /expired/i.test(html);

    let downloadUrl = "";

    const pdfMatch = html.match(
      /href="([^"]*(pdf|download|print)[^"]*)"/i
    );

    if (pdfMatch) {
      downloadUrl = pdfMatch[1];

      if (!downloadUrl.startsWith("http")) {
        downloadUrl =
          "https://celps.nmdpra.gov.ng" + downloadUrl;
      }
    }

    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    const companyMatch =
      text.match(
        /Company Name\s*[:\-]?\s*([A-Za-z0-9&.\- ]+)/i
      ) ||
      text.match(
        /Applicant\s*[:\-]?\s*([A-Za-z0-9&.\- ]+)/i
      );

    const expiryMatch =
      text.match(
        /Expiry Date\s*[:\-]?\s*([0-9\/\-]+)/i
      ) ||
      text.match(
        /Valid Until\s*[:\-]?\s*([0-9\/\-]+)/i
      );

    return res.status(200).json({
      ok: !isNotFound,
      permitNo,
      status: isNotFound
        ? "NOT FOUND"
        : isExpired
        ? "EXPIRED"
        : "VALID",
      company: companyMatch
        ? companyMatch[1].trim()
        : "",
      expiry: expiryMatch
        ? expiryMatch[1].trim()
        : "",
      downloadUrl,
      proxyDownloadUrl: downloadUrl
        ? `/api/download?url=${encodeURIComponent(downloadUrl)}`
        : "",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
