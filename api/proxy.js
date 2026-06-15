const https = require('https');

// ← הדבק כאן את ה-URL שלך מ-Apps Script (Deploy → Web App URL)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwjQFSJL42NZXTeraBf7PoqM2BmN5N897Dxh7y0HTdjLjnwFFasTTiGKsrfa9iq5ovu/exec';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      // עקוב אחרי redirects
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    const payload = event.body || '{}';
    // שלח כ-GET עם payload ב-URL — Apps Script קורא מ-doGet
    const url = APPS_SCRIPT_URL + '?payload=' + encodeURIComponent(payload);
    const result = await httpsGet(url);
    return { statusCode: 200, headers: CORS, body: result };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
