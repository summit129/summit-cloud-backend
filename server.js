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
// Use LogoKit API for stock logos
const stockLogoMap = {
  'AAPL':'https://img.logokit.com/ticker/AAPL?token=pk_fr136f186b6c9a0d5011cb',
  'MSFT':'https://img.logokit.com/ticker/MSFT?token=pk_fr136f186b6c9a0d5011cb',
  'GOOGL':'https://img.logokit.com/ticker/GOOGL?token=pk_fr136f186b6c9a0d5011cb',
  'GOOG':'https://img.logokit.com/ticker/GOOG?token=pk_fr136f186b6c9a0d5011cb',
  'AMZN':'https://img.logokit.com/ticker/AMZN?token=pk_fr136f186b6c9a0d5011cb',
  'NVDA':'https://img.logokit.com/ticker/NVDA?token=pk_fr136f186b6c9a0d5011cb',
  'TSLA':'https://img.logokit.com/ticker/TSLA?token=pk_fr136f186b6c9a0d5011cb',
  'META':'https://img.logokit.com/ticker/META?token=pk_fr136f186b6c9a0d5011cb',
  'NFLX':'https://img.logokit.com/ticker/NFLX?token=pk_fr136f186b6c9a0d5011cb',
  'AMD':'https://img.logokit.com/ticker/AMD?token=pk_fr136f186b6c9a0d5011cb',
  'COIN':'https://img.logokit.com/ticker/COIN?token=pk_fr136f186b6c9a0d5011cb',
  'MSTR':'https://img.logokit.com/ticker/MSTR?token=pk_fr136f186b6c9a0d5011cb',
  'PYPL':'https://img.logokit.com/ticker/PYPL?token=pk_fr136f186b6c9a0d5011cb',
  'PLTR':'https://img.logokit.com/ticker/PLTR?token=pk_fr136f186b6c9a0d5011cb',
  'RIOT':'https://img.logokit.com/ticker/RIOT?token=pk_fr136f186b6c9a0d5011cb',
  'V':'https://img.logokit.com/ticker/V?token=pk_fr136f186b6c9a0d5011cb',
  'MA':'https://img.logokit.com/ticker/MA?token=pk_fr136f186b6c9a0d5011cb',
};

// Commodity icons - using emojis as data URIs for reliability
const commodityLogoMap = {
  'XAUUSD':'https://api.dicebear.com/7.x/icons/svg?icon=currency&backgroundColor=F5B942&size=64',
  'GOLD':'https://api.dicebear.com/7.x/icons/svg?icon=currency&backgroundColor=F5B942&size=64',
  'XAGUSD':'https://api.dicebear.com/7.x/icons/svg?icon=currency&backgroundColor=C0C0C0&size=64',
  'SILVER':'https://api.dicebear.com/7.x/icons/svg?icon=currency&backgroundColor=C0C0C0&size=64',
  'USOIL':'https://api.dicebear.com/7.x/icons/svg?icon=droplet&backgroundColor=1a1a1a&size=64',
  'WTI':'https://api.dicebear.com/7.x/icons/svg?icon=droplet&backgroundColor=1a1a1a&size=64',
  'NATGAS':'https://api.dicebear.com/7.x/icons/svg?icon=flame&backgroundColor=FF6B35&size=64',
  'COPPER':'https://api.dicebear.com/7.x/icons/svg?icon=hexagon&backgroundColor=B87333&size=64',
  'WHEAT':'https://api.dicebear.com/7.x/icons/svg?icon=leaf&backgroundColor=DEB887&size=64',
  'CORN':'https://api.dicebear.com/7.x/icons/svg?icon=leaf&backgroundColor=FFD700&size=64',
  'COFFEE':'https://api.dicebear.com/7.x/icons/svg?icon=cup&backgroundColor=6F4E37&size=64',
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
  for (const a of stocks) priceCache[a] = { price: await fetchYahooPrice(a), logo: `https://img.logokit.com/ticker/${a}?token=pk_fr136f186b6c9a0d5011cb` };
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
