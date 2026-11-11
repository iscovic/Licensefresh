// api/download.js - proxies the PDF so browser doesn't leave LicenseFresh
export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).send('No URL');
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buf = await r.arrayBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="licence.pdf"');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).send('Download failed: ' + e.message);
  }
}
