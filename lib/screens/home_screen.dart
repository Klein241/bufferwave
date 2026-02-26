import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/relay_service.dart';
import '../services/vpn_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {

  final RelayService _relayService = RelayService();

  bool _isConnected      = false;
  bool _isSharing        = false;
  bool _isLoading        = false;
  String _statusText     = 'Appuyez pour activer BufferWave';
  String _connectedRelay = '';
  String _userId         = '';

  List<Map<String, dynamic>> _nodes = [];

  int _bytesDown   = 0;
  int _bytesUp     = 0;
  int _activeUsers = 0;
  Duration _sessionTime = Duration.zero;
  Timer? _sessionTimer;

  late AnimationController _pulseCtrl;
  late Animation<double>    _pulseAnim;

  static const Color _cyan    = Color(0xFF00E5FF);
  static const Color _darkBg  = Color(0xFF0A0E1A);
  static const Color _cardBg  = Color(0xFF111827);
  static const Color _cardBg2 = Color(0xFF1A2235);

  static const String _workerUrl =
      'wss://bufferwave-worker.bufferwave.workers.dev/tunnel';

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    );
    _pulseAnim = Tween<double>(begin: 1.0, end: 1.15).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut),
    );
    _initUser();
    _setupRelayCallbacks();
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _sessionTimer?.cancel();
    _relayService.stop();
    super.dispose();
  }

  Future<void> _initUser() async {
    final prefs = await SharedPreferences.getInstance();
    String? uid = prefs.getString('user_id');
    if (uid == null) {
      uid = 'user_${DateTime.now().millisecondsSinceEpoch}';
      await prefs.setString('user_id', uid);
    }
    setState(() => _userId = uid!);
    await _relayService.loadSavedStats();
    await _startBufferWave();
  }

  void _setupRelayCallbacks() {
    _relayService.onStatusChanged = (status) {
      if (mounted) setState(() => _statusText = status);
    };
    _relayService.onStatsUpdated = (bytes, requests) {
      if (mounted) setState(() {
        _bytesUp     = bytes;
        _activeUsers = requests;
      });
    };
    _relayService.onNodesUpdated = (nodes) {
      if (mounted) setState(() =>
        _nodes = List<Map<String, dynamic>>.from(nodes));
    };
  }

  Future<void> _startBufferWave() async {
    if (_isLoading) return;
    setState(() {
      _isLoading  = true;
      _statusText = 'Connexion en cours...';
    });
    try {
      await _relayService.start(_userId);
      await VpnService.startVpn(_workerUrl);
      setState(() {
        _isConnected = true;
        _isSharing   = true;
        _isLoading   = false;
        _statusText  = 'BufferWave actif - Partage active';
      });
      _pulseCtrl.repeat(reverse: true);
      _startSessionTimer();
    } catch (e) {
      setState(() {
        _isLoading  = false;
        _statusText = 'Erreur: $e';
      });
    }
  }

  Future<void> _stopBufferWave() async {
    _relayService.stop();
    await VpnService.stopVpn();
    _pulseCtrl.stop();
    _sessionTimer?.cancel();
    setState(() {
      _isConnected    = false;
      _isSharing      = false;
      _connectedRelay = '';
      _statusText     = 'BufferWave desactive';
      _sessionTime    = Duration.zero;
      _nodes          = [];
    });
  }

  Future<void> _connectToNode(Map<String, dynamic> node) async {
    final nodeId = node['id'] as String? ?? '';
    setState(() => _statusText = 'Connexion a $nodeId...');
    final success = await _relayService.connectToRelay(nodeId);
    setState(() {
      if (success) {
        _connectedRelay = nodeId;
        _statusText = 'Connecte via $nodeId';
      } else {
        _statusText = 'Connexion echouee - Reessayez';
      }
    });
  }

  void _startSessionTimer() {
    _sessionTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _sessionTime += const Duration(seconds: 1));
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _darkBg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            children: [
              _buildHeader(),
              const SizedBox(height: 24),
              _buildPowerButton(),
              const SizedBox(height: 16),
              _buildStatusCard(),
              const SizedBox(height: 20),
              _buildStatsRow(),
              const SizedBox(height: 20),
              _buildNodesSection(),
              const SizedBox(height: 20),
              _buildSessionInfo(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('BufferWave',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.2,
              ),
            ),
            Text('Reseau DTN Cooperatif',
              style: TextStyle(color: Colors.white54, fontSize: 12),
            ),
          ],
        ),
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: _isSharing
                    ? Colors.green.withOpacity(0.2)
                    : Colors.grey.withOpacity(0.2),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: _isSharing ? Colors.green : Colors.grey,
                  width: 1,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    _isSharing ? Icons.share : Icons.share_outlined,
                    color: _isSharing ? Colors.green : Colors.grey,
                    size: 14,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    _isSharing ? 'Partage ON' : 'Partage OFF',
                    style: TextStyle(
                      color: _isSharing ? Colors.green : Colors.grey,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: _cardBg,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                _userId.length > 10
                    ? '${_userId.substring(0, 10)}...'
                    : _userId,
                style: const TextStyle(color: _cyan, fontSize: 10),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPowerButton() {
    return GestureDetector(
      onTap: _isLoading
          ? null
          : (_isConnected ? _stopBufferWave : _startBufferWave),
      child: AnimatedBuilder(
        animation: _pulseAnim,
        builder: (context, child) {
          return Transform.scale(
            scale: _isConnected ? _pulseAnim.value : 1.0,
            child: Container(
              width: 140,
              height: 140,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: _isConnected
                      ? [_cyan.withOpacity(0.3), _cyan.withOpacity(0.05)]
                      : [Colors.grey.withOpacity(0.2), Colors.transparent],
                ),
                border: Border.all(
                  color: _isConnected ? _cyan : Colors.grey.withOpacity(0.4),
                  width: 2,
                ),
                boxShadow: _isConnected
                    ? [BoxShadow(color: _cyan.withOpacity(0.4), blurRadius: 30)]
                    : [],
              ),
              child: _isLoading
                  ? const Center(
                      child: CircularProgressIndicator(
                        color: Color(0xFF00E5FF),
                      ),
                    )
                  : Icon(
                      Icons.power_settings_new,
                      size: 56,
                      color: _isConnected ? _cyan : Colors.grey,
                    ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildStatusCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: _isConnected
              ? _cyan.withOpacity(0.3)
              : Colors.grey.withOpacity(0.2),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _isConnected ? Colors.green : Colors.red,
              boxShadow: _isConnected
                  ? [BoxShadow(
                      color: Colors.green.withOpacity(0.6), blurRadius: 8)]
                  : [],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              _statusText,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    return Row(
      children: [
        Expanded(child: _statCard('Recu',    _formatBytes(_bytesDown), Colors.blue)),
        const SizedBox(width: 12),
        Expanded(child: _statCard('Relaye',  _formatBytes(_bytesUp),   Colors.green)),
        const SizedBox(width: 12),
        Expanded(child: _statCard('Clients', '$_activeUsers',           _cyan)),
      ],
    );
  }

  Widget _statCard(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          Text(label,
            style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 11),
          ),
          const SizedBox(height: 6),
          Text(value,
            style: TextStyle(
              color: color,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNodesSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Noeuds disponibles',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              '${_nodes.length} en ligne',
              style: const TextStyle(color: _cyan, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (_nodes.isEmpty)
          _buildEmptyNodes()
        else
          ..._nodes.map((node) => _buildNodeCard(node)),
      ],
    );
  }

  Widget _buildEmptyNodes() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.1)),
      ),
      child: Column(
        children: [
          Icon(Icons.wifi_off, color: Colors.white.withOpacity(0.3), size: 40),
          const SizedBox(height: 12),
          Text(
            _isConnected
                ? 'Recherche de noeuds...'
                : 'Activez BufferWave pour voir les noeuds',
            style: TextStyle(
              color: Colors.white.withOpacity(0.5),
              fontSize: 13,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildNodeCard(Map<String, dynamic> node) {
    final nodeId    = node['id'] as String? ?? 'unknown';
    final country   = node['country'] as String? ?? '??';
    final bandwidth = node['bandwidthMbps'] as num? ?? 0;
    final hasWs     = node['hasWebSocket'] as bool? ?? false;
    final isActive  = _connectedRelay == nodeId;
    final signal    = _calculateSignal(bandwidth.toDouble());

    return GestureDetector(
      onTap: _isConnected ? () => _connectToNode(node) : null,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isActive ? _cyan.withOpacity(0.15) : _cardBg2,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isActive ? _cyan : Colors.white.withOpacity(0.1),
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: _cardBg,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Center(
                child: Text(
                  _countryFlag(country),
                  style: const TextStyle(fontSize: 22),
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    nodeId.length > 16
                        ? '${nodeId.substring(0, 16)}...'
                        : nodeId,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Text(country,
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.5),
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: hasWs
                              ? Colors.green.withOpacity(0.2)
                              : Colors.orange.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          hasWs ? 'En ligne' : 'DTN',
                          style: TextStyle(
                            color: hasWs ? Colors.green : Colors.orange,
                            fontSize: 10,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                _buildSignalBars(signal),
                const SizedBox(height: 4),
                Text(
                  '${bandwidth.toStringAsFixed(1)} Mb/s',
                  style: const TextStyle(
                    color: _cyan,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: isActive ? _cyan : _cyan.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                isActive ? 'Actif' : 'Connecter',
                style: TextStyle(
                  color: isActive ? _darkBg : _cyan,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSessionInfo() {
    final h = _sessionTime.inHours.toString().padLeft(2, '0');
    final m = (_sessionTime.inMinutes % 60).toString().padLeft(2, '0');
    final s = (_sessionTime.inSeconds % 60).toString().padLeft(2, '0');
    final timeStr = h + ':' + m + ':' + s;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _infoItem('Session', timeStr),
          _infoItem('Relais', _connectedRelay.isEmpty
              ? 'Auto'
              : _connectedRelay.substring(0, min(8, _connectedRelay.length))),
          _infoItem('Mode', _isConnected ? 'DTN Actif' : 'Inactif'),
        ],
      ),
    );
  }

  Widget _infoItem(String label, String value) {
    return Column(
      children: [
        Text(label,
          style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 11),
        ),
        const SizedBox(height: 4),
        Text(value,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 13,
          ),
        ),
      ],
    );
  }

  int _calculateSignal(double bandwidth) {
    if (bandwidth >= 50) return 4;
    if (bandwidth >= 20) return 3;
    if (bandwidth >= 10) return 2;
    if (bandwidth >= 1)  return 1;
    return 0;
  }

  Widget _buildSignalBars(int level) {
    return Row(
      children: List.generate(4, (i) {
        return Container(
          width: 4,
          height: 6.0 + (i * 3),
          margin: const EdgeInsets.only(left: 2),
          decoration: BoxDecoration(
            color: i < level ? _cyan : Colors.grey.withOpacity(0.3),
            borderRadius: BorderRadius.circular(2),
          ),
        );
      }),
    );
  }

  String _countryFlag(String code) {
    if (code.length != 2) return '?';
    final flag = code.toUpperCase().runes
        .map((r) => String.fromCharCode(r + 0x1F1A5))
        .join();
    return flag;
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024)       return '${bytes}B';
    if (bytes < 1048576)    return '${(bytes / 1024).toStringAsFixed(1)}KB';
    if (bytes < 1073741824) return '${(bytes / 1048576).toStringAsFixed(1)}MB';
    return '${(bytes / 1073741824).toStringAsFixed(1)}GB';
  }
}