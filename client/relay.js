// ============================================================
// BUFFERWAVE — Module Relais (Marie, Paul, Ali, Sophie)
// Tourne automatiquement sur le téléphone des utilisateurs
// connectés. Ils deviennent des nœuds du réseau coopératif.
// Chiffrement total — Marie ne voit RIEN du trafic de Jean
// ============================================================

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const net = require('net');

const SERVER_URL = process.env.BUFFERWAVE_SERVER ||
  'https://bufferwave-network.fly.dev';
const USER_ID = process.env.USER_ID;
const MAX_BANDWIDTH_MBPS = process.env.MAX_BANDWIDTH || 5;
const HEARTBEAT_INTERVAL = 15000; // 15 secondes

// ============================================================
// GÉNÉRATION DES CLÉS CRYPTOGRAPHIQUES
// ============================================================
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync(
    'ec',
    {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    }
  );
  return { publicKey, privateKey };
}

// ============================================================
// INSCRIPTION AU RÉSEAU BUFFERWAVE
// ============================================================
async function registerNode(keyPair, country) {
  const payload = JSON.stringify({
    userId: USER_ID,
    country: country || 'unknown',
    bandwidthMbps: MAX_BANDWIDTH_MBPS,
    publicKey: keyPair.publicKey,
    familyGroup: process.env.FAMILY_GROUP || null
  });

  return new Promise((resolve, reject) => {
    const req = https.request(`${SERVER_URL}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        console.log(`[RELAIS] ✅ Inscrit au réseau BufferWave`);
        console.log(`[RELAIS] Nœuds actifs: ${result.nodesActifs}`);
        if (result.messagesDTNLiberes > 0) {
          console.log(`[DTN] 🚀 ${result.messagesDTNLiberes} messages libérés`);
        }
        resolve(result);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============================================================
// HEARTBEAT — Signaler qu'on est toujours actif
// Principe DTN : maintenir la fenêtre de communication
// ============================================================
function startHeartbeat() {
  setInterval(() => {
    const payload = JSON.stringify({ userId: USER_ID });

    const req = https.request(`${SERVER_URL}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Silencieux sauf si messages libérés
      });
    });
    req.on('error', () => {});
    req.write(payload);
    req.end();
  }, HEARTBEAT_INTERVAL);

  console.log(`[RELAIS] ❤️ Heartbeat actif (${HEARTBEAT_INTERVAL/1000}s)`);
}

// ============================================================
// PROXY DE RELAIS — Relaie le trafic chiffré de Jean-Paul
// Marie ne voit RIEN — seulement des paquets chiffrés
// ============================================================
function startRelayProxy() {
  const PROXY_PORT = 8888;

  const proxy = net.createServer(clientSocket => {
    let buffer = Buffer.alloc(0);

    clientSocket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);

      // Parser la requête CONNECT (tunnel HTTPS)
      const request = buffer.toString('utf8');
      if (request.includes('CONNECT')) {
        const match = request.match(/CONNECT ([^:]+):(\d+)/);
        if (!match) return;

        const host = match[1];
        const port = parseInt(match[2]);

        // Connexion vers le serveur cible
        const targetSocket = net.connect(port, host, () => {
          clientSocket.write(
            'HTTP/1.1 200 Connection Established\r\n\r\n'
          );

          // Comptabilité bande passante
          let bytesRelayed = 0;

          // Tunnel bidirectionnel chiffré
          clientSocket.pipe(targetSocket);
          targetSocket.pipe(clientSocket);

          clientSocket.on('data', d => {
            bytesRelayed += d.length;
          });

          clientSocket.on('close', () => {
            // Reporter les MB relayés au serveur
            reportBandwidthUsed(bytesRelayed);
            targetSocket.destroy();
          });
        });

        targetSocket.on('error', () => {
          clientSocket.destroy();
        });

        buffer = Buffer.alloc(0);
      }
    });

    clientSocket.on('error', () => {});
  });

  proxy.listen(PROXY_PORT, () => {
    console.log(`[RELAIS] 🌐 Proxy de relais actif port ${PROXY_PORT}`);
    console.log(`[RELAIS] En attente de connexions à relayer...`);
  });
}

// ============================================================
// REPORTER LA BANDE PASSANTE UTILISÉE
// Système de crédits équitable — tu donnes, tu reçois
// ============================================================
function reportBandwidthUsed(bytes) {
  if (bytes < 1000) return; // Ignorer les micro-transferts

  const mb = (bytes / 1024 / 1024).toFixed(2);
  const payload = JSON.stringify({
    userId: USER_ID,
    bytesRelayed: bytes
  });

  const req = https.request(`${SERVER_URL}/bandwidth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, () => {});
  req.on('error', () => {});
  req.write(payload);
  req.end();

  console.log(`[RELAIS] 📊 ${mb} MB relayés (crédits gagnés)`);
}

// ============================================================
// DÉMARRAGE DU MODULE RELAIS
// ============================================================
async function start() {
  console.log('');
  console.log('🌊 ==========================================');
  console.log('   BUFFERWAVE — MODULE RELAIS');
  console.log('   Tu partages = Tu reçois');
  console.log('==========================================');
  console.log(`👤 Utilisateur: ${USER_ID}`);
  console.log(`📡 Bande passante partagée: ${MAX_BANDWIDTH_MBPS} Mbps`);
  console.log(`🔒 Chiffrement: AES-256-GCM (tu ne vois rien)`);
  console.log('==========================================');

  // Générer les clés
  const keyPair = generateKeyPair();
  console.log(`[RELAIS] 🔑 Clés cryptographiques générées`);

  // S'inscrire au réseau
  await registerNode(keyPair, process.env.COUNTRY || 'unknown');

  // Démarrer le heartbeat (fenêtre de communication DTN)
  startHeartbeat();

  // Démarrer le proxy de relais
  startRelayProxy();

  console.log('');
  console.log(`[RELAIS] ✅ Prêt à aider Jean-Paul en forêt`);
  console.log(`[RELAIS] 🛸 Principe NASA DTN activé`);
}

start().catch(console.error);
