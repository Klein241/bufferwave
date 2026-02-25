// ============================================================
// BUFFERWAVE v3.0 — Serveur Central (Fly.io)
// Réseau Coopératif + DTN NASA + VRAI TUNNEL WebSocket
// Jean-Paul = Curiosity sur Mars
// La forêt = l'espace intersidéral
// ============================================================

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// REGISTRES
// ============================================================

// Nœuds HTTP (heartbeat, register...)
const activeNodes = new Map();

// Tunnels WebSocket actifs
// userId -> WebSocket
const wsTunnels = new Map();

// Sessions de tunnel : jean <-> marie
// jeanId -> marieId
const activeTunnels = new Map();

// File DTN
const dtnQueue = new Map();

// ============================================================
// SÉLECTION MEILLEUR RELAIS
// ============================================================
function selectBestRelay(requestingUserId, userProfile) {
  const available = [];
  for (const [nodeId, node] of activeNodes) {
    if (nodeId === requestingUserId) continue;
    if (node.status !== 'online') continue;
    if (node.bandwidthMbps <= 0) continue;

    // Vérifier que ce nœud a un tunnel WebSocket actif
    if (!wsTunnels.has(nodeId)) continue;

    let score = 100;
    if (userProfile?.familyGroup && node.familyGroup === userProfile.familyGroup) score += 50;
    if (node.country === userProfile?.country) score += 30;
    score += Math.min(node.bandwidthMbps * 2, 40);
    const sec = (Date.now() - node.lastSeen) / 1000;
    if (sec < 30) score += 20;

    available.push({ nodeId, node, score });
  }
  if (available.length === 0) return null;
  available.sort((a, b) => b.score - a.score);
  return available[0];
}

// ============================================================
// DTN — Libération opportuniste
// ============================================================
async function releaseDTNQueue(userId) {
  const msgs = [];
  for (const [msgId, msg] of dtnQueue) {
    if (msg.toUser === userId || msg.fromUser === userId) {
      msgs.push({ msgId, msg });
    }
  }
  if (msgs.length === 0) return 0;
  let released = 0;
  for (const { msgId, msg } of msgs) {
    try {
      await supabase.from('pending_messages')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', msgId);
      dtnQueue.delete(msgId);
      released++;
    } catch (e) {}
  }
  return released;
}

// ============================================================
// SERVEUR HTTP
// ============================================================
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  let body = '';
  req.on('data', chunk => body += chunk);
  await new Promise(resolve => req.on('end', resolve));
  let data = {};
  try { data = JSON.parse(body || '{}'); } catch (e) {}

  const url = req.url.split('?')[0];

  // ── POST /register ────────────────────────────────────────
  if (req.method === 'POST' && url === '/register') {
    const { userId, country, bandwidthMbps, publicKey, familyGroup } = data;
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId requis' })); return; }

    activeNodes.set(userId, {
      country: country || 'OTHER',
      bandwidthMbps: bandwidthMbps || 5,
      publicKey: publicKey || userId,
      familyGroup: familyGroup || null,
      status: 'online',
      lastSeen: Date.now(),
      ip: req.socket.remoteAddress
    });

    await supabase.from('nodes').upsert({
      user_id: userId, country,
      ip_address: req.socket.remoteAddress,
      status: 'online',
      bandwidth_available_mbps: bandwidthMbps || 5,
      public_key: publicKey || userId,
      last_seen: new Date().toISOString()
    }, { onConflict: 'user_id' }).catch(() => {});

    const released = await releaseDTNQueue(userId);
    console.log(`[RÉSEAU] ✅ Nœud: ${userId} (${country})`);

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      nodesActifs: activeNodes.size,
      messagesDTNLiberes: released
    }));
    return;
  }

  // ── POST /connect ─────────────────────────────────────────
  if (req.method === 'POST' && url === '/connect') {
    const { userId, userProfile } = data;
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId requis' })); return; }

    if (activeNodes.has(userId)) {
      activeNodes.get(userId).status = 'discharging';
    }

    const bestRelay = selectBestRelay(userId, userProfile);

    if (!bestRelay) {
      console.log(`[DTN] 🛸 ${userId} — isolation totale`);
      res.writeHead(200);
      res.end(JSON.stringify({
        success: false,
        mode: 'dtn_isolation',
        message: 'Aucun nœud disponible. Mode DTN activé.',
        nodesActifs: activeNodes.size
      }));
      return;
    }

    // Enregistrer le tunnel Jean <-> Marie
    activeTunnels.set(userId, bestRelay.nodeId);

    // Notifier Marie qu'elle doit router pour Jean
    const marieWs = wsTunnels.get(bestRelay.nodeId);
    if (marieWs && marieWs.readyState === WebSocket.OPEN) {
      marieWs.send(JSON.stringify({
        type: 'RELAY_REQUEST',
        fromUserId: userId,
        message: `Tu vas router le trafic de ${userId}`
      }));
    }

    await supabase.from('relay_sessions').insert({
      source_user_id: userId,
      relay_user_id: bestRelay.nodeId,
      started_at: new Date().toISOString(),
      status: 'active'
    }).catch(() => {});

    console.log(`[TUNNEL] 🌐 ${userId} → ${bestRelay.nodeId} (${bestRelay.node.country})`);

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      mode: 'cooperative_relay',
      relay: {
        nodeId: bestRelay.nodeId,
        country: bestRelay.node.country,
        bandwidthMbps: bestRelay.node.bandwidthMbps,
        publicKey: bestRelay.node.publicKey,
        score: bestRelay.score
      }
    }));
    return;
  }

  // ── POST /store ───────────────────────────────────────────
  if (req.method === 'POST' && url === '/store') {
    const { fromUser, toUser, encryptedPayload, type } = data;
    if (!fromUser || !encryptedPayload) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'fromUser et payload requis' })); return;
    }
    const messageId = crypto.randomUUID();
    dtnQueue.set(messageId, {
      payload: encryptedPayload, fromUser, toUser,
      type: type || 'message', createdAt: Date.now(), attempts: 0
    });
    await supabase.from('pending_messages').insert({
      id: messageId, from_user_id: fromUser,
      encrypted_payload: encryptedPayload,
      created_at: new Date().toISOString(), status: 'pending'
    }).catch(() => {});

    const targetNode = toUser ? activeNodes.get(toUser) : null;
    if (targetNode && targetNode.status === 'online') {
      await releaseDTNQueue(toUser);
    }

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, messageId, mode: 'dtn_stored', queueSize: dtnQueue.size }));
    return;
  }

  // ── POST /heartbeat ───────────────────────────────────────
  if (req.method === 'POST' && url === '/heartbeat') {
    const { userId } = data;
    if (activeNodes.has(userId)) {
      activeNodes.get(userId).lastSeen = Date.now();
      activeNodes.get(userId).status = 'online';
      await releaseDTNQueue(userId);
    }
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
    return;
  }

  // ── POST /disconnect ──────────────────────────────────────
  if (req.method === 'POST' && url === '/disconnect') {
    const { userId } = data;
    if (activeNodes.has(userId)) activeNodes.get(userId).status = 'offline';
    activeTunnels.delete(userId);
    await supabase.from('nodes').update({ status: 'offline' }).eq('user_id', userId).catch(() => {});
    console.log(`[RÉSEAU] 👋 Déconnecté: ${userId}`);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ── GET /nodes ────────────────────────────────────────────
  if (req.method === 'GET' && url === '/nodes') {
    const nodes = [];
    for (const [id, node] of activeNodes) {
      if (node.status !== 'offline') {
        nodes.push({
          id, country: node.country,
          status: node.status,
          bandwidthMbps: node.bandwidthMbps,
          lastSeen: node.lastSeen,
          hasWebSocket: wsTunnels.has(id)
        });
      }
    }
    res.writeHead(200);
    res.end(JSON.stringify({ nodes, total: nodes.length, dtnQueueSize: dtnQueue.size }));
    return;
  }

  // ── GET /status ───────────────────────────────────────────
  if (req.method === 'GET' && url === '/status') {
    const online = [...activeNodes.values()].filter(n => n.status === 'online').length;
    res.writeHead(200);
    res.end(JSON.stringify({
      network: 'BufferWave Cooperative Network',
      version: '3.0',
      paradigm: 'DTN + WebSocket Tunnel',
      nodes: { total: activeNodes.size, online },
      tunnels: { active: activeTunnels.size, websockets: wsTunnels.size },
      dtn: { queueSize: dtnQueue.size },
      uptime: process.uptime()
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Route non trouvée' }));
});

// ============================================================
// SERVEUR WEBSOCKET — VRAI TUNNEL DE DONNÉES
// ============================================================
// Protocole :
// Jean  → serveur : { type:'JEAN_DATA', data: <paquets IP base64> }
// Serveur → Marie : { type:'FORWARD_TO_INTERNET', data: ... }
// Marie → internet : requête réelle
// Marie → serveur : { type:'MARIE_RESPONSE', data: <réponse base64> }
// Serveur → Jean  : { type:'RESPONSE_TO_JEAN', data: ... }
// ============================================================

const wss = new WebSocketServer({ server: httpServer, path: '/tunnel' });

wss.on('connection', (ws, req) => {
  let userId = null;
  let userRole = null; // 'relay' (Marie) ou 'client' (Jean)

  console.log('[WS] Nouvelle connexion WebSocket');

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      // ── Identification du nœud ────────────────────────────
      case 'IDENTIFY':
        userId = msg.userId;
        userRole = msg.role; // 'relay' ou 'client'
        wsTunnels.set(userId, ws);
        console.log(`[WS] ✅ ${userRole} identifié: ${userId}`);

        // Mettre à jour le statut
        if (activeNodes.has(userId)) {
          activeNodes.get(userId).status = 'online';
        }

        ws.send(JSON.stringify({ type: 'IDENTIFIED', userId, role: userRole }));
        break;

      // ── Jean envoie des données vers internet ─────────────
      // Le serveur les transfère à Marie
      case 'JEAN_DATA':
        const marieId = activeTunnels.get(userId);
        if (marieId) {
          const marieWs = wsTunnels.get(marieId);
          if (marieWs && marieWs.readyState === WebSocket.OPEN) {
            // Transférer à Marie avec l'ID de Jean pour la réponse
            marieWs.send(JSON.stringify({
              type: 'FORWARD_TO_INTERNET',
              fromUserId: userId,
              data: msg.data,      // paquets IP de Jean en base64
              requestId: msg.requestId
            }));
          } else {
            // Marie déconnectée — trouver un autre relais
            ws.send(JSON.stringify({
              type: 'RELAY_LOST',
              message: 'Nœud relais perdu — basculement...'
            }));
          }
        } else {
          // Pas encore de relais — mode DTN
          ws.send(JSON.stringify({
            type: 'DTN_MODE',
            message: 'Aucun relais — données stockées DTN'
          }));
        }
        break;

      // ── Marie renvoie la réponse internet vers Jean ───────
      case 'MARIE_RESPONSE':
        const jeanId = msg.toUserId;
        const jeanWs = wsTunnels.get(jeanId);
        if (jeanWs && jeanWs.readyState === WebSocket.OPEN) {
          jeanWs.send(JSON.stringify({
            type: 'RESPONSE_TO_JEAN',
            data: msg.data,         // réponse internet en base64
            requestId: msg.requestId
          }));
        }
        break;

      // ── Ping/Pong pour maintenir la connexion ─────────────
      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        if (userId && activeNodes.has(userId)) {
          activeNodes.get(userId).lastSeen = Date.now();
        }
        break;
    }
  });

  ws.on('close', () => {
    if (userId) {
      console.log(`[WS] 👋 Déconnexion: ${userId}`);
      wsTunnels.delete(userId);
      activeTunnels.delete(userId);
      if (activeNodes.has(userId)) {
        activeNodes.get(userId).status = 'offline';
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Erreur: ${err.message}`);
  });
});

// ============================================================
// NETTOYAGE AUTOMATIQUE
// ============================================================
setInterval(() => {
  const now = Date.now();
  for (const [userId, node] of activeNodes) {
    if ((now - node.lastSeen) / 1000 > 60) {
      node.status = 'offline';
    }
  }
}, 30000);

// ============================================================
// DÉMARRAGE
// ============================================================
httpServer.listen(PORT, () => {
  console.log('');
  console.log('🌊 ==========================================');
  console.log('   BUFFERWAVE COOPERATIVE NETWORK v3.0');
  console.log('   DTN + WebSocket Tunnel — VRAI ROUTAGE');
  console.log('==========================================');
  console.log(`🚀 HTTP + WebSocket sur port ${PORT}`);
  console.log(`🛸 Tunnel: Jean → Serveur → Marie → Internet`);
  console.log(`🌍 Réseau coopératif multi-pays activé`);
  console.log('==========================================');
  console.log('');
});
