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
// STOCK LOGOS - using Wikipedia hosted images (no hotlink block)
// ============================================================
const stockLogoMap = {
  'AAPL':  'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/64px-Apple_logo_black.svg.png',
  'MSFT':  'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/64px-Microsoft_logo.svg.png',
  'GOOGL': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Google_2015_logo.svg/64px-Google_2015_logo.svg.png',
  'GOOG':  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Google_2015_logo.svg/64px-Google_2015_logo.svg.png',
  'AMZN':  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Amazon_logo.svg/64px-Amazon_logo.svg.png',
  'NVDA':  'https://upload.wikimedia.org/wikipedia/en/thumb/6/6d/Nvidia_image_logo.svg/64px-Nvidia_image_logo.svg.png',
  'TSLA':  'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Tesla_logo.png/64px-Tesla_logo.png',
  'META':  'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Meta_Platforms_Inc._logo.svg/64px-Meta_Platforms_Inc._logo.svg.png',
  'NFLX':  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/64px-Netflix_2015_logo.svg.png',
  'AMD':   'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/AMD_Logo.svg/64px-AMD_Logo.svg.png',
  'INTC':  'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Intel_logo_%282006-2020%29.svg/64px-Intel_logo_%282006-2020%29.svg.png',
  'QCOM':  'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Qualcomm-Logo.svg/64px-Qualcomm-Logo.svg.png',
  'COIN':  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Coinbase_logo.svg/64px-Coinbase_logo.svg.png',
  'MSTR':  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/MicroStrategy_logo_%282022%29.svg/64px-MicroStrategy_logo_%282022%29.svg.png',
  'TSLA':  'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Tesla_logo.png/64px-Tesla_logo.png',
  'PYPL':  'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/PayPal.svg/64px-PayPal.svg.png',
  'SHOP':  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Shopify_logo_2018.svg/64px-Shopify_logo_2018.svg.png',
  'PLTR':  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Palantir_Technologies_logo.svg/64px-Palantir_Technologies_logo.svg.png',
  'ENPH':  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Enphase_Energy_logo.svg/64px-Enphase_Energy_logo.svg.png',
  'RIOT':  'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Riot_Platforms_logo.svg/64px-Riot_Platforms_logo.svg.png',
  'MARA':  'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Marathon_Digital_Holdings_logo.svg/64px-Marathon_Digital_Holdings_logo.svg.png',
  'DIS':   'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Disney%2B_logo.svg/64px-Disney%2B_logo.svg.png',
  'BA':    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Boeing_full_logo.svg/64px-Boeing_full_logo.svg.png',
  'JPM':   'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/J_P_Morgan_Logo_2008_1.svg/64px-J_P_Morgan_Logo_2008_1.svg.png',
  'V':     'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Visa_Inc._logo.svg/64px-Visa_Inc._logo.svg.png',
  'MA':    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/MasterCard_Logo.svg/64px-MasterCard_Logo.svg.png',
  'SPY':   'https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/S%26P_500_Index_-_90_Year_Historical_Chart.png/64px-S%26P_500_Index_-_90_Year_Historical_Chart.png',
};

// ============================================================
// COMMODITY LOGOS - Wikipedia hosted
// ============================================================
const commodityLogoMap = {
  'XAUUSD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Gold-crystals.jpg/64px-Gold-crystals.jpg',
  'GOLD':   'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Gold-crystals.jpg/64px-Gold-crystals.jpg',
  'XAGUSD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Silver_crystal.jpg/64px-Silver_crystal.jpg',
  'SILVER': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Silver_crystal.jpg/64px-Silver_crystal.jpg',
  'USOIL':  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Oil_platform_P-51_%28Brazil%29.jpg/64px-Oil_platform_P-51_%28Brazil%29.jpg',
  'WTI':    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Oil_platform_P-51_%28Brazil%29.jpg/64px-Oil_platform_P-51_%28Brazil%29.jpg',
  'UKOIL':  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Oil_platform_P-51_%28Brazil%29.jpg/64px-Oil_platform_P-51_%28Brazil%29.jpg',
  'BRENT':  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Oil_platform_P-51_%28Brazil%29.jpg/64px-Oil_platform_P-51_%28Brazil%29.jpg',
  'NATGAS': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Thalys_Brussels_Midi_DSC_0353.jpg/64px-Thalys_Brussels_Midi_DSC_0353.jpg',
  'COPPER': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/NatCopper.jpg/64px-NatCopper.jpg',
  'PLATINUM': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Platinum_crystals.jpg/64px-Platinum_crystals.jpg',
  'WHEAT':  'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Wheat_close-up.JPG/64px-Wheat_close-up.JPG',
  'CORN':   'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Corncobs.jpg/64px-Corncobs.jpg',
  'COFFEE': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Roasted_coffee_beans.jpg/64px-Roasted_coffee_beans.jpg',
};

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
// CMC - crypto prices + logos
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
              const item = Array.isArray(info) ? info[0] : info;
              if (item?.quote?.USD?.price) {
                result[symbol] = {
                  price: item.quote.USD.price,
                  logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${item.id}.png`
                };
              }
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
// YAHOO FINANCE - stock + commodity prices
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
          resolve(json?.chart?.result?.[0]?.meta?.regularMarketPrice || null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
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
  const cryptoAssets  = [...new Set(flips.filter(f => f.category === 'crypto').map(f => f.asset))];
  const stockAssets   = [...new Set(flips.filter(f => f.category === 'stock').map(f => f.asset))];
  const commAssets    = [...new Set(flips.filter(f => f.category === 'commodity').map(f => f.asset))];

  if (cryptoAssets.length > 0) {
    const prices = await fetchCMCPrices(cryptoAssets);
    Object.assign(priceCache, prices);
  }

  for (const asset of stockAssets) {
    const price = await fetchYahooPrice(asset);
    priceCache[asset] = { price, logo: stockLogoMap[asset] || null };
  }

  for (const asset of commAssets) {
    const yahooSym = commodityYahooMap[asset] || asset;
    const price = await fetchYahooPrice(yahooSym);
    priceCache[asset] = { price, logo: commodityLogoMap[asset] || null };
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
  const stock = ['AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','TSLA','META','NFLX','AMD','INTC','QCOM','AVGO','ENPH','FSLR','COIN','MSTR','RIOT','MARA','SPY','QQQ'];
  const u = asset.toUpperCase();
  if (commodity.includes(u)) return 'commodity';
  if (stock.includes(u)) return 'stock';
  return 'crypto';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Summit Cloud Scanner API running on port ${PORT}`));
