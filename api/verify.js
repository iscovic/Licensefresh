const BASE_URL = "https://celps.nmdpra.gov.ng";

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function pick(pairs, keys) {
  for (const [k, v] of pairs) {
    const lk = k.toLowerCase();
    if (keys.some((needle) => lk.includes(needle)) && v) {
      return v;
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

  const nmdpraUrl = `${BASE_URL}/Permit/VerifyPermit?PermitNo=${encodeURIComponent(permitNo)}`;

  try {
    const response = await fetch(nmdpraUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `NMDPRA portal returned HTTP ${response.status}`,
      });
    }

    const rawBody = await response.text();
    let pairs = [];
    let structuredText = "";

    // If NMDPRA returns JSON
    try {
      const json = JSON.parse(rawBody);
      const flatObj = {};
      const walk = (obj, prefix = "") => {
        if (!obj || typeof obj !== "object") return;
        for (const [k, v] of Object.entries(obj)) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (v !== null && typeof v === "object") walk(v, key);
          else flatObj[key] = clean(v);
        }
      };
      walk(json);
      pairs = Object.entries(flatObj);
      structuredText = pairs.map(([k, v]) => `${k} : ${v}`).join("\n");
    } catch {
      // Otherwise parse HTML table cells / labeled elements
      structuredText = rawBody
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

      for (const line of structuredText.split("\n")) {
        const idx = line.indexOf(" : ");
        if (idx > 0) {
          pairs.push([clean(line.slice(0, idx)), clean(line.slice(idx + 3))]);
        }
      }
    }

    const flatText = structuredText.replace(/\n+/g, " ");
    const isNotFound = /not found|invalid permit|no record|does not exist|record not found/i.test(flatText);
    const isExpired = /\bexpired\b/i.test(flatText);

    const company = pick(pairs, ["company", "applicant", "operator", "entity", "holder"]);
    const cic = pick(pairs, ["cic", "identification", "rc", "cac"]);
    const companyAddress = pick(pairs, ["companyaddress", "applicantaddress", "headoffice", "registeredaddress"]);
    const premises = pick(pairs, ["premises", "facility", "site", "location", "address"]);
    const products = pick(pairs, ["product", "storage", "capacity", "volume", "commodity"]);
    const dated = pick(pairs, ["issue", "issued", "dated", "date"]);
    const fee = pick(pairs, ["fee", "amount", "payment"]);
    const expiry = pick(pairs, ["expiry", "expiration", "validuntil", "validto", "expires"]);

    const extractedCount = [company, cic, companyAddress, premises, products, dated, fee, expiry].filter(Boolean).length;

    return res.status(200).json({
      ok: !isNotFound,
      permitNo,
      status: isNotFound ? "NOT FOUND" : isExpired ? "EXPIRED" : "VALID",
      extractedCount,
      company,
      cic,
      companyAddress,
      premises,
      products,
      dated,
      fee,
      expiry,
      rawExcerpt: structuredText.slice(0, 2000),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to verify permit",
    });
  }
}
