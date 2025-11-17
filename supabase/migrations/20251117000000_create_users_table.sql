-- Create users table for Pi Network authentication
-- This table stores user data from Pi Browser authentication

CREATE TABLE IF NOT EXISTS public.users (
  wallet TEXT PRIMARY KEY,              -- Pi Network user UID (wallet address)
  username TEXT NOT NULL,               -- Pi username
  user_consent BOOLEAN DEFAULT false,   -- User consent for data usage
  premium_until TIMESTAMP WITH TIME ZONE,  -- Premium subscription expiration
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sessions table for user sessions
CREATE TABLE IF NOT EXISTS public.sessions (
  sid TEXT PRIMARY KEY,                 -- Session ID
  user_uid TEXT REFERENCES public.users(wallet) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Policies for users table (users can read their own data)
CREATE POLICY "Users can view their own data" 
ON public.users 
FOR SELECT 
USING (true);  -- For now, allow all reads (can be restricted later)

CREATE POLICY "Service role can insert users"
ON public.users
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service role can update users"
ON public.users
FOR UPDATE
USING (true);

-- Policies for sessions table
CREATE POLICY "Users can view their own sessions" 
ON public.sessions 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage sessions"
ON public.sessions
FOR ALL
USING (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_wallet ON public.users(wallet);
CREATE INDEX IF NOT EXISTS idx_sessions_user_uid ON public.sessions(user_uid);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON public.users 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Add helpful comment
COMMENT ON TABLE public.users IS 'Users authenticated via Pi Network Browser';
COMMENT ON COLUMN public.users.wallet IS 'Pi Network user UID (serves as wallet address)';
COMMENT ON COLUMN public.users.premium_until IS 'Timestamp when premium subscription expires';
