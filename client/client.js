// ============================================================
// BUFFERWAVE — Client Jean-Paul (Mode Forêt)
// Jean-Paul = Curiosity sur Mars
// La forêt = l'espace intersidéral
// Même 1 seconde de signal = fenêtre de communication
// Aucun message ne sera jamais perdu
// ============================================================

const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.BUFFERWAVE_SERVER ||
  'https://bufferwave-network.fly.dev';
const USER_ID = process.env.USER_ID || 'jean-paul';
const DTN_STORE_PATH = path.join(__dirname, '.dtn_queue.json');
const PROXY_PORT = 8080;

// ============================================================
// FILE DTN LOCALE — Principe Curiosity NASA
// Stockage persistant sur le téléphone
// Aucune donnée ne sera perdue
// ============================================================
class DTNQueue {
  constructor() {
    this.queue = this.load();
  }

  load() {
    try {
      if (fs.existsSync(DTN_STORE_PATH)) {
        return JSON.parse(fs.readFileSync(DTN_STORE_PATH, 'utf8'));
      }
    } catch (e) {}
    return [];
  }

  save() {
    fs.writeFileSync(
      DTN_STORE_PATH,
      JSON.stringify(this.queue, null, 2)
    );
  }

  add(item) {
    const entry = {
      id: crypto.randomUUID(),
      ...item,
      createdAt: Date.now(),
      attempts: 0,
      status: 'pending'
    };
    this.queue.push(entry);
    this.save();
    console.log(`[DTN] 💾 Stocké: ${entry.id}`);
    console.log(`[DTN] File d'attente: ${this.queue.length} éléments`);
    return entry;
  }

  markDelivered(id) {
    const item = this.queue.find(i => i.id === id);
    if (item) {
      item.status = 'delivered';
      item.deliveredAt = Date.now();
      this.save();
    }
  }

  getPending() {
    return this.queue.filter(i => i.status === 'pending');
  }

  size() {
    return this.queue.filter(i => i.status === 'pending').length;
  }
}

const dtnQueue = new DTNQueue();

// ============================================================
// DÉTECTEUR DE SIGNAL — Moniteur réseau
// Détecte même 1 seconde de connexion disponible
// ============================================================
class SignalDetector {
  constructor(onSignalFound, onSignalLost) {
    this.onSignalFound = onSignalFound;
    this.onSignalLost = onSignalLost;
    this.hasSignal = false;
    this.checkInterval = null;
  }

  start() {
    this.checkInterval = setInterval(() => {
      this.check();
    }, 2000); // Vérifier toutes les 2 secondes

    console.log(`[SIGNAL] 📡 Moniteur de signal actif`);
    console.log(`[SIGNAL] Vérification toutes les 2 secondes`);
  }

  check() {
    // Tenter de joindre le serveur BufferWave
    const req = https.request(
      `${SERVER_URL}/status`,
      { method: 'GET', timeout: 1500 },
      res => {
        if (!this.hasSignal) {
          this.hasSignal = true;
          console.log('');
          console.log(`[SIGNAL] ⚡ FENÊTRE DE COMMUNICATION DÉTECTÉE!`);
          console.log(`[SIGNAL] Libération de la file DTN...`);
          this.onSignalFound();
        }
      }
    );

    req.on('timeout', () => {
      req.destroy();
      if (this.hasSignal) {
        this.hasSignal = false;
        console.log(`[SIGNAL] 📵 Signal perdu — mode DTN isolation`);
        this.onSignalLost();
      }
    });

    req.on('error', () => {
      if (this.hasSignal) {
        this.hasSignal = false;
        this.onSignalLost();
      }
    });

    req.end();
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// ============================================================
// LIBÉRATION DTN — Envoyer les messages stockés
// Dès qu'une fenêtre de communication s'ouvre
// ============================================================
async function releaseDTNQueue() {
  const pending = dtnQueue.getPending();

  if (pending.length === 0) return;

  console.log(`[DTN] 🚀 Libération de ${pending.length} messages`);

  for (const item of pending) {
    try {
      await sendToServer('/store', {
        fromUser: USER_ID,
        toUser: item.toUser,
        encryptedPayload: item.payload,
        type: item.type
      });

      dtnQueue.markDelivered(item.id);
      console.log(`[DTN] ✅ Message ${item.id} livré`);
      item.attempts++;
    } catch (err) {
      console.log(`[DTN] ⏳ Retry pour ${item.id}: ${err.message}`);
      item.attempts++;
      dtnQueue.save();
    }
  }
}

// ============================================================
// CONNEXION AU RÉSEAU COOPÉRATIF
// ============================================================
let currentRelay = null;

async function connectToNetwork() {
  try {
    const result = await sendToServer('/connect', {
      userId: USER_ID,
      userProfile: {
        country: process.env.COUNTRY || 'CM',
        familyGroup: process.env.FAMILY_GROUP
      }
    });

    if (result.success && result.mode === 'cooperative_relay') {
      currentRelay = result.relay;
      console.log(`[RÉSEAU] 🌍 Connecté via ${result.relay.country}`);
      console.log(`[RÉSEAU] Nœud relais: ${result.relay.nodeId}`);
      console.log(`[RÉSEAU] Bande passante: ${result.relay.bandwidthMbps} Mbps`);
      return true;
    } else {
      console.log(`[DTN] 🛸 Mode isolation totale`);
      console.log(`[DTN] Messages seront stockés jusqu'à`);
      console.log(`[DTN] la prochaine fenêtre de communication`);
      currentRelay = null;
      return false;
    }
  } catch (err) {
    console.log(`[DTN] 📵 Serveur inaccessible: ${err.message}`);
    currentRelay = null;
    return false;
  }
}

// ============================================================
// PROXY LOCAL — Jean-Paul navigue normalement
// Toutes ses requêtes passent par le nœud relais
// ============================================================
function startLocalProxy() {
  const proxy = net.createServer(clientSocket => {
    let headerBuffer = '';
    let headerComplete = false;

    clientSocket.on('data', data => {
      if (!headerComplete) {
        headerBuffer += data.toString();

        if (headerBuffer.includes('\r\n\r\n')) {
          headerComplete = true;
          const lines = headerBuffer.split('\r\n');
          const firstLine = lines[0];

          // Requête CONNECT (HTTPS)
          if (firstLine.startsWith('CONNECT')) {
            const match = firstLine.match(/CONNECT ([^:]+):(\d+)/);
            if (!match) {
              clientSocket.destroy();
              return;
            }

            const host = match[1];
            const port = parseInt(match[2]);

            if (currentRelay) {
              // Router via le nœud relais
              routeViaRelay(clientSocket, host, port);
            } else {
              // Stocker en DTN
              storeDTN(clientSocket, host, data);
            }
          } else {
            // Requête HTTP normale
            const match = firstLine.match(
              /[A-Z]+ https?:\/\/([^/:]+)(?::(\d+))?/
            );
            if (match) {
              const host = match[1];
              const port = match[2] ? parseInt(match[2]) : 80;

              if (currentRelay) {
                routeViaRelay(clientSocket, host, port);
              } else {
                storeDTN(clientSocket, host, data);
              }
            }
          }
        }
      }
    });

    clientSocket.on('error', () => {});
  });

  proxy.listen(PROXY_PORT, '127.0.0.1', () => {
    console.log(`[PROXY] 🔄 Proxy local actif: 127.0.0.1:${PROXY_PORT}`);
    console.log(`[PROXY] Configure ton navigateur avec ce proxy`);
    console.log(`[PROXY] Adresse: 127.0.0.1 | Port: ${PROXY_PORT}`);
  });
}

// Router via le nœud relais (Marie, Paul, etc.)
function routeViaRelay(clientSocket, host, port) {
  // En production: connexion chiffrée via le serveur Fly.io
  const targetSocket = net.connect(port, host, () => {
    clientSocket.write(
      'HTTP/1.1 200 Connection Established\r\n\r\n'
    );
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  targetSocket.on('error', err => {
    console.log(`[PROXY] ⚠️ Erreur relay vers ${host}: ${err.message}`);
    // Stocker en DTN si relay échoue
    storeDTNMessage(host, 'connection_failed');
    clientSocket.destroy();
  });

  clientSocket.on('close', () => targetSocket.destroy());
}

// Stocker en DTN quand pas de connexion
function storeDTN(socket, host, data) {
  dtnQueue.add({
    type: 'http_request',
    host,
    payload: data.toString('base64'),
    toUser: null
  });

  // Réponse gracieuse au navigateur
  const response = `HTTP/1.1 503 Service Unavailable\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n\r\n` +
    `<!DOCTYPE html><html><head>` +
    `<meta charset="utf-8">` +
    `<title>BufferWave — Mode Forêt</title>` +
    `<style>body{font-family:monospace;background:#0a0f1e;` +
    `color:#00f5c4;display:flex;align-items:center;` +
    `justify-content:center;height:100vh;margin:0}` +
    `.box{text-align:center;border:1px solid #00f5c4;` +
    `padding:40px;border-radius:12px}` +
    `h1{font-size:2rem}p{color:#4a6080}</style></head>` +
    `<body><div class="box">` +
    `<h1>🛸 Mode Forêt Actif</h1>` +
    `<p>${host}</p>` +
    `<p>Requête stockée — sera livrée dès qu'un signal est détecté</p>` +
    `<p>File DTN: ${dtnQueue.size()} éléments en attente</p>` +
    `<p style="color:#ffaa00">⚡ Même 1 seconde de signal suffit</p>` +
    `</div></body></html>`;

  socket.write(response);
  socket.end();
}

function storeDTNMessage(host, type) {
  dtnQueue.add({ type, host, toUser: null, payload: '' });
}

// ============================================================
// UTILITAIRE — Envoyer au serveur
// ============================================================
function sendToServer(endpoint, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const url = new URL(SERVER_URL + endpoint);

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Réponse invalide')); }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============================================================
// DÉMARRAGE — Jean-Paul active le mode forêt
// ============================================================
async function start() {
  console.log('');
  console.log('🌊 ==========================================');
  console.log('   BUFFERWAVE — MODE FORÊT');
  console.log('   Jean-Paul = Curiosity sur Mars');
  console.log('==========================================');
  console.log(`👤 Utilisateur: ${USER_ID}`);
  console.log(`📡 Proxy local: 127.0.0.1:${PROXY_PORT}`);
  console.log(`💾 File DTN: ${dtnQueue.size()} messages en attente`);
  console.log('==========================================');
  console.log('');

  // Démarrer le proxy local
  startLocalProxy();

  // Tentative de connexion initiale
  const connected = await connectToNetwork();

  // Démarrer le détecteur de signal
  const detector = new SignalDetector(
    async () => {
      // Signal trouvé — libérer la file DTN
      await releaseDTNQueue();
      await connectToNetwork();
    },
    () => {
      // Signal perdu
      currentRelay = null;
    }
  );
  detector.start();

  if (connected) {
    console.log(`[RÉSEAU] ✅ Connexion coopérative active`);
    console.log(`[RÉSEAU] Jean-Paul peut naviguer normalement`);
  } else {
    console.log(`[DTN] ✅ Mode isolation activé`);
    console.log(`[DTN] ${dtnQueue.size()} messages en attente`);
    console.log(`[DTN] Surveillance du signal active...`);
  }
}

start().catch(console.error);
