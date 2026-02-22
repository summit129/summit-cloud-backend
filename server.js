const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// In-memory storage for cloud flips
// Structure: { "BTC_1D": { asset, timeframe, signal, category, timestamp } }
let cloudFlips = {};

// Webhook endpoint - receives TradingView alerts
app.post('/api/webhook', (req, res) => {
  try {
    const { asset, timeframe, signal, category } = req.body;

    if (!asset || !timeframe || !signal) {
      return res.status(400).json({ error: 'Missing required fields: asset, timeframe, signal' });
    }

    const key = `${asset.toUpperCase()}_${timeframe.toUpperCase()}`;
    cloudFlips[key] = {
      asset: asset.toUpperCase(),
      timeframe: timeframe.toUpperCase(),
      signal: signal.toUpperCase(), // BULL or BEAR
      category: category || detectCategory(asset),
      timestamp: new Date().toISOString(),
    };

    console.log(`✅ Flip received: ${asset} ${timeframe} → ${signal}`);
    res.json({ success: true, data: cloudFlips[key] });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET all cloud flips
app.get('/api/cloud-flips', (req, res) => {
  const flips = Object.values(cloudFlips);
  res.json({ success: true, count: flips.length, data: flips });
});

// GET flips filtered by category
app.get('/api/cloud-flips/:category', (req, res) => {
  const { category } = req.params;
  const flips = Object.values(cloudFlips).filter(
    f => f.category.toLowerCase() === category.toLowerCase()
  );
  res.json({ success: true, count: flips.length, data: flips });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Summit Cloud Scanner API is running', flips: Object.keys(cloudFlips).length });
});

// Auto-detect category based on known assets
function detectCategory(asset) {
  const crypto = ['BTC','ETH','SOL','XRP','BNB','ADA','DOGE','AVAX','DOT','MATIC','LINK','UNI','ATOM','LTC','BCH','XLM','ALGO','VET','ICP','FIL','HBAR','EGLD','THETA','AXS','SAND','MANA','ENJ','CHZ','GALA','CRO','FTT','NEAR','ONE','HARMONY','ZIL','HOT','BTT','WIN','TRX','EOS','XTZ','CAKE','SUSHI','AAVE','COMP','MKR','SNX','YFI','CRV','BAL','REN','KNC','ZRX','BAT','GRT','LRC','OMG','ZEC','DASH','XMR','DCR','WAVES','QTUM','ONT','ZEN','SC','DGB','RVN','XEM','STMX','DENT','MTL','OGN','NKN','ARDR','STRAT','ARK','NAV','SYS','PIVX','GRS','MONA','FUN','TNT','REP','STORJ','MITH','LOOM','POWR','BNT','MANA','ANT','MLN','NMR','TKN','PAX','TUSD','USDC','DAI','USDT','BUSD','USDP','FRAX','LUSD','MIM','USTC','SUSD','GUSD','HUSD','OUSD','USDX','CUSD','MUSD','NUSD','PUSD','RUSD','ZUSD','WBTC','RENBTC','HBTC','TBTC','SBTC','PBTC','BBTC','OBTC','MBTC','NBTC','FBTC','TAO','RENDER','RNDR','FET','OCEAN','AGI','NMR','GRT','HYPE','FLOKI','BONK'],
    commodity = ['XAUUSD','XAGUSD','GOLD','SILVER','USOIL','UKOIL','WTI','BRENT','NATGAS','COPPER','PLATINUM','PALLADIUM','WHEAT','CORN','SOYBEAN','COFFEE','SUGAR','COTTON'],
    stock = ['AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','TSLA','META','NFLX','AMD','INTC','QCOM','AVGO','TXN','MU','ENPH','FSLR','SEDG','RUN','SPWR','CSCO','IBM','ORCL','SAP','CRM','SNOW','PLTR','COIN','MSTR','RIOT','MARA','HUT','BTBT','CIFR','SPY','QQQ','IWM','DIA','GLD','SLV','USO','XLE','XLF','XLK','ARKK'];

  const u = asset.toUpperCase();
  if (crypto.includes(u)) return 'crypto';
  if (commodity.includes(u)) return 'commodity';
  if (stock.includes(u)) return 'stock';
  return 'crypto'; // default
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Summit Cloud Scanner API running on port ${PORT}`));
