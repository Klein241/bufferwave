import 'package:flutter/material.dart';
import 'screens/home_screen.dart';

void main() {
  runApp(BufferWaveApp());
}

class BufferWaveApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BufferWave Pro',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primaryColor: Color(0xFF00FFB9),
        scaffoldBackgroundColor: Color(0xFF0D1F1F),
      ),
      home: HomeScreen(),
    );
  }
}
