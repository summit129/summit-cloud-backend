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
// TRADINGVIEW LOGO MAP - stocks & commodities
// ============================================================
const tvLogoMap = {
  // Stocks
  'AAPL':  'apple', 'MSFT': 'microsoft', 'GOOGL': 'alphabet', 'GOOG': 'alphabet',
  'AMZN':  'amazon', 'NVDA': 'nvidia', 'TSLA': 'tesla', 'META': 'meta-platforms',
  'NFLX':  'netflix', 'AMD': 'advanced-micro-devices', 'INTC': 'intel',
  'QCOM':  'qualcomm', 'AVGO': 'broadcom', 'ENPH': 'enphase-energy',
  'FSLR':  'first-solar', 'COIN': 'coinbase', 'MSTR': 'microstrategy',
  'RIOT':  'riot-platforms', 'MARA': 'marathon-digital',
  'SPY':   'spdr-sp-500-etf-trust', 'QQQ': 'invesco-qqq-trust',
  'PYPL':  'paypal', 'SHOP': 'shopify', 'UBER': 'uber',
  'PLTR':  'palantir-technologies', 'SNOW': 'snowflake', 'CRM': 'salesforce',
  'ORCL':  'oracle', 'IBM': 'ibm', 'CSCO': 'cisco',
  'DIS':   'walt-disney', 'BA': 'boeing', 'JPM': 'jpmorgan-chase',
  'BAC':   'bank-of-america', 'GS': 'goldman-sachs', 'V': 'visa', 'MA': 'mastercard',
  'ABNB':  'airbnb', 'SQ': 'block', 'BABA': 'alibaba', 'NIO': 'nio',
  // Commodities
  'XAUUSD': 'gold', 'GOLD': 'gold',
  'XAGUSD': 'silver', 'SILVER': 'silver',
  'USOIL':  'crude-oil', 'WTI': 'crude-oil', 'UKOIL': 'crude-oil', 'BRENT': 'crude-oil',
  'NATGAS': 'natural-gas', 'COPPER': 'copper',
  'PLATINUM': 'platinum', 'PALLADIUM': 'palladium',
  'WHEAT':  'wheat', 'CORN': 'corn', 'COFFEE': 'coffee',
};

function getAssetLogo(ticker, category) {
  if (category === 'crypto') return null; // handled by CMC
  const slug = tvLogoMap[ticker.toUpperCase()];
  if (slug) return `https://s3-symbol-logo.tradingview.com/${slug}--big.svg`;
  return null;
}

// ============================================================
// COMMODITY YAHOO MAP
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
// CMC CRYPTO PRICES + LOGOS
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
  const stockAssets  = [...new Set(flips.filter(f => f.category === 'stock').map(f => f.asset))];
  const commAssets   = [...new Set(flips.filter(f => f.category === 'commodity').map(f => f.asset))];

  if (cryptoAssets.length > 0) {
    const prices = await fetchCMCPrices(cryptoAssets);
    Object.assign(priceCache, prices);
  }

  for (const asset of stockAssets) {
    const price = await fetchYahooPrice(asset);
    priceCache[asset] = { price, logo: getAssetLogo(asset, 'stock') };
  }

  for (const asset of commAssets) {
    const yahooSym = commodityYahooMap[asset] || asset;
    const price = await fetchYahooPrice(yahooSym);
    priceCache[asset] = { price, logo: getAssetLogo(asset, 'commodity') };
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
