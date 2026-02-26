import 'package:http/http.dart' as http;
import 'dart:convert';

class BufferWaveAPI {
  static const String baseUrl = 'https://bufferwave-worker.bufferwave.workers.dev';
  
  static Future<Map<String, dynamic>> getStatus() async {
    final response = await http.get(Uri.parse(baseUrl + '/status'));
    return json.decode(response.body);
  }
  
  static Future<bool> registerNode(String userId, String country) async {
    final response = await http.post(
      Uri.parse(baseUrl + '/register'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'userId': userId,
        'country': country,
        'bandwidthMbps': 10,
      }),
    );
    return response.statusCode == 200;
  }
  
  static Future<List<dynamic>> getNodes() async {
    final response = await http.get(Uri.parse(baseUrl + '/nodes'));
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['nodes'] ?? [];
    }
    return [];
  }
}
