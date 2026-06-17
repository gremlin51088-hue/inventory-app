const https = require('https');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwd9ikEfFxluosweTgnLwji-O2wAXMiVMyq3Wcvh0L3QIWYBoL4IKUCooHnER9umDC9/exec';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
    }, (res) => {
      if ((res.statusCode === 302 || res.statusCode === 301) && res.headers.location) {
        httpsGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let rawBody = '';
    await new Promise((resolve, reject) => {
      req.on('data', chunk => { rawBody += chunk; });
      req.on('end', resolve);
      req.on('error', reject);
    });
    const url = APPS_SCRIPT_URL + '?payload=' + encodeURIComponent(rawBody || '{}');
    const result = await httpsGet(url);
    return res.status(200).send(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
