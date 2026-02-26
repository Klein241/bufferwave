package com.example.bufferwave_app_pro

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor

class BufferWaveVpnService : VpnService() {

    companion object {
        const val ACTION_START = "START_VPN"
        const val ACTION_STOP = "STOP_VPN"
        var isRunning = false
    }

    private var vpnInterface: ParcelFileDescriptor? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopVpn(); return START_NOT_STICKY }
        startVpn()
        return START_STICKY
    }

    private fun startVpn() {
        isRunning = true
        createChannel()
        startForeground(1, buildNotif("BufferWave actif"))
        vpnInterface = Builder()
            .setSession("BufferWave")
            .addAddress("10.0.0.2", 24)
            .addDnsServer("1.1.1.1")
            .addRoute("0.0.0.0", 0)
            .addDisallowedApplication(packageName)
            .establish()
    }

    private fun stopVpn() {
        isRunning = false
        vpnInterface?.close()
        vpnInterface = null
        stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() { stopVpn(); super.onDestroy() }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(
                    NotificationChannel("bw_vpn", "BufferWave", NotificationManager.IMPORTANCE_LOW)
                )
        }
    }

    private fun buildNotif(text: String): Notification {
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, "bw_vpn")
        else @Suppress("DEPRECATION") Notification.Builder(this)
        return b.setContentTitle("BufferWave DTN")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .build()
    }
}