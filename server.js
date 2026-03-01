const express = require('express');
const cors = require('cors');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

const CMC_API_KEY = '44bfdd5317224b0b8ff8cafbcd3d1267';
const WHOP_CLIENT_ID = process.env.WHOP_CLIENT_ID;
const WHOP_CLIENT_SECRET = process.env.WHOP_CLIENT_SECRET;
const WHOP_REDIRECT_URI = process.env.WHOP_REDIRECT_URI;
const WHOP_API_KEY = process.env.WHOP_API_KEY;
const WHOP_PRODUCT_ID = process.env.WHOP_PRODUCT_ID || 'prod_9DXnVAvaSKOLT';

let cloudFlips = {};
let priceCache = {};
let lastPriceFetch = 0;
const PRICE_CACHE_TTL = 60000;

// ============================================================
// WHOP OAUTH
// ============================================================
app.get('/auth/whop', (req, res) => {
  const params = new URLSearchParams({
    client_id: WHOP_CLIENT_ID,
    redirect_uri: WHOP_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid'
  });
  res.redirect(`https://whop.com/oauth?${params.toString()}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('https://summitmarkets.net/indicator');

  try {
    // Exchange code for access token
    const tokenData = await whopPost('/oauth/token', {
      code,
      client_id: WHOP_CLIENT_ID,
      client_secret: WHOP_CLIENT_SECRET,
      redirect_uri: WHOP_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    if (!tokenData.access_token) {
      return res.redirect('https://summitmarkets.net/indicator');
    }

    // Get user info
    const userInfo = await whopGet('/api/v5/me', tokenData.access_token);
    const userId = userInfo?.id;

    if (!userId) return res.redirect('https://summitmarkets.net/indicator');

    // Check if user has valid membership for Summit Cloud Indicator
    const memberships = await whopGet(`/api/v5/me/memberships?product_id=${WHOP_PRODUCT_ID}&status=active`, tokenData.access_token);
    const hasAccess = memberships?.data?.length > 0;

    if (hasAccess) {
      const sessionToken = Buffer.from(`${Date.now()}:${userId}:verified`).toString('base64');
      return res.redirect(`https://summitcloudscanner.netlify.app?token=${sessionToken}&verified=true`);
    } else {
      return res.redirect('https://summitmarkets.net/indicator');
    }
  } catch (err) {
    console.error('Auth error:', err.message);
    res.redirect('https://summitmarkets.net/indicator');
  }
});

app.get('/auth/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ verified: false });
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [timestamp, userId, status] = decoded.split(':');
    const age = Date.now() - parseInt(timestamp);
    if (age < 86400000 && status === 'verified') {
      return res.json({ verified: true });
    }
  } catch(e) {}
  res.json({ verified: false });
});

// Whop API helpers
function whopPost(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'api.whop.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function whopGet(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.whop.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token || WHOP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ============================================================
// LOGO MAPS
// ============================================================
// Use Clearbit Logo API - more reliable than Wikipedia
const stockLogoMap = {
  'AAPL':'https://logo.clearbit.com/apple.com',
  'MSFT':'https://logo.clearbit.com/microsoft.com',
  'GOOGL':'https://logo.clearbit.com/google.com',
  'GOOG':'https://logo.clearbit.com/google.com',
  'AMZN':'https://logo.clearbit.com/amazon.com',
  'NVDA':'https://logo.clearbit.com/nvidia.com',
  'TSLA':'https://logo.clearbit.com/tesla.com',
  'META':'https://logo.clearbit.com/meta.com',
  'NFLX':'https://logo.clearbit.com/netflix.com',
  'AMD':'https://logo.clearbit.com/amd.com',
  'COIN':'https://logo.clearbit.com/coinbase.com',
  'MSTR':'https://logo.clearbit.com/microstrategy.com',
  'PYPL':'https://logo.clearbit.com/paypal.com',
  'PLTR':'https://logo.clearbit.com/palantir.com',
  'RIOT':'https://logo.clearbit.com/riotplatforms.com',
  'V':'https://logo.clearbit.com/visa.com',
  'MA':'https://logo.clearbit.com/mastercard.com',
};

// Use simple icon URLs for commodities
const commodityLogoMap = {
  'XAUUSD':'https://img.icons8.com/fluency/96/000000/gold-bars.png',
  'GOLD':'https://img.icons8.com/fluency/96/000000/gold-bars.png',
  'XAGUSD':'https://img.icons8.com/fluency/96/000000/silver.png',
  'SILVER':'https://img.icons8.com/fluency/96/000000/silver.png',
  'USOIL':'https://img.icons8.com/fluency/96/000000/oil-industry.png',
  'WTI':'https://img.icons8.com/fluency/96/000000/oil-industry.png',
  'NATGAS':'https://img.icons8.com/fluency/96/000000/gas.png',
  'COPPER':'https://img.icons8.com/fluency/96/000000/copper.png',
  'WHEAT':'https://img.icons8.com/fluency/96/000000/wheat.png',
  'CORN':'https://img.icons8.com/fluency/96/000000/corn.png',
  'COFFEE':'https://img.icons8.com/fluency/96/000000/coffee-beans.png',
};

const commodityYahooMap = {
  'XAUUSD':'GC=F','GOLD':'GC=F','XAGUSD':'SI=F','SILVER':'SI=F',
  'USOIL':'CL=F','WTI':'CL=F','UKOIL':'BZ=F','BRENT':'BZ=F',
  'NATGAS':'NG=F','COPPER':'HG=F','PLATINUM':'PL=F','PALLADIUM':'PA=F',
  'WHEAT':'ZW=F','CORN':'ZC=F','SOYBEAN':'ZS=F','COFFEE':'KC=F','SUGAR':'SB=F'
};

// ============================================================
// PRICE FETCHING
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
                result[symbol] = { price: item.quote.USD.price, logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${item.id}.png` };
              }
            });
          }
          resolve(result);
        } catch(e) { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.end();
  });
}

function fetchYahooPrice(symbol) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)?.chart?.result?.[0]?.meta?.regularMarketPrice || null); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function refreshPrices() {
  const now = Date.now();
  if (now - lastPriceFetch < PRICE_CACHE_TTL) return;
  const flips = Object.values(cloudFlips);
  const crypto = [...new Set(flips.filter(f => f.category === 'crypto').map(f => f.asset))];
  const stocks = [...new Set(flips.filter(f => f.category === 'stock').map(f => f.asset))];
  const comms  = [...new Set(flips.filter(f => f.category === 'commodity').map(f => f.asset))];
  if (crypto.length) Object.assign(priceCache, await fetchCMCPrices(crypto));
  for (const a of stocks) priceCache[a] = { price: await fetchYahooPrice(a), logo: stockLogoMap[a] || null };
  for (const a of comms)  priceCache[a] = { price: await fetchYahooPrice(commodityYahooMap[a] || a), logo: commodityLogoMap[a] || null };
  lastPriceFetch = now;
}

// ============================================================
// WEBHOOK + SCANNER ENDPOINTS
// ============================================================
app.post('/api/webhook', async (req, res) => {
  try {
    const { asset, timeframe, signal, category } = req.body;
    if (!asset || !timeframe || !signal) return res.status(400).json({ error: 'Missing fields' });
    const key = `${asset.toUpperCase()}_${timeframe.toUpperCase()}`;
    cloudFlips[key] = { asset: asset.toUpperCase(), timeframe: timeframe.toUpperCase(), signal: signal.toUpperCase(), category: category || detectCategory(asset), timestamp: new Date().toISOString() };
    lastPriceFetch = 0;
    console.log(`Flip: ${asset} ${timeframe} -> ${signal}`);
    res.json({ success: true, data: cloudFlips[key] });
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/cloud-flips', async (req, res) => {
  await refreshPrices();
  const flips = Object.values(cloudFlips).map(f => ({ ...f, price: priceCache[f.asset]?.price || null, logo: priceCache[f.asset]?.logo || null }));
  res.json({ success: true, count: flips.length, data: flips });
});

app.get('/', (req, res) => res.json({ status: 'Summit Cloud Scanner API running', flips: Object.keys(cloudFlips).length }));

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
