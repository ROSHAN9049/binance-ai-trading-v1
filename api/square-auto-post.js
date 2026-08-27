const SQUARE_URL = 'https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add';
const MARKET_URL = 'https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22%5D';

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

function money(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function pct(n) {
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function buildPost(rows) {
  const btc = rows.find(x => x.symbol === 'BTCUSDT');
  const eth = rows.find(x => x.symbol === 'ETHUSDT');
  const btcPrice = Number(btc.lastPrice);
  const ethPrice = Number(eth.lastPrice);
  const btcChange = Number(btc.priceChangePercent);
  const ethChange = Number(eth.priceChangePercent);

  const direction = btcChange > 1 ? 'bullish momentum' : btcChange < -1 ? 'short-term pressure' : 'a mixed, range-bound market';
  const title = `Bitcoin Market Update: BTC at $${money(btcPrice)} — What Traders Should Watch`;
  const text = [
    `Bitcoin is currently showing ${direction} over the last 24 hours.`,
    '',
    `📊 Market snapshot`,
    `• $BTC: $${money(btcPrice)} (${pct(btcChange)} 24h)`,
    `• $ETH: $${money(ethPrice)} (${pct(ethChange)} 24h)`,
    '',
    `🔎 What I am watching`,
    `• BTC price action around the current session range`,
    `• Trading volume and whether momentum is strengthening or fading`,
    `• ETH relative strength versus BTC`,
    `• Major macro and crypto news before taking any position`,
    '',
    `A strong move is more meaningful when price and volume confirm each other. I would avoid treating a single indicator or price level as a guaranteed signal.`,
    '',
    `What is your view on $BTC today — breakout, pullback, or consolidation? 👇`,
    '',
    `This post is for educational purposes only and is not financial advice. Crypto trading involves significant risk. Always do your own research.`
  ].join('\n');

  return { title, text };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${secret}`) return json(res, 401, { ok: false, error: 'Unauthorized' });
  }

  const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: 'BINANCE_SQUARE_OPENAPI_KEY is not configured' });

  try {
    const marketRes = await fetch(MARKET_URL);
    if (!marketRes.ok) throw new Error(`Market API returned ${marketRes.status}`);
    const rows = await marketRes.json();
    const post = buildPost(rows);

    const squareRes = await fetch(SQUARE_URL, {
      method: 'POST',
      headers: {
        'X-Square-OpenAPI-Key': apiKey,
        'Content-Type': 'application/json',
        clienttype: 'binanceSkill'
      },
      body: JSON.stringify({ contentType: 2, bodyTextOnly: post.text, title: post.title })
    });

    const raw = await squareRes.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Binance Square returned non-JSON (${squareRes.status})`); }

    if (squareRes.status === 504) return json(res, 200, { ok: true, status: 'submitted_without_post_id' });
    if (data.code !== '000000') throw new Error(`Binance Square error [${data.code}]: ${data.message}`);

    return json(res, 200, { ok: true, title: post.title, id: data.data?.id ?? null, shareLink: data.data?.shareLink ?? null });
  } catch (error) {
    console.error('Square auto-post failed:', error.message);
    return json(res, 500, { ok: false, error: error.message });
  }
}
