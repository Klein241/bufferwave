// ============================================================
// BUFFERWAVE — Serveur Central (Fly.io)
// Réseau Coopératif + DTN NASA Style
// Jean-Paul = Curiosity sur Mars
// La forêt = l'espace intersidéral
// Le signal 2G passager = la fenêtre de communication
// ============================================================

const http = require('http');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// REGISTRE DES NŒUDS ACTIFS (en mémoire + Supabase)
// ============================================================
const activeNodes = new Map();
// Structure: userId -> { ip, country, bandwidthMbps, status,
//                        publicKey, lastSeen, socket }

// ============================================================
// FILE DTN — Messages en attente (NASA Bundle Protocol)
// Principe Curiosity : stocker jusqu'à la fenêtre de comm
// ============================================================
const dtnQueue = new Map();
// Structure: messageId -> { payload, fromUser, toUser,
//                           createdAt, attempts, encrypted }

// ============================================================
// CHIFFREMENT AES-256-GCM
// ============================================================
function encrypt(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    iv
  );
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex')
  };
}

function decrypt(encryptedData, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(encryptedData.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// ============================================================
// SÉLECTION DU MEILLEUR NŒUD RELAIS
// Algorithme : latence + bande passante + priorité famille
// ============================================================
function selectBestRelay(requestingUserId, userProfile) {
  const available = [];

  for (const [nodeId, node] of activeNodes) {
    // Ne pas se router vers soi-même
    if (nodeId === requestingUserId) continue;
    if (node.status !== 'online') continue;
    if (node.bandwidthMbps <= 0) continue;

    let score = 100;

    // Priorité 1 : famille (même groupe)
    if (userProfile?.familyGroup &&
        node.familyGroup === userProfile.familyGroup) {
      score += 50;
    }

    // Priorité 2 : même région géographique (latence)
    if (node.country === userProfile?.country) score += 30;

    // Priorité 3 : bande passante disponible
    score += Math.min(node.bandwidthMbps * 2, 40);

    // Priorité 4 : vu récemment (fiabilité)
    const secondsSinceLastSeen =
      (Date.now() - node.lastSeen) / 1000;
    if (secondsSinceLastSeen < 30) score += 20;

    available.push({ nodeId, node, score });
  }

  if (available.length === 0) return null;

  // Trier par score décroissant
  available.sort((a, b) => b.score - a.score);
  return available[0];
}

// ============================================================
// MOTEUR DTN — Libération opportuniste (Principe NASA)
// Dès qu'une fenêtre de communication s'ouvre :
// on libère TOUS les messages en attente
// ============================================================
async function releaseDTNQueue(userId) {
  const userMessages = [];

  for (const [msgId, msg] of dtnQueue) {
    if (msg.toUser === userId || msg.fromUser === userId) {
      userMessages.push({ msgId, msg });
    }
  }

  if (userMessages.length === 0) return 0;

  console.log(`[DTN] 🛸 Fenêtre de communication ouverte pour ${userId}`);
  console.log(`[DTN] Libération de ${userMessages.length} messages en attente`);

  let released = 0;
  for (const { msgId, msg } of userMessages) {
    try {
      // Marquer comme livré dans Supabase
      await supabase
        .from('pending_messages')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString()
        })
        .eq('id', msgId);

      dtnQueue.delete(msgId);
      released++;

      console.log(`[DTN] ✅ Message ${msgId} libéré avec succès`);
    } catch (err) {
      console.error(`[DTN] ❌ Erreur libération ${msgId}:`, err.message);
    }
  }

  return released;
}

// ============================================================
// ROUTEUR HTTP
// ============================================================
async function handleRequest(req, res) {
  // Headers CORS
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods',
    'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parser le body
  let body = '';
  req.on('data', chunk => body += chunk);
  await new Promise(resolve => req.on('end', resolve));
  let data = {};
  try { data = JSON.parse(body || '{}'); } catch (e) {}

  const url = req.url.split('?')[0];

  // ─────────────────────────────────────────────────────────
  // POST /register — Enregistrer un nœud dans le réseau
  // ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/register') {
    const {
      userId, country, bandwidthMbps,
      publicKey, familyGroup
    } = data;

    if (!userId || !publicKey) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'userId et publicKey requis' }));
      return;
    }

    // Enregistrer dans le registre mémoire
    activeNodes.set(userId, {
      country: country || 'unknown',
      bandwidthMbps: bandwidthMbps || 5,
      publicKey,
      familyGroup: familyGroup || null,
      status: 'online',
      lastSeen: Date.now(),
      ip: req.socket.remoteAddress
    });

    // Enregistrer dans Supabase
    await supabase.from('nodes').upsert({
      user_id: userId,
      country,
      ip_address: req.socket.remoteAddress,
      status: 'online',
      bandwidth_available_mbps: bandwidthMbps || 5,
      public_key: publicKey,
      last_seen: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // Libérer les messages DTN en attente
    const released = await releaseDTNQueue(userId);

    console.log(`[RÉSEAU] ✅ Nœud enregistré: ${userId} (${country})`);
    if (released > 0) {
      console.log(`[DTN] 🚀 ${released} messages libérés pour ${userId}`);
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      message: `Nœud enregistré dans le réseau BufferWave`,
      nodesActifs: activeNodes.size,
      messagesDTNLiberes: released
    }));
    return;
  }

  // ─────────────────────────────────────────────────────────
  // POST /connect — Jean-Paul demande une connexion relais
  // ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/connect') {
    const { userId, userProfile } = data;

    if (!userId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'userId requis' }));
      return;
    }

    // Marquer comme "en décharge" - sans réseau direct
    if (activeNodes.has(userId)) {
      activeNodes.get(userId).status = 'discharging';
    }

    // Trouver le meilleur nœud relais
    const bestRelay = selectBestRelay(userId, userProfile);

    if (!bestRelay) {
      // Aucun nœud disponible — mode DTN pur
      console.log(`[DTN] 🛸 ${userId} en mode isolation totale`);
      console.log(`[DTN] Messages seront stockés jusqu'à`);
      console.log(`[DTN] la prochaine fenêtre de communication`);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: false,
        mode: 'dtn_isolation',
        message: 'Aucun nœud disponible. Mode DTN activé.',
        instruction: 'Vos données sont stockées et seront' +
          ' libérées dès qu\'un nœud se connecte.',
        nodesActifs: activeNodes.size
      }));
      return;
    }

    // Marquer le nœud relais comme occupé
    bestRelay.node.status = 'relaying';

    // Enregistrer la session de relais
    const session = await supabase
      .from('relay_sessions')
      .insert({
        source_user_id: userId,
        relay_user_id: bestRelay.nodeId,
        started_at: new Date().toISOString(),
        status: 'active'
      })
      .select()
      .single();

    console.log(`[RELAIS] 🌐 ${userId} connecté via ${bestRelay.nodeId}`);
    console.log(`[RELAIS] Pays relais: ${bestRelay.node.country}`);
    console.log(`[RELAIS] Score: ${bestRelay.score}`);

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
      },
      sessionId: session.data?.id,
      message: `Connecté via ${bestRelay.node.country}`
    }));
    return;
  }

  // ─────────────────────────────────────────────────────────
  // POST /store — Stocker un message DTN (principe NASA)
  // ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/store') {
    const { fromUser, toUser, encryptedPayload, type } = data;

    if (!fromUser || !encryptedPayload) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'fromUser et payload requis' }));
      return;
    }

    const messageId = crypto.randomUUID();

    // Stocker en mémoire (rapide)
    dtnQueue.set(messageId, {
      payload: encryptedPayload,
      fromUser,
      toUser,
      type: type || 'message',
      createdAt: Date.now(),
      attempts: 0
    });

    // Stocker dans Supabase (persistant)
    await supabase.from('pending_messages').insert({
      id: messageId,
      from_user_id: fromUser,
      encrypted_payload: encryptedPayload,
      created_at: new Date().toISOString(),
      status: 'pending'
    });

    console.log(`[DTN] 💾 Message stocké: ${messageId}`);
    console.log(`[DTN] De: ${fromUser} | Type: ${type}`);
    console.log(`[DTN] En attente de fenêtre de communication...`);

    // Tentative immédiate si un nœud est disponible
    const targetNode = toUser ? activeNodes.get(toUser) : null;
    if (targetNode && targetNode.status === 'online') {
      await releaseDTNQueue(toUser);
      console.log(`[DTN] ⚡ Fenêtre détectée! Message libéré immédiatement`);
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      messageId,
      mode: 'dtn_stored',
      message: 'Message stocké. Sera livré à la prochaine' +
        ' opportunité réseau.',
      queueSize: dtnQueue.size
    }));
    return;
  }

  // ─────────────────────────────────────────────────────────
  // POST /heartbeat — Nœud signale qu'il est toujours actif
  // ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/heartbeat') {
    const { userId } = data;

    if (activeNodes.has(userId)) {
      activeNodes.get(userId).lastSeen = Date.now();
      activeNodes.get(userId).status = 'online';

      // Libérer les messages DTN en attente
      const released = await releaseDTNQueue(userId);
      if (released > 0) {
        console.log(`[DTN] ❤️ Heartbeat ${userId}: ${released} messages libérés`);
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      timestamp: Date.now()
    }));
    return;
  }

  // ─────────────────────────────────────────────────────────
  // POST /disconnect — Nœud se déconnecte
  // ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/disconnect') {
    const { userId } = data;

    if (activeNodes.has(userId)) {
      activeNodes.get(userId).status = 'offline';
    }

    await supabase
      .from('nodes')
      .update({ status: 'offline' })
      .eq('user_id', userId);

    console.log(`[RÉSEAU] 👋 Nœud déconnecté: ${userId}`);

    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ─────────────────────────────────────────────────────────
  // GET /nodes — Liste des nœuds actifs
  // ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/nodes') {
    const nodes = [];
    for (const [id, node] of activeNodes) {
      if (node.status !== 'offline') {
        nodes.push({
          id,
          country: node.country,
          status: node.status,
          bandwidthMbps: node.bandwidthMbps,
          lastSeen: node.lastSeen
        });
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      nodes,
      total: nodes.length,
      dtnQueueSize: dtnQueue.size
    }));
    return;
  }

  // ─────────────────────────────────────────────────────────
  // GET /status — État général du réseau
  // ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/status') {
    const online = [...activeNodes.values()]
      .filter(n => n.status === 'online').length;
    const relaying = [...activeNodes.values()]
      .filter(n => n.status === 'relaying').length;

    res.writeHead(200);
    res.end(JSON.stringify({
      network: 'BufferWave Cooperative Network',
      version: '2.0',
      paradigm: 'DTN Store and Forward — NASA Style',
      nodes: {
        total: activeNodes.size,
        online,
        relaying,
        offline: activeNodes.size - online - relaying
      },
      dtn: {
        queueSize: dtnQueue.size,
        principle: 'Jean-Paul = Curiosity sur Mars'
      },
      uptime: process.uptime()
    }));
    return;
  }

  // Route non trouvée
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Route non trouvée' }));
}

// ============================================================
// NETTOYAGE AUTOMATIQUE — Nœuds inactifs (toutes les 30s)
// ============================================================
setInterval(() => {
  const now = Date.now();
  for (const [userId, node] of activeNodes) {
    const inactiveSeconds = (now - node.lastSeen) / 1000;
    if (inactiveSeconds > 60) {
      node.status = 'offline';
      console.log(`[RÉSEAU] ⚠️ Nœud ${userId} marqué hors ligne`);
    }
  }
}, 30000);

// ============================================================
// DÉMARRAGE
// ============================================================
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log('');
  console.log('🌊 ==========================================');
  console.log('   BUFFERWAVE COOPERATIVE NETWORK v2.0');
  console.log('   DTN Store and Forward — NASA Style');
  console.log('==========================================');
  console.log(`🚀 Serveur actif sur port ${PORT}`);
  console.log(`🛸 Principe: Jean-Paul = Curiosity sur Mars`);
  console.log(`🌍 Réseau coopératif multi-pays activé`);
  console.log('==========================================');
  console.log('');
});
