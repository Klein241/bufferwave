import 'package:flutter/services.dart';

class VpnService {
  static const platform = MethodChannel('bufferwave.vpn/control');

  static Future<bool> startVpn(String relayServer) async {
    try {
      final result = await platform.invokeMethod('startVpn', {
        'relayServer': relayServer,
      });
      return result as bool;
    } catch (e) {
      print('Error starting VPN: ' + e.toString());
      return false;
    }
  }

  static Future<bool> stopVpn() async {
    try {
      final result = await platform.invokeMethod('stopVpn');
      return result as bool;
    } catch (e) {
      print('Error stopping VPN: ' + e.toString());
      return false;
    }
  }
}
