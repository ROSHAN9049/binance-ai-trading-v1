export default async function handler(req,res){
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 const token=process.env.TELEGRAM_BOT_TOKEN; const chatId=process.env.TELEGRAM_CHAT_ID;
 if(!token||!chatId) return res.status(503).json({error:'Telegram is not configured'});
 try{
  const {symbol,signal,score,change,volumeSpike,trend5,trend15}=req.body||{};
  const text=`⚡ Delta Scanner Alert\n\n${signal==='PUMP'?'🟢':'🔴'} ${signal}: ${symbol}\nStrength: ${score}/100\n24H Change: ${Number(change||0).toFixed(2)}%\nVolume Spike: ${volumeSpike||0}x\n5m Trend: ${trend5||'WAIT'}\n15m Trend: ${trend15||'WAIT'}\n\n⚠️ Informational signal only — no real order.`;
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text})});
  const data=await r.json(); if(!r.ok||!data.ok) return res.status(502).json({error:'Telegram send failed'}); return res.status(200).json({ok:true});
 }catch(e){return res.status(500).json({error:'Server error'});}
}
