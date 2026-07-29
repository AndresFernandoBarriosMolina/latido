--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'banned',
    'deleted',
    'pending_deletion'
);


--
-- Name: auth_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.auth_provider AS ENUM (
    'password',
    'google'
);


--
-- Name: call_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.call_status AS ENUM (
    'ringing',
    'active',
    'ended',
    'rejected',
    'missed',
    'cancelled'
);


--
-- Name: gender_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender_type AS ENUM (
    'female',
    'male',
    'nonbinary',
    'other'
);


--
-- Name: kyc_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.kyc_status AS ENUM (
    'not_started',
    'submitted',
    'in_review',
    'approved',
    'rejected',
    'expired'
);


--
-- Name: ledger_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ledger_kind AS ENUM (
    'topup',
    'gift_out',
    'gift_in',
    'ppv_out',
    'ppv_in',
    'subscription',
    'payout',
    'refund',
    'adjustment',
    'fee'
);


--
-- Name: media_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_status AS ENUM (
    'uploading',
    'processing',
    'published',
    'draft',
    'scheduled',
    'removed'
);


--
-- Name: media_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_type AS ENUM (
    'photo',
    'video'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'pse',
    'nequi',
    'daviplata',
    'card',
    'bancolombia',
    'other'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'approved',
    'declined',
    'voided',
    'refunded',
    'error'
);


--
-- Name: payout_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_status AS ENUM (
    'requested',
    'approved',
    'processing',
    'paid',
    'rejected'
);


--
-- Name: presence_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.presence_status AS ENUM (
    'offline',
    'online',
    'in_call',
    'away'
);


--
-- Name: report_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_status AS ENUM (
    'open',
    'reviewing',
    'actioned',
    'dismissed',
    'resolved'
);


--
-- Name: sub_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sub_status AS ENUM (
    'active',
    'cancelled',
    'expired',
    'past_due',
    'trial'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'visitor',
    'user',
    'model',
    'moderator',
    'admin'
);


--
-- Name: visibility_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.visibility_type AS ENUM (
    'public',
    'subscribers',
    'ppv'
);


--
-- Name: forbid_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'append-only: UPDATE no permitido en %', TG_TABLE_NAME;
END; $$;


--
-- Name: forbid_update_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_update_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % no permitido en %', TG_OP, TG_TABLE_NAME;
END; $$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    actor_id uuid,
    action character varying(80) NOT NULL,
    entity character varying(60),
    entity_id uuid,
    ip inet,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auth_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider public.auth_provider NOT NULL,
    provider_uid character varying(255),
    password_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: content_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    doc_version character varying(20) NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    ip inet
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_a uuid NOT NULL,
    user_b uuid NOT NULL,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reason text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_deletion_at timestamp with time zone DEFAULT (now() + '15 days'::interval) NOT NULL,
    cancelled_at timestamp with time zone,
    processed_at timestamp with time zone
);


--
-- Name: diamond_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diamond_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(80) NOT NULL,
    diamonds integer NOT NULL,
    bonus_diamonds integer DEFAULT 0 NOT NULL,
    price_cop bigint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_flags (
    key character varying(80) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    rollout_pct smallint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gift_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gift_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(60) NOT NULL,
    emoji character varying(16),
    cost_diamonds integer NOT NULL,
    animation character varying(40),
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: gifts_sent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifts_sent (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gift_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    context character varying(20) NOT NULL,
    context_id uuid,
    cost_diamonds integer NOT NULL,
    model_earned_cop bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kyc_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status public.kyc_status DEFAULT 'submitted'::public.kyc_status NOT NULL,
    provider character varying(40),
    provider_ref character varying(120),
    document_type character varying(30),
    document_number_hash text,
    full_name character varying(160),
    document_front_key text,
    document_back_key text,
    selfie_key text,
    liveness_passed boolean,
    face_match_score numeric(4,3),
    age_from_doc integer,
    reviewer_id uuid,
    review_notes text,
    rejected_reason text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    expires_at timestamp with time zone
);


--
-- Name: media_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_access_log (
    id bigint NOT NULL,
    media_id uuid NOT NULL,
    user_id uuid NOT NULL,
    watermark_id character varying(64),
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.media_access_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.media_access_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: media_albums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_albums (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    cover_key text,
    is_public boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    type public.media_type NOT NULL,
    status public.media_status DEFAULT 'processing'::public.media_status NOT NULL,
    visibility public.visibility_type DEFAULT 'subscribers'::public.visibility_type NOT NULL,
    ppv_price_diamonds integer,
    original_key text NOT NULL,
    blurred_preview_key text,
    thumbnail_key text,
    hls_manifest_key text,
    drm_key_id text,
    width integer,
    height integer,
    duration_sec integer,
    caption text,
    likes_count integer DEFAULT 0 NOT NULL,
    views_count integer DEFAULT 0 NOT NULL,
    scheduled_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    album_id uuid
);


--
-- Name: media_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_likes (
    media_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text,
    media_id uuid,
    is_ppv boolean DEFAULT false NOT NULL,
    ppv_price_diamonds integer,
    unlocked_by uuid[],
    gift_sent_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    body_enc text,
    enc_ver smallint
);


--
-- Name: model_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_profiles (
    user_id uuid NOT NULL,
    handle public.citext NOT NULL,
    headline character varying(140),
    cover_key text,
    monthly_price_cop bigint DEFAULT 24900 NOT NULL,
    revenue_share_bps integer DEFAULT 7000 NOT NULL,
    accepts_calls boolean DEFAULT true NOT NULL,
    call_price_diamonds integer DEFAULT 0 NOT NULL,
    rating_avg numeric(2,1) DEFAULT 5.0,
    rating_count integer DEFAULT 0 NOT NULL,
    is_live boolean DEFAULT false NOT NULL,
    kyc_status public.kyc_status DEFAULT 'not_started'::public.kyc_status NOT NULL,
    kyc_approved_at timestamp with time zone,
    published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_countries text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: moderation_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid NOT NULL,
    target_user_id uuid,
    target_media_id uuid,
    action character varying(40) NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type character varying(40) NOT NULL,
    title character varying(140),
    body text,
    data jsonb,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    channel character varying(10) NOT NULL,
    purpose character varying(30) NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    attempts smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gateway character varying(20) NOT NULL,
    event_id character varying(120),
    signature text,
    signature_ok boolean,
    payload jsonb NOT NULL,
    processed_at timestamp with time zone,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    purpose character varying(20) NOT NULL,
    amount_cop bigint NOT NULL,
    method public.payment_method,
    status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    gateway character varying(20) DEFAULT 'wompi'::character varying NOT NULL,
    gateway_ref character varying(120),
    reference character varying(120),
    package_id uuid,
    subscription_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone
);


--
-- Name: payout_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    account_ref_encrypted text NOT NULL,
    holder_name character varying(160),
    is_default boolean DEFAULT false NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    method_id uuid,
    amount_cop bigint NOT NULL,
    fee_cop bigint DEFAULT 0 NOT NULL,
    tax_withheld_cop bigint DEFAULT 0 NOT NULL,
    status public.payout_status DEFAULT 'requested'::public.payout_status NOT NULL,
    approved_by uuid,
    gateway_ref character varying(120),
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    notes text,
    CONSTRAINT payouts_amount_cop_check CHECK ((amount_cop > 0))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    display_name character varying(80) NOT NULL,
    bio text,
    gender public.gender_type,
    interests text[],
    city character varying(80),
    country character varying(2) DEFAULT 'CO'::character varying,
    geo public.geography(Point,4326),
    avatar_key text,
    is_verified boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    target_user_id uuid,
    target_media_id uuid,
    reason character varying(60) NOT NULL,
    details text,
    status public.report_status DEFAULT 'open'::public.report_status NOT NULL,
    handled_by uuid,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: security_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(80) NOT NULL,
    config jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    refresh_hash text NOT NULL,
    device_label character varying(120),
    device_fp character varying(120),
    ip inet,
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid NOT NULL,
    model_id uuid NOT NULL,
    status public.sub_status DEFAULT 'active'::public.sub_status NOT NULL,
    price_cop bigint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    current_period_end timestamp with time zone NOT NULL,
    auto_renew boolean DEFAULT true NOT NULL,
    cancelled_at timestamp with time zone,
    gateway_sub_ref character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key character varying(80) NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_crypto_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_crypto_keys (
    user_id uuid NOT NULL,
    public_key_jwk jsonb NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role public.user_role DEFAULT 'user'::public.user_role NOT NULL,
    status public.account_status DEFAULT 'pending'::public.account_status NOT NULL,
    email public.citext,
    phone character varying(20),
    email_verified boolean DEFAULT false NOT NULL,
    phone_verified boolean DEFAULT false NOT NULL,
    birthdate date,
    age_verified boolean DEFAULT false NOT NULL,
    age_verified_at timestamp with time zone,
    data_consent_at timestamp with time zone,
    tos_version character varying(20),
    presence public.presence_status DEFAULT 'offline'::public.presence_status NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    totp_secret_enc text,
    totp_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_contact CHECK (((email IS NOT NULL) OR (phone IS NOT NULL)))
);


--
-- Name: video_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    caller_id uuid NOT NULL,
    callee_id uuid NOT NULL,
    status public.call_status DEFAULT 'ringing'::public.call_status NOT NULL,
    subscription_id uuid,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_sec integer,
    diamonds_spent integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_ledger (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    kind public.ledger_kind NOT NULL,
    diamonds_delta bigint DEFAULT 0 NOT NULL,
    cop_delta bigint DEFAULT 0 NOT NULL,
    balance_diamonds bigint,
    ref_type character varying(30),
    ref_id uuid,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.wallet_ledger ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.wallet_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    user_id uuid NOT NULL,
    diamonds bigint DEFAULT 0 NOT NULL,
    earnings_cop bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallets_diamonds_check CHECK ((diamonds >= 0)),
    CONSTRAINT wallets_earnings_cop_check CHECK ((earnings_cop >= 0))
);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auth_identities auth_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_pkey PRIMARY KEY (id);


--
-- Name: auth_identities auth_identities_provider_provider_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_provider_provider_uid_key UNIQUE (provider, provider_uid);


--
-- Name: blocks blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: content_consents content_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_consents
    ADD CONSTRAINT content_consents_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_user_a_user_b_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_a_user_b_key UNIQUE (user_a, user_b);


--
-- Name: deletion_requests deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_pkey PRIMARY KEY (id);


--
-- Name: diamond_packages diamond_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diamond_packages
    ADD CONSTRAINT diamond_packages_pkey PRIMARY KEY (id);


--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (key);


--
-- Name: gift_catalog gift_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_catalog
    ADD CONSTRAINT gift_catalog_pkey PRIMARY KEY (id);


--
-- Name: gifts_sent gifts_sent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_pkey PRIMARY KEY (id);


--
-- Name: kyc_verifications kyc_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_verifications
    ADD CONSTRAINT kyc_verifications_pkey PRIMARY KEY (id);


--
-- Name: media_access_log media_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_access_log
    ADD CONSTRAINT media_access_log_pkey PRIMARY KEY (id);


--
-- Name: media_albums media_albums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_albums
    ADD CONSTRAINT media_albums_pkey PRIMARY KEY (id);


--
-- Name: media_assets media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);


--
-- Name: media_likes media_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_likes
    ADD CONSTRAINT media_likes_pkey PRIMARY KEY (media_id, user_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: model_profiles model_profiles_handle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_profiles
    ADD CONSTRAINT model_profiles_handle_key UNIQUE (handle);


--
-- Name: model_profiles model_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_profiles
    ADD CONSTRAINT model_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: moderation_actions moderation_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: payment_webhooks payment_webhooks_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_webhooks
    ADD CONSTRAINT payment_webhooks_event_id_key UNIQUE (event_id);


--
-- Name: payment_webhooks payment_webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_webhooks
    ADD CONSTRAINT payment_webhooks_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_reference_key UNIQUE (reference);


--
-- Name: payout_methods payout_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_methods
    ADD CONSTRAINT payout_methods_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: security_policies security_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_policies
    ADD CONSTRAINT security_policies_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_subscriber_id_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_subscriber_id_model_id_key UNIQUE (subscriber_id, model_id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: content_consents uq_content_consent_model_ver; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_consents
    ADD CONSTRAINT uq_content_consent_model_ver UNIQUE (model_id, doc_version);


--
-- Name: user_crypto_keys user_crypto_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crypto_keys
    ADD CONSTRAINT user_crypto_keys_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: video_calls video_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_calls
    ADD CONSTRAINT video_calls_pkey PRIMARY KEY (id);


--
-- Name: wallet_ledger wallet_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (user_id);


--
-- Name: idx_albums_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_albums_model ON public.media_albums USING btree (model_id);


--
-- Name: idx_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_actor ON public.audit_log USING btree (actor_id);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity, entity_id);


--
-- Name: idx_auth_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_user ON public.auth_identities USING btree (user_id);


--
-- Name: idx_calls_callee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_callee ON public.video_calls USING btree (callee_id);


--
-- Name: idx_calls_caller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_caller ON public.video_calls USING btree (caller_id);


--
-- Name: idx_conv_last; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_last ON public.conversations USING btree (last_message_at DESC NULLS LAST);


--
-- Name: idx_conv_user_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_user_a ON public.conversations USING btree (user_a);


--
-- Name: idx_conv_user_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_user_b ON public.conversations USING btree (user_b);


--
-- Name: idx_del_req_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_del_req_user ON public.deletion_requests USING btree (user_id) WHERE ((cancelled_at IS NULL) AND (processed_at IS NULL));


--
-- Name: idx_gifts_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gifts_recipient ON public.gifts_sent USING btree (recipient_id);


--
-- Name: idx_gifts_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gifts_sender ON public.gifts_sent USING btree (sender_id);


--
-- Name: idx_kyc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kyc_status ON public.kyc_verifications USING btree (status);


--
-- Name: idx_kyc_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kyc_user ON public.kyc_verifications USING btree (user_id);


--
-- Name: idx_ledger_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_kind ON public.wallet_ledger USING btree (kind);


--
-- Name: idx_ledger_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_user ON public.wallet_ledger USING btree (user_id);


--
-- Name: idx_macc_media; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_macc_media ON public.media_access_log USING btree (media_id);


--
-- Name: idx_macc_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_macc_user ON public.media_access_log USING btree (user_id);


--
-- Name: idx_media_album; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_album ON public.media_assets USING btree (album_id);


--
-- Name: idx_media_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_model ON public.media_assets USING btree (model_id);


--
-- Name: idx_media_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_status ON public.media_assets USING btree (status);


--
-- Name: idx_media_visib; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_visib ON public.media_assets USING btree (visibility);


--
-- Name: idx_messages_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conv ON public.messages USING btree (conversation_id, created_at DESC);


--
-- Name: idx_model_handle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_handle ON public.model_profiles USING btree (handle);


--
-- Name: idx_model_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_live ON public.model_profiles USING btree (is_live) WHERE (is_live = true);


--
-- Name: idx_notif_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_user ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_payments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_user ON public.payments USING btree (user_id);


--
-- Name: idx_payouts_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_model ON public.payouts USING btree (model_id);


--
-- Name: idx_payouts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_status ON public.payouts USING btree (status);


--
-- Name: idx_profiles_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_city ON public.profiles USING btree (city);


--
-- Name: idx_profiles_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_geo ON public.profiles USING gist (geo);


--
-- Name: idx_profiles_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_name_trgm ON public.profiles USING gin (display_name public.gin_trgm_ops);


--
-- Name: idx_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_status ON public.reports USING btree (status);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user ON public.sessions USING btree (user_id);


--
-- Name: idx_sub_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_model ON public.subscriptions USING btree (model_id);


--
-- Name: idx_sub_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_status ON public.subscriptions USING btree (status);


--
-- Name: idx_sub_subscriber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_subscriber ON public.subscriptions USING btree (subscriber_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: audit_log trg_audit_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_immutable BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();


--
-- Name: wallet_ledger trg_ledger_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON public.wallet_ledger FOR EACH ROW EXECUTE FUNCTION public.forbid_update();


--
-- Name: media_access_log trg_macc_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_macc_no_update BEFORE UPDATE ON public.media_access_log FOR EACH ROW EXECUTE FUNCTION public.forbid_update();


--
-- Name: profiles trg_profiles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wallets trg_wallets_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: auth_identities auth_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: blocks blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: blocks blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: content_consents content_consents_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_consents
    ADD CONSTRAINT content_consents_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_user_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_a_fkey FOREIGN KEY (user_a) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_user_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_b_fkey FOREIGN KEY (user_b) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: deletion_requests deletion_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: gifts_sent gifts_sent_gift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_gift_id_fkey FOREIGN KEY (gift_id) REFERENCES public.gift_catalog(id);


--
-- Name: gifts_sent gifts_sent_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: gifts_sent gifts_sent_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts_sent
    ADD CONSTRAINT gifts_sent_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: kyc_verifications kyc_verifications_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_verifications
    ADD CONSTRAINT kyc_verifications_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id);


--
-- Name: kyc_verifications kyc_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_verifications
    ADD CONSTRAINT kyc_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_access_log media_access_log_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_access_log
    ADD CONSTRAINT media_access_log_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;


--
-- Name: media_access_log media_access_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_access_log
    ADD CONSTRAINT media_access_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_albums media_albums_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_albums
    ADD CONSTRAINT media_albums_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_assets media_assets_album_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.media_albums(id) ON DELETE SET NULL;


--
-- Name: media_assets media_assets_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_likes media_likes_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_likes
    ADD CONSTRAINT media_likes_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;


--
-- Name: media_likes media_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_likes
    ADD CONSTRAINT media_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_gift_sent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_gift_sent_id_fkey FOREIGN KEY (gift_sent_id) REFERENCES public.gifts_sent(id);


--
-- Name: messages messages_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media_assets(id);


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: model_profiles model_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_profiles
    ADD CONSTRAINT model_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: moderation_actions moderation_actions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: moderation_actions moderation_actions_target_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_target_media_id_fkey FOREIGN KEY (target_media_id) REFERENCES public.media_assets(id) ON DELETE SET NULL;


--
-- Name: moderation_actions moderation_actions_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: otp_codes otp_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payments payments_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.diamond_packages(id);


--
-- Name: payments payments_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id);


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payout_methods payout_methods_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_methods
    ADD CONSTRAINT payout_methods_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payouts payouts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: payouts payouts_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_method_id_fkey FOREIGN KEY (method_id) REFERENCES public.payout_methods(id);


--
-- Name: payouts payouts_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.users(id);


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_target_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_target_media_id_fkey FOREIGN KEY (target_media_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;


--
-- Name: reports reports_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: security_policies security_policies_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_policies
    ADD CONSTRAINT security_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: user_crypto_keys user_crypto_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crypto_keys
    ADD CONSTRAINT user_crypto_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_calls video_calls_callee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_calls
    ADD CONSTRAINT video_calls_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_calls video_calls_caller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_calls
    ADD CONSTRAINT video_calls_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_calls video_calls_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_calls
    ADD CONSTRAINT video_calls_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id);


--
-- Name: wallet_ledger wallet_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallets wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

