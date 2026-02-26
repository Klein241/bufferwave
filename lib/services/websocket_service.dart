import 'package:web_socket_channel/web_socket_channel.dart';
import 'dart:convert';

class WebSocketService {
  static const String wsUrl = 'wss://bufferwave-worker.bufferwave.workers.dev/tunnel';
  WebSocketChannel? _channel;
  Function(Map<String, dynamic>)? onMessage;
  
  Future<void> connect(String userId, String role) async {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      
      _channel!.sink.add(json.encode({
        'type': 'IDENTIFY',
        'userId': userId,
        'role': role,
      }));
      
      _channel!.stream.listen((message) {
        final data = json.decode(message);
        onMessage?.call(data);
      });
      
      print('WebSocket connected: ' + userId);
    } catch (e) {
      print('WebSocket error: ' + e.toString());
    }
  }
  
  void sendHeartbeat() {
    _channel?.sink.add(json.encode({'type': 'PING'}));
  }
  
  void disconnect() {
    _channel?.sink.close();
  }
}
