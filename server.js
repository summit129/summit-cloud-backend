const express = require('express');
const cors = require('cors');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

const CMC_API_KEY = '44bfdd5317224b0b8ff8cafbcd3d1267';

// In-memory storage
let cloudFlips = {};
let priceCache = {};
let lastPriceFetch = 0;
const PRICE_CACHE_TTL = 60000;

// ============================================================
// FETCH PRICES SERVER-SIDE FROM COINMARKETCAP
// ============================================================
function fetchCMCPrices(symbols) {
  return new Promise((resolve) => {
    const symbolStr = symbols.join(',');
    const options = {
      hostname: 'pro-api.coinmarketcap.com',
      path: `/v1/cryptocurrency/quotes/latest?symbol=${symbolStr}&convert=USD`,
      method: 'GET',
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = {};
          if (json.data) {
            Object.entries(json.data).forEach(([symbol, info]) => {
              result[symbol] = {
                price: info.quote.USD.price,
                logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${info.id}.png`,
                id: info.id
              };
            });
          }
          resolve(result);
        } catch (e) {
          console.error('CMC parse error:', e);
          resolve({});
        }
      });
    });

    req.on('error', (e) => {
      console.error('CMC request error:', e);
      resolve({});
    });

    req.end();
  });
}

async function refreshPrices() {
  const now = Date.now();
  if (now - lastPriceFetch < PRICE_CACHE_TTL) return;

  const cryptoAssets = Object.values(cloudFlips)
    .filter(f => f.category === 'crypto')
    .map(f => f.asset);

  if (cryptoAssets.length === 0) return;

  const unique = [...new Set(cryptoAssets)];
  console.log(`Fetching prices for: ${unique.join(', ')}`);
  const prices = await fetchCMCPrices(unique);
  priceCache = { ...priceCache, ...prices };
  lastPriceFetch = now;
  console.log(`Prices updated for ${Object.keys(prices).length} assets`);
}

// ============================================================
// WEBHOOK
// ============================================================
app.post('/api/webhook', async (req, res) => {
  try {
    const { asset, timeframe, signal, category } = req.body;

    if (!asset || !timeframe || !signal) {
      return res.status(400).json({ error: 'Missing required fields: asset, timeframe, signal' });
    }

    const key = `${asset.toUpperCase()}_${timeframe.toUpperCase()}`;
    cloudFlips[key] = {
      asset: asset.toUpperCase(),
      timeframe: timeframe.toUpperCase(),
      signal: signal.toUpperCase(),
      category: category || detectCategory(asset),
      timestamp: new Date().toISOString(),
    };

    lastPriceFetch = 0;
    console.log(`Flip received: ${asset} ${timeframe} -> ${signal}`);
    res.json({ success: true, data: cloudFlips[key] });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GET all cloud flips with prices
// ============================================================
app.get('/api/cloud-flips', async (req, res) => {
  await refreshPrices();

  const flips = Object.values(cloudFlips).map(flip => ({
    ...flip,
    price: priceCache[flip.asset]?.price || null,
    logo: priceCache[flip.asset]?.logo || null,
  }));

  res.json({ success: true, count: flips.length, data: flips });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'Summit Cloud Scanner API running',
    flips: Object.keys(cloudFlips).length,
    prices_cached: Object.keys(priceCache).length
  });
});

// ============================================================
// AUTO-DETECT CATEGORY
// ============================================================
function detectCategory(asset) {
  const crypto = ['BTC','ETH','SOL','XRP','BNB','ADA','DOGE','AVAX','DOT','MATIC','LINK','UNI','ATOM','LTC','BCH','XLM','ALGO','NEAR','TAO','RENDER','RNDR','FET','OCEAN','GRT','HYPE','FLOKI','BONK','TRX','EOS','XTZ','AAVE','CRV','SNX','MKR','COMP','ICP','FIL','HBAR','VET','THETA','AXS','SAND','MANA','CHZ','GALA','CRO'];
  const commodity = ['XAUUSD','XAGUSD','GOLD','SILVER','USOIL','UKOIL','WTI','BRENT','NATGAS','COPPER','PLATINUM','PALLADIUM','WHEAT','CORN','SOYBEAN','COFFEE','SUGAR','COTTON'];
  const stock = ['AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','TSLA','META','NFLX','AMD','INTC','QCOM','AVGO','ENPH','FSLR','COIN','MSTR','RIOT','MARA','SPY','QQQ','GLD','SLV'];

  const u = asset.toUpperCase();
  if (crypto.includes(u)) return 'crypto';
  if (commodity.includes(u)) return 'commodity';
  if (stock.includes(u)) return 'stock';
  return 'crypto';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Summit Cloud Scanner API running on port ${PORT}`));
