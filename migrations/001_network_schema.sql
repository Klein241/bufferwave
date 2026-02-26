-- ============================================================
-- BUFFERWAVE NETWORK — Schéma Supabase v2
-- Réseau Coopératif + DTN NASA Style
-- ============================================================

-- Table des nœuds du réseau
CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  country TEXT,
  ip_address TEXT,
  status TEXT DEFAULT 'offline',
  bandwidth_available_mbps NUMERIC DEFAULT 5,
  public_key TEXT,
  family_group TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des sessions de relais actives
CREATE TABLE IF NOT EXISTS relay_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_user_id TEXT NOT NULL,
  relay_user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  bytes_relayed BIGINT DEFAULT 0,
  status TEXT DEFAULT 'active'
);

-- Table DTN — Messages en attente (principe NASA)
-- Aucun message ne sera jamais perdu
CREATE TABLE IF NOT EXISTS pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id TEXT NOT NULL,
  to_user_id TEXT,
  encrypted_payload TEXT NOT NULL,
  type TEXT DEFAULT 'message',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending'
);

-- Table crédits bande passante
-- Tu partages = Tu reçois
CREATE TABLE IF NOT EXISTS bandwidth_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  credits_earned_mb NUMERIC DEFAULT 0,
  credits_used_mb NUMERIC DEFAULT 0,
  balance_mb NUMERIC GENERATED ALWAYS AS
    (credits_earned_mb - credits_used_mb) STORED,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_nodes_status
  ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_country
  ON nodes(country);
CREATE INDEX IF NOT EXISTS idx_pending_status
  ON pending_messages(status);
CREATE INDEX IF NOT EXISTS idx_pending_from
  ON pending_messages(from_user_id);
CREATE INDEX IF NOT EXISTS idx_relay_source
  ON relay_sessions(source_user_id);

-- RLS (Row Level Security)
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bandwidth_credits ENABLE ROW LEVEL SECURITY;

-- Politiques d'accès
CREATE POLICY "nodes_public_read" ON nodes
  FOR SELECT USING (true);

CREATE POLICY "nodes_own_write" ON nodes
  FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "messages_own" ON pending_messages
  FOR ALL USING (
    auth.uid()::text = from_user_id OR
    auth.uid()::text = to_user_id
  );

CREATE POLICY "credits_own" ON bandwidth_credits
  FOR ALL USING (auth.uid()::text = user_id);
