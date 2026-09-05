module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(503).json({ error: 'Telegram is not configured' });
  }

  try {
    const body = req.body || {};
    const symbol = body.symbol || 'UNKNOWN';
    const signal = body.signal || 'SIGNAL';
    const score = Number(body.score || 0);
    const change = Number(body.change || 0);
    const volumeSpike = body.volumeSpike || 0;
    const trend5 = body.trend5 || 'WAIT';
    const trend15 = body.trend15 || 'WAIT';

    const icon = signal === 'PUMP' || signal === 'BUY' ? '🟢' : '🔴';
    const text = [
      '⚡ Delta Scanner Alert',
      '',
      `${icon} ${signal}: ${symbol}`,
      `Strength: ${score}/100`,
      `24H Change: ${change.toFixed(2)}%`,
      `Volume Spike: ${volumeSpike}x`,
      `5m Trend: ${trend5}`,
      `15m Trend: ${trend15}`,
      '',
      '⚠️ Informational signal only — no real order.'
    ].join('\n');

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text })
      }
    );

    const data = await telegramResponse.json();

    if (!telegramResponse.ok || !data.ok) {
      return res.status(502).json({ error: 'Telegram send failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
};
