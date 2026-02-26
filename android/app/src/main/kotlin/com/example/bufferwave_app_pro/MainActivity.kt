package com.example.bufferwave_app_pro

import android.content.Intent
import android.net.VpnService
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity: FlutterActivity() {
    private val CHANNEL = "bufferwave.vpn/control"
    private val VPN_REQUEST_CODE = 1

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "startVpn" -> {
                    val relayServer = call.argument<String>("relayServer")
                    startVpnService(relayServer ?: "", result)
                }
                "stopVpn" -> {
                    stopVpnService(result)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun startVpnService(relayServer: String, result: MethodChannel.Result) {
        val intent = VpnService.prepare(this)
        if (intent != null) {
            startActivityForResult(intent, VPN_REQUEST_CODE)
            result.success(false)
        } else {
            val serviceIntent = Intent(this, BufferWaveVpnService::class.java)
            serviceIntent.putExtra("RELAY_SERVER", relayServer)
            startService(serviceIntent)
            result.success(true)
        }
    }

    private fun stopVpnService(result: MethodChannel.Result) {
        val serviceIntent = Intent(this, BufferWaveVpnService::class.java)
        stopService(serviceIntent)
        result.success(true)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE && resultCode == RESULT_OK) {
            val serviceIntent = Intent(this, BufferWaveVpnService::class.java)
            startService(serviceIntent)
        }
    }
}
