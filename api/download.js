const ALLOWED_HOST = "celps.nmdpra.gov.ng";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).send("No URL");
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  if (targetUrl.protocol !== "https:" || targetUrl.hostname !== ALLOWED_HOST) {
    return res.status(403).send("Forbidden host");
  }

  try {
    const r = await fetch(targetUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": `https://${ALLOWED_HOST}/Permit/VerifyPermit`,
      },
    });

    if (!r.ok) {
      return res.status(r.status).send(`Upstream fetch failed (${r.status})`);
    }

    const contentType = r.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send("Fetch failed: " + e.message);
  }
}
