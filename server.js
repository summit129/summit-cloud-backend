const express = require('express');
const cors = require('cors');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

const CMC_API_KEY = '44bfdd5317224b0b8ff8cafbcd3d1267';

let cloudFlips = {};
let priceCache = {};
let lastPriceFetch = 0;
const PRICE_CACHE_TTL = 60000;

// ============================================================
// COMMODITY MAPS
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

// Using Wikipedia/Wikimedia commons SVGs - reliable, free, no API key
const commodityLogos = {
  'XAUUSD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Gold-crystals.jpg/240px-Gold-crystals.jpg',
  'GOLD':   'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Gold-crystals.jpg/240px-Gold-crystals.jpg',
  'XAGUSD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Silver_crystal.jpg/240px-Silver_crystal.jpg',
  'SILVER': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Silver_crystal.jpg/240px-Silver_crystal.jpg',
  'USOIL':  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Oil_well.jpg/240px-Oil_well.jpg',
  'WTI':    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Oil_well.jpg/240px-Oil_well.jpg',
  'UKOIL':  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Oil_well.jpg/240px-Oil_well.jpg',
  'BRENT':  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Oil_well.jpg/240px-Oil_well.jpg',
  'NATGAS': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Natural_gas_flame.jpg/240px-Natural_gas_flame.jpg',
  'COPPER': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/NatCopper.jpg/240px-NatCopper.jpg',
  'PLATINUM': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Platinum_crystals.jpg/240px-Platinum_crystals.jpg',
  'WHEAT':  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/240px-Camponotus_flavomarginatus_ant.jpg',
  'CORN':   'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/240px-Camponotus_flavomarginatus_ant.jpg',
};

// ============================================================
// STOCK LOGO - Financial Modeling Prep (free, no key needed)
// ============================================================
function getStockLogo(ticker) {
  return `https://financialmodelingprep.com/image-stock/${ticker.toUpperCase()}.png`;
}

// ============================================================
// YAHOO FINANCE PRICE
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
        } catch (e) { resolve(null); }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ============================================================
// CMC CRYPTO PRICES
// ============================================================
function fetchCMCPrices(symbols) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'pro-api.coinmarketcap.com',
      path: `/v1/cryptocurrency/quotes/latest?symbol=${symbols.join(',')}&convert=USD`,
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

  if (cryptoAssets.length > 0) {
    const prices = await fetchCMCPrices(cryptoAssets);
    Object.assign(priceCache, prices);
  }

  for (const asset of stockAssets) {
    const price = await fetchYahooPrice(asset);
    priceCache[asset] = { price, logo: getStockLogo(asset) };
  }

  for (const asset of commodityAssets) {
    const yahooSym = commodityYahooMap[asset] || asset;
    const price = await fetchYahooPrice(yahooSym);
    priceCache[asset] = { price, logo: commodityLogos[asset] || null };
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
// GET FLIPS
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
  const commodity = ['XAUUSD','XAGUSD','GOLD','SILVER','USOIL','UKOIL','WTI','BRENT','NATGAS','COPPER','PLATINUM','PALLADIUM','WHEAT','CORN','SOYBEAN','COFFEE','SUGAR','COTTON'];
  const stock = ['AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','TSLA','META','NFLX','AMD','INTC','QCOM','AVGO','ENPH','FSLR','COIN','MSTR','RIOT','MARA','SPY','QQQ','GLD','SLV'];
  const u = asset.toUpperCase();
  if (commodity.includes(u)) return 'commodity';
  if (stock.includes(u)) return 'stock';
  return 'crypto';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Summit Cloud Scanner API running on port ${PORT}`));
