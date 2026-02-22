const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const app = express();

app.use(cors());
app.use(express.json());

const CMC_API_KEY = '44bfdd5317224b0b8ff8cafbcd3d1267';

let cloudFlips = {};
let priceCache = {};
let lastPriceFetch = 0;
const PRICE_CACHE_TTL = 60000;

// ============================================================
// COMMODITY SYMBOL MAP - TradingView -> Yahoo Finance
// ============================================================
const commodityYahooMap = {
  'XAUUSD': 'GC=F', 'GOLD': 'GC=F',
  'XAGUSD': 'SI=F', 'SILVER': 'SI=F',
  'USOIL': 'CL=F', 'WTI': 'CL=F', 'UKOIL': 'BZ=F', 'BRENT': 'BZ=F',
  'NATGAS': 'NG=F', 'COPPER': 'HG=F',
  'PLATINUM': 'PL=F', 'PALLADIUM': 'PA=F',
  'WHEAT': 'ZW=F', 'CORN': 'ZC=F', 'SOYBEAN': 'ZS=F',
  'COFFEE': 'KC=F', 'SUGAR': 'SB=F', 'COTTON': 'CT=F'
};

const commodityLogos = {
  'XAUUSD': 'https://cdn-icons-png.flaticon.com/512/2933/2933245.png',
  'GOLD': 'https://cdn-icons-png.flaticon.com/512/2933/2933245.png',
  'XAGUSD': 'https://cdn-icons-png.flaticon.com/512/2933/2933246.png',
  'SILVER': 'https://cdn-icons-png.flaticon.com/512/2933/2933246.png',
  'USOIL': 'https://cdn-icons-png.flaticon.com/512/3437/3437364.png',
  'WTI': 'https://cdn-icons-png.flaticon.com/512/3437/3437364.png',
  'UKOIL': 'https://cdn-icons-png.flaticon.com/512/3437/3437364.png',
  'BRENT': 'https://cdn-icons-png.flaticon.com/512/3437/3437364.png',
  'NATGAS': 'https://cdn-icons-png.flaticon.com/512/3437/3437364.png',
  'COPPER': 'https://cdn-icons-png.flaticon.com/512/2933/2933247.png',
};

// ============================================================
// FETCH SINGLE YAHOO FINANCE PRICE
// ============================================================
function fetchYahooPrice(yahooSymbol) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
          resolve(price || null);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ============================================================
// FETCH CMC CRYPTO PRICES
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
                logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${info.id}.png`
              };
            });
          }
          resolve(result);
        } catch (e) { resolve({}); }
      });
    });

    req.on('error', () => resolve({}));
    req.end();
  });
}

// ============================================================
// REFRESH ALL PRICES
// ============================================================
async function refreshPrices() {
  const now = Date.now();
  if (now - lastPriceFetch < PRICE_CACHE_TTL) return;

  const flips = Object.values(cloudFlips);
  const cryptoAssets = [...new Set(flips.filter(f => f.category === 'crypto').map(f => f.asset))];
  const stockAssets = [...new Set(flips.filter(f => f.category === 'stock').map(f => f.asset))];
  const commodityAssets = [...new Set(flips.filter(f => f.category === 'commodity').map(f => f.asset))];

  // Crypto via CMC
  if (cryptoAssets.length > 0) {
    const cryptoPrices = await fetchCMCPrices(cryptoAssets);
    Object.assign(priceCache, cryptoPrices);
  }

  // Stocks via Yahoo Finance + logo.dev
  for (const asset of stockAssets) {
    const price = await fetchYahooPrice(asset);
    priceCache[asset] = {
      price,
      logo: `https://img.logo.dev/ticker/${asset.toLowerCase()}?token=pk_JDFSa_5jQwKbFu0HZDG6og`
    };
  }

  // Commodities via Yahoo Finance
  for (const asset of commodityAssets) {
    const yahooSym = commodityYahooMap[asset] || asset;
    const price = await fetchYahooPrice(yahooSym);
    priceCache[asset] = {
      price,
      logo: commodityLogos[asset] || null
    };
  }

  lastPriceFetch = now;
  console.log(`Prices refreshed: ${Object.keys(priceCache).length} assets`);
}

// ============================================================
// WEBHOOK
// ============================================================
app.post('/api/webhook', async (req, res) => {
  try {
    const { asset, timeframe, signal, category } = req.body;
    if (!asset || !timeframe || !signal) {
      return res.status(400).json({ error: 'Missing required fields' });
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
    console.log(`Flip: ${asset} ${timeframe} -> ${signal}`);
    res.json({ success: true, data: cloudFlips[key] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GET FLIPS WITH PRICES
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

app.get('/', (req, res) => {
  res.json({ status: 'Summit Cloud Scanner API running', flips: Object.keys(cloudFlips).length });
});

// ============================================================
// DETECT CATEGORY
// ============================================================
function detectCategory(asset) {
  const crypto = ['BTC','ETH','SOL','XRP','BNB','ADA','DOGE','AVAX','DOT','MATIC','LINK','UNI','ATOM','LTC','BCH','XLM','ALGO','NEAR','TAO','RENDER','RNDR','FET','OCEAN','GRT','HYPE','FLOKI','BONK','TRX','EOS','XTZ','AAVE','CRV','SNX','MKR','COMP','ICP','FIL','HBAR','VET','THETA','AXS','SAND','MANA','CHZ','GALA','CRO'];
  const commodity = ['XAUUSD','XAGUSD','GOLD','SILVER','USOIL','UKOIL','WTI','BRENT','NATGAS','COPPER','PLATINUM','PALLADIUM','WHEAT','CORN','SOYBEAN','COFFEE','SUGAR','COTTON'];
  const stock = ['AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','TSLA','META','NFLX','AMD','INTC','QCOM','AVGO','ENPH','FSLR','COIN','MSTR','RIOT','MARA','SPY','QQQ','GLD','SLV'];

  const u = asset.toUpperCase();
  if (commodity.includes(u)) return 'commodity';
  if (stock.includes(u)) return 'stock';
  if (crypto.includes(u)) return 'crypto';
  return 'crypto';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Summit Cloud Scanner API running on port ${PORT}`));
