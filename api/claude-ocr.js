const https = require('https');

const PROMPT =
  'אתה קורא תעודת משלוח סרוקה בעברית.\n' +
  'בתעודה יש טבלה עם העמודות: ש. | מק"ט | תאור מוצר | כמות | מחיר ליחידה | סה"כ מחיר\n' +
  '(הסדר עשוי להשתנות בין תעודות, אבל העיקרון זהה)\n\n' +
  'המשימה: עבור כל שורת פריט בטבלה, חלץ:\n' +
  '1. מק"ט — קוד המוצר האלפאנומרי (לדוגמה: plst-hc58000004, trb38w12, gw20571l, pls-lh200-f)\n' +
  '   חשוב: זה לא מספר השורה (1,2,3) ולא מספר התעודה\n' +
  '2. תיאור — טקסט תיאור המוצר המלא שמופיע בין עמודת המק"ט לעמודת הכמות\n' +
  '3. כמות — מספר בלבד ללא יחידות (יח\', מטר, וכו\'). אם כתוב "100 10.00" קח את 10\n\n' +
  'החזר JSON בלבד, ללא שום טקסט לפני או אחרי:\n' +
  '[{"מקט": "קוד", "תיאור": "תיאור מלא", "כמות": מספר}]\n\n' +
  'התעלם לחלוטין מ: כותרת התעודה, שם הספק, כתובת, תאריכים, מחירים, מע"מ, סיכומים, חתימות.';

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY לא מוגדר' });

  let pages;
  try {
    const rawBody = await getRawBody(req);
    const parsed = JSON.parse(rawBody || '{}');
    pages = parsed.pages;
  } catch (e) {
    return res.status(400).json({ error: 'JSON לא תקין: ' + e.message });
  }

  if (!pages || pages.length === 0) return res.status(400).json({ error: 'לא התקבלו תמונות' });

  try {
    const content = [];
    for (const base64 of pages) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } });
    }
    content.push({ type: 'text', text: PROMPT });

    const bodyStr = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    });

    const result = await httpsPost({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, bodyStr);

    if (result.status !== 200) return res.status(500).json({ error: `Claude API ${result.status}: ${result.body}` });

    const data = JSON.parse(result.body);
    const text = (data.content?.[0]?.text || '').trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.status(200).json({ items: [], raw: text });

    const items = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: 'שגיאה פנימית: ' + e.message });
  }
};
