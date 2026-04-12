/**
 * DNC Flow — Radar Worker (Multi-tenant)
 * Cloudflare Worker · Mercado Livre OAuth + Market Research API
 *
 * Routes:
 *   GET  /health                      → Status
 *   GET  /auth/login?tenant_id=xxx    → Inicia OAuth ML
 *   GET  /auth/callback               → ML redireciona aqui após auth
 *   GET  /auth/status                 → Status de conexão do tenant
 *   POST /auth/revoke                 → Desconecta tenant
 *
 *   GET  /radar/search?q=...          → Busca pública com score de oportunidade
 *   GET  /radar/trends?category=...   → Tendências de busca
 *   GET  /radar/category?id=...       → Detalhes de categoria
 *   GET  /radar/item/:id              → Detalhes de produto
 *   GET  /radar/my/items              → Meus anúncios (auth)
 *   GET  /radar/my/visits             → Visitas de produto (auth)
 *   GET  /radar/my/orders             → Meus pedidos (auth)
 *   GET  /radar/seller?seller_id=...  → Análise de concorrente (auth)
 *
 * Tenant ID: header X-Tenant-ID  ou  query param ?tenant_id=
 * Secrets: ML_APP_ID, ML_APP_SECRET (wrangler secret put)
 * Vars: ALLOWED_ORIGIN, APP_URL, ML_REDIRECT_URI
 * KV Binding: ML_TOKENS
 */

const ML_AUTH_URL  = 'https://auth.mercadolivre.com.br/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API       = 'https://api.mercadolibre.com';
const SITE_ID      = 'MLB';

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    const cors = corsHeaders(env);

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // ── System ──────────────────────────────────────────────────────────────
      if (path === '/health') {
        return json({ status: 'ok', worker: 'dncflow-radar', ts: new Date().toISOString() }, 200, cors);
      }

      // ── Auth ─────────────────────────────────────────────────────────────────
      if (path === '/auth/login')    return handleLogin(request, env, cors);
      if (path === '/auth/callback') return handleCallback(request, env, ctx, cors);
      if (path === '/auth/status')   return handleStatus(request, env, cors);
      if (path === '/auth/revoke')   return handleRevoke(request, env, cors);

      // ── Radar ─────────────────────────────────────────────────────────────────
      if (path.startsWith('/radar/')) return handleRadar(request, env, cors, path);

      return json({ error: 'Rota não encontrada', path }, 404, cors);

    } catch (err) {
      console.error('[Worker Error]', err.message, err.stack);
      return json({ error: err.message || 'Erro interno' }, 500, cors);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

function handleLogin(request, env, cors) {
  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');

  if (!tenantId) return json({ error: 'tenant_id é obrigatório' }, 400, cors);

  const state  = btoa(JSON.stringify({ tenant_id: tenantId, ts: Date.now() }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     env.ML_APP_ID,
    redirect_uri:  env.ML_REDIRECT_URI,
    state,
  });

  return Response.redirect(`${ML_AUTH_URL}?${params}`, 302);
}

async function handleCallback(request, env, ctx, cors) {
  const url   = new URL(request.url);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return json({ error: `ML OAuth error: ${error}` }, 400, cors);
  if (!code || !state) return json({ error: 'code ou state ausentes' }, 400, cors);

  let stateData;
  try { stateData = JSON.parse(atob(state)); }
  catch { return json({ error: 'state inválido' }, 400, cors); }

  const { tenant_id } = stateData;

  // Troca code → tokens
  const tokenRes = await fetch(ML_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     env.ML_APP_ID,
      client_secret: env.ML_APP_SECRET,
      code,
      redirect_uri:  env.ML_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return json({ error: 'Falha na troca de token', detail: err }, 400, cors);
  }

  const tokens = await tokenRes.json();
  // { access_token, token_type, expires_in, scope, user_id, refresh_token }

  const stored = {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    user_id:       tokens.user_id,
    expires_at:    Date.now() + tokens.expires_in * 1000,
    scope:         tokens.scope,
    connected_at:  new Date().toISOString(),
  };

  await env.ML_TOKENS.put(`tenant:${tenant_id}:tokens`, JSON.stringify(stored));

  // Busca perfil e armazena em background
  ctx.waitUntil(fetchAndStoreProfile(tenant_id, tokens.user_id, tokens.access_token, env));

  // Redireciona de volta ao app
  const appUrl = new URL(env.APP_URL || 'https://dnc-flow.pages.dev');
  appUrl.searchParams.set('ml_connected', '1');
  appUrl.searchParams.set('tenant_id', tenant_id);
  return Response.redirect(appUrl.toString(), 302);
}

async function fetchAndStoreProfile(tenantId, userId, accessToken, env) {
  try {
    const res     = await fetch(`${ML_API}/users/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const profile = await res.json();
    await env.ML_TOKENS.put(`tenant:${tenantId}:profile`, JSON.stringify({
      user_id:           profile.id,
      nickname:          profile.nickname,
      site_id:           profile.site_id,
      permalink:         profile.permalink,
      registration_date: profile.registration_date,
      seller_reputation: profile.seller_reputation,
    }));
  } catch (e) {
    console.error('fetchAndStoreProfile error:', e.message);
  }
}

async function handleStatus(request, env, cors) {
  const tenantId = getTenantId(request);
  if (!tenantId) return json({ error: 'tenant_id é obrigatório' }, 400, cors);

  const [tokensRaw, profileRaw] = await Promise.all([
    env.ML_TOKENS.get(`tenant:${tenantId}:tokens`),
    env.ML_TOKENS.get(`tenant:${tenantId}:profile`),
  ]);

  if (!tokensRaw) return json({ connected: false }, 200, cors);

  const tokens  = JSON.parse(tokensRaw);
  const profile = profileRaw ? JSON.parse(profileRaw) : null;
  const isExpired = Date.now() > tokens.expires_at;

  return json({
    connected:    true,
    is_expired:   isExpired,
    expires_at:   new Date(tokens.expires_at).toISOString(),
    connected_at: tokens.connected_at,
    profile,
  }, 200, cors);
}

async function handleRevoke(request, env, cors) {
  const tenantId = getTenantId(request);
  if (!tenantId) return json({ error: 'tenant_id é obrigatório' }, 400, cors);

  await Promise.all([
    env.ML_TOKENS.delete(`tenant:${tenantId}:tokens`),
    env.ML_TOKENS.delete(`tenant:${tenantId}:profile`),
  ]);

  return json({ revoked: true, tenant_id: tenantId }, 200, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function getValidToken(tenantId, env) {
  const raw = await env.ML_TOKENS.get(`tenant:${tenantId}:tokens`);
  if (!raw) throw new Error(`Tenant "${tenantId}" não está autenticado. Acesse /auth/login?tenant_id=${tenantId}`);

  let tokens = JSON.parse(raw);

  // Renova se expirar em menos de 5 minutos
  if (Date.now() > tokens.expires_at - 300_000) {
    tokens = await refreshToken(tenantId, tokens, env);
  }

  return tokens.access_token;
}

async function refreshToken(tenantId, tokens, env) {
  const res = await fetch(ML_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     env.ML_APP_ID,
      client_secret: env.ML_APP_SECRET,
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Falha ao renovar token: ${err}`);
  }

  const newTokens = await res.json();
  const updated   = {
    ...tokens,
    access_token:  newTokens.access_token,
    refresh_token: newTokens.refresh_token || tokens.refresh_token,
    expires_at:    Date.now() + newTokens.expires_in * 1000,
  };

  await env.ML_TOKENS.put(`tenant:${tenantId}:tokens`, JSON.stringify(updated));
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// RADAR ROUTER
// ─────────────────────────────────────────────────────────────────────────────

async function handleRadar(request, env, cors, path) {
  const url      = new URL(request.url);
  const tenantId = getTenantId(request);
  const subpath  = path.replace('/radar', '');

  // Endpoints públicos (sem auth)
  if (subpath === '/search')           return radarSearch(url, cors);
  if (subpath === '/trends')           return radarTrends(url, cors);
  if (subpath === '/category')         return radarCategory(url, cors);
  if (subpath.startsWith('/item/'))    return radarItem(url, cors, subpath);

  // Endpoints autenticados
  if (!tenantId) {
    return json({
      error: 'tenant_id obrigatório para este endpoint',
      hint: 'Envie o header X-Tenant-ID ou query param ?tenant_id=',
    }, 401, cors);
  }

  if (subpath === '/my/items')   return radarMyItems(url, env, cors, tenantId);
  if (subpath === '/my/visits')  return radarMyVisits(url, env, cors, tenantId);
  if (subpath === '/my/orders')  return radarMyOrders(url, env, cors, tenantId);
  if (subpath === '/seller')     return radarSeller(url, env, cors, tenantId);

  return json({ error: 'Endpoint Radar não encontrado', subpath }, 404, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// RADAR — ENDPOINTS PÚBLICOS
// ─────────────────────────────────────────────────────────────────────────────

async function radarSearch(url, cors) {
  const q          = url.searchParams.get('q');
  const categoryId = url.searchParams.get('category');
  const limit      = url.searchParams.get('limit') || '50';
  const offset     = url.searchParams.get('offset') || '0';
  const sort       = url.searchParams.get('sort') || 'relevance';
  const priceMin   = url.searchParams.get('price_min');
  const priceMax   = url.searchParams.get('price_max');
  const condition  = url.searchParams.get('condition'); // new | used

  if (!q && !categoryId) {
    return json({ error: 'Informe q (busca) ou category (ID de categoria)' }, 400, cors);
  }

  const params = new URLSearchParams({ limit, offset, sort });
  if (q)          params.set('q', q);
  if (categoryId) params.set('category', categoryId);
  if (priceMin)   params.set('price_from', priceMin);
  if (priceMax)   params.set('price_to', priceMax);
  if (condition)  params.set('condition', condition);

  const res  = await fetch(`${ML_API}/sites/${SITE_ID}/search?${params}`);
  const data = await res.json();

  if (!res.ok) return json({ error: 'Erro na API ML', detail: data }, res.status, cors);

  return json(enrichSearchResults(data, q || categoryId), 200, cors);
}

async function radarTrends(url, cors) {
  const categoryId = url.searchParams.get('category');
  const endpoint   = categoryId
    ? `${ML_API}/trends/${SITE_ID}/${categoryId}`
    : `${ML_API}/trends/${SITE_ID}`;

  const res  = await fetch(endpoint);
  const data = await res.json();
  return json(data, res.ok ? 200 : res.status, cors);
}

async function radarCategory(url, cors) {
  const id = url.searchParams.get('id');
  if (!id) {
    // Lista categorias raiz
    const res  = await fetch(`${ML_API}/sites/${SITE_ID}/categories`);
    const data = await res.json();
    return json(data, res.ok ? 200 : res.status, cors);
  }

  const [catRes, trendsRes] = await Promise.all([
    fetch(`${ML_API}/categories/${id}`),
    fetch(`${ML_API}/trends/${SITE_ID}/${id}`).catch(() => null),
  ]);
  const cat    = await catRes.json();
  const trends = trendsRes?.ok ? await trendsRes.json() : [];

  return json({ ...cat, trends }, catRes.ok ? 200 : catRes.status, cors);
}

async function radarItem(url, cors, subpath) {
  const itemId = subpath.split('/').filter(Boolean).pop();
  if (!itemId) return json({ error: 'item_id ausente na URL' }, 400, cors);

  const [itemRes, descRes] = await Promise.all([
    fetch(`${ML_API}/items/${itemId}`),
    fetch(`${ML_API}/items/${itemId}/description`),
  ]);

  if (!itemRes.ok) return json({ error: 'Item não encontrado' }, 404, cors);

  const item = await itemRes.json();
  const desc = descRes.ok ? await descRes.json() : {};

  return json({
    ...item,
    description:       desc.plain_text || '',
    opportunity_score: calculateOpportunityScore(item),
  }, 200, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// RADAR — ENDPOINTS AUTENTICADOS
// ─────────────────────────────────────────────────────────────────────────────

async function radarMyItems(url, env, cors, tenantId) {
  const [token, profileRaw] = await Promise.all([
    getValidToken(tenantId, env),
    env.ML_TOKENS.get(`tenant:${tenantId}:profile`),
  ]);
  const profile = JSON.parse(profileRaw);
  const params  = new URLSearchParams({
    search_type: 'scan',
    limit:       url.searchParams.get('limit')  || '50',
    offset:      url.searchParams.get('offset') || '0',
    status:      url.searchParams.get('status') || 'active',
  });

  const res  = await fetch(`${ML_API}/users/${profile.user_id}/items/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return json(data, res.ok ? 200 : res.status, cors);
}

async function radarMyVisits(url, env, cors, tenantId) {
  const token  = await getValidToken(tenantId, env);
  const itemId = url.searchParams.get('item_id');
  if (!itemId) return json({ error: 'item_id é obrigatório' }, 400, cors);

  const dateFrom = url.searchParams.get('date_from')
    || new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
  const dateTo   = url.searchParams.get('date_to')
    || new Date().toISOString().split('T')[0];
  const unit     = url.searchParams.get('unit') || 'day';

  const res  = await fetch(
    `${ML_API}/items/${itemId}/visits?date_from=${dateFrom}&date_to=${dateTo}&unit=${unit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  return json(data, res.ok ? 200 : res.status, cors);
}

async function radarMyOrders(url, env, cors, tenantId) {
  const [token, profileRaw] = await Promise.all([
    getValidToken(tenantId, env),
    env.ML_TOKENS.get(`tenant:${tenantId}:profile`),
  ]);
  const profile = JSON.parse(profileRaw);
  const params  = new URLSearchParams({
    seller: profile.user_id,
    limit:  url.searchParams.get('limit')  || '50',
    offset: url.searchParams.get('offset') || '0',
    sort:   'date_desc',
  });

  const res  = await fetch(`${ML_API}/orders/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return json(data, res.ok ? 200 : res.status, cors);
}

async function radarSeller(url, env, cors, tenantId) {
  const token    = await getValidToken(tenantId, env);
  const sellerId = url.searchParams.get('seller_id');
  if (!sellerId) return json({ error: 'seller_id é obrigatório' }, 400, cors);

  const [userRes, itemsRes] = await Promise.all([
    fetch(`${ML_API}/users/${sellerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(`${ML_API}/users/${sellerId}/items/search?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  if (!userRes.ok) return json({ error: 'Seller não encontrado' }, 404, cors);

  const user  = await userRes.json();
  const items = itemsRes.ok ? await itemsRes.json() : {};

  return json({
    id:                user.id,
    nickname:          user.nickname,
    site_id:           user.site_id,
    registration_date: user.registration_date,
    permalink:         user.permalink,
    seller_reputation: user.seller_reputation,
    total_items:       items.paging?.total || 0,
  }, 200, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// OPPORTUNITY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

function enrichSearchResults(data, searchTerm = '') {
  if (!data.results) return data;

  const results = data.results.map(item => {
    const signals = buildSignals(item);
    return {
      id:               item.id,
      title:            item.title,
      price:            item.price,
      original_price:   item.original_price || null,
      currency_id:      item.currency_id,
      available_qty:    item.available_quantity,
      sold_qty:         item.sold_quantity,
      condition:        item.condition,
      thumbnail:        item.thumbnail,
      permalink:        item.permalink,
      category_id:      item.category_id,
      free_shipping:    item.shipping?.free_shipping || false,
      seller:           { id: item.seller?.id, nickname: item.seller?.nickname },
      signals,
      opportunity_score: calculateOpportunityScore(item),
    };
  });

  // Ordena por oportunidade (maior primeiro)
  results.sort((a, b) => b.opportunity_score - a.opportunity_score);

  const prices = results.map(i => i.price).filter(Boolean);

  return {
    ...data,
    results,
    radar_summary: {
      query:            searchTerm,
      total_found:      data.paging?.total || 0,
      showing:          results.length,
      avg_price:        prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0,
      min_price:        prices.length ? Math.min(...prices) : 0,
      max_price:        prices.length ? Math.max(...prices) : 0,
      free_shipping_pct: Math.round(results.filter(i => i.free_shipping).length / results.length * 100),
      top_opportunity:  results[0] ? { id: results[0].id, title: results[0].title, score: results[0].opportunity_score } : null,
      generated_at:     new Date().toISOString(),
    },
  };
}

function buildSignals(item) {
  const signals = [];

  if (item.sold_quantity >= 1000)  signals.push({ type: 'hot',         label: '🔥 Quente',         color: '#ef4444' });
  else if (item.sold_quantity >= 100) signals.push({ type: 'demand',   label: '📈 Alta demanda',   color: '#f97316' });
  else if (item.sold_quantity >= 10)  signals.push({ type: 'selling',  label: '✅ Vendendo',       color: '#22c55e' });

  if (item.shipping?.free_shipping) signals.push({ type: 'shipping', label: '🚚 Frete grátis', color: '#3b82f6' });

  if (item.available_quantity > 0 && item.available_quantity <= 5) {
    signals.push({ type: 'scarce', label: '⚡ Últimas unidades', color: '#a855f7' });
  }

  if (item.original_price && item.price < item.original_price) {
    const disc = Math.round((1 - item.price / item.original_price) * 100);
    if (disc >= 10) signals.push({ type: 'discount', label: `🏷️ ${disc}% off`, color: '#ec4899' });
  }

  if (item.condition === 'new') signals.push({ type: 'new', label: '✨ Novo', color: '#64748b' });

  return signals;
}

function calculateOpportunityScore(item) {
  let score = 0;

  // Demanda (0–40 pts)
  score += Math.min(Math.log10(Math.max(1, item.sold_quantity)) * 13, 40);

  // Frete grátis (10 pts)
  if (item.shipping?.free_shipping) score += 10;

  // Produto novo (5 pts)
  if (item.condition === 'new') score += 5;

  // Escassez / urgência (0–15 pts)
  if (item.available_quantity > 0 && item.available_quantity <= 5)  score += 15;
  else if (item.available_quantity <= 20)                           score += 8;

  // Desconto (0–15 pts)
  if (item.original_price && item.price < item.original_price) {
    const disc = (1 - item.price / item.original_price);
    score += Math.min(disc * 50, 15);
  }

  // Ratio vendas/estoque (0–15 pts)
  const ratio = item.sold_quantity / Math.max(1, item.available_quantity);
  score += Math.min(ratio * 2, 15);

  return Math.min(Math.round(score), 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getTenantId(request) {
  const header = request.headers.get('X-Tenant-ID');
  if (header) return header;
  return new URL(request.url).searchParams.get('tenant_id') || null;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin':  env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-ID',
  };
}

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
