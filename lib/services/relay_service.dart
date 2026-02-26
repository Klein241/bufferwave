import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class RelayService {
  static const String _wsUrl =
      'wss://bufferwave-worker.bufferwave.workers.dev/tunnel';

  WebSocketChannel? _channel;
  bool _isRunning = false;
  String _userId = '';
  String _role = 'relay'; // Marie = relay par défaut

  // Stats temps réel
  int bytesRelayed = 0;
  int requestsHandled = 0;
  int activeClients = 0;

  // Callbacks UI
  Function(String)? onStatusChanged;
  Function(int, int)? onStatsUpdated; // (bytes, requests)
  Function(List<Map>)? onNodesUpdated;

  // ─────────────────────────────────────────────────
  // DÉMARRAGE — appelé automatiquement à la connexion
  // ─────────────────────────────────────────────────
  Future<void> start(String userId) async {
    if (_isRunning) return;
    _userId = userId;
    _isRunning = true;

    onStatusChanged?.call('Connexion au réseau BufferWave...');
    await _connectWebSocket();
  }

  // ─────────────────────────────────────────────────
  // CONNEXION WEBSOCKET
  // ─────────────────────────────────────────────────
  Future<void> _connectWebSocket() async {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(_wsUrl));

      // S'identifier comme RELAY (Marie partage sa connexion)
      _send({
        'type': 'IDENTIFY',
        'userId': _userId,
        'role': _role,
      });

      // Enregistrer comme nœud relais disponible
      _send({
        'type': 'REGISTER_RELAY',
        'userId': _userId,
        'bandwidthMbps': await _estimateBandwidth(),
        'country': await _getCountry(),
      });

      onStatusChanged?.call('✅ Partage actif — En attente de connexions');

      // Écouter les messages entrants
      _channel!.stream.listen(
        (message) => _handleMessage(message),
        onDone: () => _onDisconnected(),
        onError: (e) => _onError(e),
      );

      // Ping toutes les 30 secondes pour rester connecté
      _startPingLoop();

      // Charger et afficher les nœuds disponibles
      _loadNodes();

    } catch (e) {
      onStatusChanged?.call('Erreur connexion: $e');
      await Future.delayed(const Duration(seconds: 3));
      if (_isRunning) await _connectWebSocket();
    }
  }

  // ─────────────────────────────────────────────────
  // TRAITEMENT DES MESSAGES REÇUS
  // ─────────────────────────────────────────────────
  void _handleMessage(dynamic message) {
    try {
      final msg = json.decode(message as String);
      final type = msg['type'] as String? ?? '';

      switch (type) {

        // ── Identifié sur le réseau ──────────────────
        case 'IDENTIFIED':
          onStatusChanged?.call('✅ Connecté — Partage de connexion actif');
          break;

        // ── Jean demande accès à Internet via Marie ──
        case 'FORWARD_TO_INTERNET':
          _handleRelayRequest(msg);
          break;

        // ── Nouveau client connecté à Marie ──────────
        case 'RELAY_REQUEST':
          activeClients++;
          final fromUser = msg['fromUserId'] ?? 'unknown';
          onStatusChanged?.call('📡 $fromUser connecté via vous');
          break;

        // ── Pong keepalive ────────────────────────────
        case 'PONG':
          break;

        // ── Banni par admin ───────────────────────────
        case 'BANNED':
          onStatusChanged?.call('⛔ Compte suspendu');
          stop();
          break;

        // ── Liste des nœuds mise à jour ───────────────
        case 'NODES_UPDATE':
          final nodes = (msg['nodes'] as List?)
              ?.map((n) => Map<String, dynamic>.from(n))
              .toList() ?? [];
          onNodesUpdated?.call(nodes);
          break;
      }
    } catch (e) {
      // Message non-JSON ignoré
    }
  }

  // ─────────────────────────────────────────────────
  // CŒUR DU RELAIS — Marie exécute la requête de Jean
  // ─────────────────────────────────────────────────
  Future<void> _handleRelayRequest(Map msg) async {
    final requestId = msg['requestId'] as String? ?? '';
    final fromUserId = msg['fromUserId'] as String? ?? '';
    final data = msg['data'] as String? ?? '';
    final destIP = msg['destIP'] as String? ?? '';
    final destPort = msg['destPort'] as int? ?? 80;
    final protocol = msg['protocol'] as String? ?? 'TCP';

    try {
      // Décoder les données de Jean
      final packetBytes = base64Decode(data);

      // Reconstruire l'URL depuis le paquet IP
      final url = _reconstructUrl(destIP, destPort, packetBytes);

      if (url.isEmpty) return;

      onStatusChanged?.call('🌐 Relais: $url');

      // Exécuter la vraie requête HTTP pour Jean
      final response = await _executeHttpRequest(url, packetBytes, protocol);

      // Renvoyer la réponse à Jean via Cloudflare
      _send({
        'type': 'MARIE_RESPONSE',
        'toUserId': fromUserId,
        'requestId': requestId,
        'data': base64Encode(response),
        'status': 'success',
      });

      // Mettre à jour les stats
      bytesRelayed += response.length;
      requestsHandled++;
      onStatsUpdated?.call(bytesRelayed, requestsHandled);

      // Sauvegarder stats localement
      _saveStats();

    } catch (e) {
      // Envoyer erreur à Jean
      _send({
        'type': 'MARIE_RESPONSE',
        'toUserId': fromUserId,
        'requestId': requestId,
        'data': base64Encode(utf8.encode('ERROR: $e')),
        'status': 'error',
      });
    }
  }

  // ─────────────────────────────────────────────────
  // EXÉCUTION REQUÊTE HTTP RÉELLE
  // ─────────────────────────────────────────────────
  Future<List<int>> _executeHttpRequest(
    String url,
    List<int> rawPacket,
    String protocol,
  ) async {
    try {
      // Détecter le type de requête depuis le paquet
      final packetStr = utf8.decode(rawPacket, allowMalformed: true);
      
      http.Response response;

      if (packetStr.startsWith('GET ')) {
        response = await http.get(
          Uri.parse(url),
          headers: {'User-Agent': 'BufferWave/1.0'},
        ).timeout(const Duration(seconds: 15));

      } else if (packetStr.startsWith('POST ')) {
        // Extraire le body du paquet HTTP
        final bodyStart = packetStr.indexOf('\r\n\r\n');
        final body = bodyStart >= 0
            ? packetStr.substring(bodyStart + 4)
            : '';
        response = await http.post(
          Uri.parse(url),
          body: body,
          headers: {'User-Agent': 'BufferWave/1.0'},
        ).timeout(const Duration(seconds: 15));

      } else {
        // Par défaut GET
        response = await http.get(
          Uri.parse(url),
          headers: {'User-Agent': 'BufferWave/1.0'},
        ).timeout(const Duration(seconds: 15));
      }

      return response.bodyBytes;

    } catch (e) {
      return utf8.encode('HTTP Error: $e');
    }
  }

  // ─────────────────────────────────────────────────
  // RECONSTRUIRE URL DEPUIS PAQUET IP
  // ─────────────────────────────────────────────────
  String _reconstructUrl(String destIP, int destPort, List<int> packet) {
    try {
      // Chercher le Host header dans le paquet HTTP
      final packetStr = utf8.decode(packet, allowMalformed: true);
      
      // Extraire Host: header
      final hostMatch = RegExp(r'Host:\s*([^\r\n]+)').firstMatch(packetStr);
      if (hostMatch != null) {
        final host = hostMatch.group(1)?.trim() ?? '';
        final scheme = destPort == 443 ? 'https' : 'http';
        
        // Extraire le path
        final pathMatch = RegExp(r'(?:GET|POST|PUT|DELETE)\s+([^\s]+)')
            .firstMatch(packetStr);
        final path = pathMatch?.group(1) ?? '/';
        
        return '$scheme://$host$path';
      }

      // Fallback : utiliser IP directement
      final scheme = destPort == 443 ? 'https' : 'http';
      return '$scheme://$destIP:$destPort/';

    } catch (e) {
      return '';
    }
  }

  // ─────────────────────────────────────────────────
  // CHARGER LES NŒUDS DISPONIBLES
  // ─────────────────────────────────────────────────
  Future<void> _loadNodes() async {
    try {
      final response = await http.get(
        Uri.parse(
          'https://bufferwave-worker.bufferwave.workers.dev/nodes',
        ),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final nodes = (data['nodes'] as List?)
            ?.map((n) => Map<String, dynamic>.from(n))
            .toList() ?? [];
        onNodesUpdated?.call(nodes);
      }
    } catch (e) {
      // Silencieux
    }
  }

  // ─────────────────────────────────────────────────
  // SE CONNECTER À UN NŒUD SPÉCIFIQUE (Jean choisit)
  // ─────────────────────────────────────────────────
  Future<bool> connectToRelay(String relayNodeId) async {
    try {
      final response = await http.post(
        Uri.parse(
          'https://bufferwave-worker.bufferwave.workers.dev/connect',
        ),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'userId': _userId,
          'relayNodeId': relayNodeId,
          'userProfile': {'country': await _getCountry()},
        }),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          final mode = data['mode'];
          if (mode == 'cooperative_relay') {
            final relay = data['relay'];
            onStatusChanged?.call(
              '✅ Connecté via ${relay['nodeId']} (${relay['country']})',
            );
            return true;
          }
        }
      }
      return false;
    } catch (e) {
      onStatusChanged?.call('Erreur connexion relais: $e');
      return false;
    }
  }

  // ─────────────────────────────────────────────────
  // PING KEEPALIVE
  // ─────────────────────────────────────────────────
  void _startPingLoop() {
    Timer.periodic(const Duration(seconds: 30), (timer) {
      if (!_isRunning) {
        timer.cancel();
        return;
      }
      _send({'type': 'PING', 'userId': _userId});
      _loadNodes(); // Rafraîchir la liste des nœuds
    });
  }

  // ─────────────────────────────────────────────────
  // UTILITAIRES
  // ─────────────────────────────────────────────────
  void _send(Map<String, dynamic> data) {
    try {
      _channel?.sink.add(json.encode(data));
    } catch (e) {
      // Silencieux
    }
  }

  Future<void> _onDisconnected() async {
    onStatusChanged?.call('Déconnecté — Reconnexion...');
    await Future.delayed(const Duration(seconds: 3));
    if (_isRunning) await _connectWebSocket();
  }

  Future<void> _onError(dynamic error) async {
    onStatusChanged?.call('Erreur réseau — Reconnexion...');
    await Future.delayed(const Duration(seconds: 3));
    if (_isRunning) await _connectWebSocket();
  }

  Future<double> _estimateBandwidth() async {
    // Valeur par défaut — peut être améliorée avec speed test
    return 10.0;
  }

  Future<String> _getCountry() async {
    try {
      final response = await http
          .get(Uri.parse('https://ipapi.co/country/'))
          .timeout(const Duration(seconds: 5));
      return response.body.trim();
    } catch (e) {
      return 'UNKNOWN';
    }
  }

  Future<void> _saveStats() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('bytes_relayed', bytesRelayed);
    await prefs.setInt('requests_handled', requestsHandled);
  }

  Future<void> loadSavedStats() async {
    final prefs = await SharedPreferences.getInstance();
    bytesRelayed = prefs.getInt('bytes_relayed') ?? 0;
    requestsHandled = prefs.getInt('requests_handled') ?? 0;
  }

  // ─────────────────────────────────────────────────
  // ARRÊT
  // ─────────────────────────────────────────────────
  void stop() {
    _isRunning = false;
    _channel?.sink.close();
    _channel = null;
    onStatusChanged?.call('Partage désactivé');
  }

  bool get isRunning => _isRunning;
}