-- LinkedIn Signal Monitor Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'business')),
    razorpay_customer_id TEXT,
    razorpay_subscription_id TEXT,
    webhook_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast API key lookups
CREATE INDEX idx_users_api_key ON users(api_key);

-- Profiles table
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linkedin_url TEXT NOT NULL,
    keywords JSONB NOT NULL,
    last_post_timestamp TIMESTAMP,
    next_scan_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_next_scan_at ON profiles(next_scan_at);

-- Events table
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    post_url TEXT NOT NULL,
    post_date TIMESTAMP NOT NULL,
    snippet TEXT,
    detected_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for event queries
CREATE INDEX idx_events_profile_id ON events(profile_id);
CREATE INDEX idx_events_detected_at ON events(detected_at);
CREATE INDEX idx_events_post_url ON events(post_url);

-- Unique constraint to prevent duplicate signal events
CREATE UNIQUE INDEX idx_events_unique ON events(profile_id, post_url, keyword);

-- Optional: Function to generate API keys
CREATE OR REPLACE FUNCTION generate_api_key()
RETURNS TEXT AS $$
BEGIN
    RETURN 'lsm_' || encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Optional: Trigger to auto-generate API key on user insert
CREATE OR REPLACE FUNCTION set_api_key()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.api_key IS NULL THEN
        NEW.api_key := generate_api_key();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_api_key
BEFORE INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION set_api_key();
