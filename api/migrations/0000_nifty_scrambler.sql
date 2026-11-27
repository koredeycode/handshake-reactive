CREATE TABLE "alert_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rpc_url" text NOT NULL,
	"ws_url" text NOT NULL,
	"explorer" text,
	"callback_proxy" varchar(42),
	"log_chunk_size" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"last_block" bigint DEFAULT 0 NOT NULL,
	"last_block_hash" varchar(66),
	"last_event_at" timestamp with time zone,
	"status" text DEFAULT 'connecting' NOT NULL,
	"lag_seconds" integer DEFAULT 0 NOT NULL,
	"reconnect_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keeper_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"chain_id" integer NOT NULL,
	"action" text NOT NULL,
	"amount" numeric(78, 0),
	"tx_hash" varchar(66),
	"reason" text,
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keeper_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" varchar(42) NOT NULL,
	"chain_id" integer NOT NULL,
	"debt_wei" numeric(78, 0) DEFAULT '0' NOT NULL,
	"reserves_wei" numeric(78, 0) DEFAULT '0' NOT NULL,
	"alert_level" text DEFAULT 'ok' NOT NULL,
	"last_top_up_tx" varchar(66),
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"address" varchar(42) NOT NULL,
	"event_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" varchar(66) NOT NULL,
	"role" text NOT NULL,
	"seller" varchar(42) NOT NULL,
	"token" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"counterparty" varchar(42),
	"chain_id" integer NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"state" text DEFAULT 'locked' NOT NULL,
	"nonce" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"order_id" varchar(66) PRIMARY KEY NOT NULL,
	"terms_hash" varchar(66),
	"buyer" varchar(42),
	"seller" varchar(42),
	"payment_chain_id" integer,
	"asset_chain_id" integer,
	"payment_token" varchar(42),
	"payment_amount" numeric(78, 0),
	"asset_token" varchar(42),
	"asset_amount" numeric(78, 0),
	"deadline" numeric(78, 0),
	"status" text DEFAULT 'open' NOT NULL,
	"settle_requested" boolean DEFAULT false NOT NULL,
	"refund_requested" boolean DEFAULT false NOT NULL,
	"payment_seen" boolean DEFAULT false NOT NULL,
	"asset_seen" boolean DEFAULT false NOT NULL,
	"payment_closed" boolean DEFAULT false NOT NULL,
	"asset_closed" boolean DEFAULT false NOT NULL,
	"winner" varchar(42),
	"asset_lock_count" integer DEFAULT 0 NOT NULL,
	"nonce" bigint DEFAULT 0 NOT NULL,
	"payment_request_nonce" bigint DEFAULT 0 NOT NULL,
	"asset_request_nonce" bigint DEFAULT 0 NOT NULL,
	"protocol_violation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_settle_refund_check" CHECK (NOT ("orders"."settle_requested" AND "orders"."status" = 'refunded'))
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"order_id" varchar(66),
	"wallets" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"symbol" text,
	"decimals" integer,
	"verified" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'custom' NOT NULL,
	"metadata_hash" varchar(66),
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"payment_escrow" varchar(42) NOT NULL,
	"asset_escrow" varchar(42) NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"active_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_cache" (
	"wallet" varchar(42) NOT NULL,
	"chain_id" integer NOT NULL,
	"token" varchar(42) NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	"block_number" bigint NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_cache_wallet_chain_id_token_pk" PRIMARY KEY("wallet","chain_id","token")
);
--> statement-breakpoint
ALTER TABLE "indexer_state" ADD CONSTRAINT "indexer_state_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_legs" ADD CONSTRAINT "order_legs_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_deliveries_recent_idx" ON "alert_deliveries" USING btree ("kind","dedupe_key","created_at");--> statement-breakpoint
CREATE INDEX "keeper_actions_at_idx" ON "keeper_actions" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "keeper_state_target_chain_idx" ON "keeper_state" USING btree ("target","chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_events_chain_tx_log_idx" ON "order_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree (("payload"->>'orderId'));--> statement-breakpoint
CREATE INDEX "order_events_block_idx" ON "order_events" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "order_legs_order_role_seller_idx" ON "order_legs" USING btree ("order_id","role","seller");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller");--> statement-breakpoint
CREATE INDEX "orders_deadline_idx" ON "orders" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "outbox_created_at_idx" ON "outbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_order_id_idx" ON "outbox" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_chain_address_idx" ON "tokens" USING btree ("chain_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_chain_escrows_idx" ON "venues" USING btree ("chain_id","payment_escrow","asset_escrow");