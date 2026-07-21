CREATE TABLE "bot_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_bars" jsonb NOT NULL,
	"last_heartbeat" timestamp with time zone,
	"last_error" text,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_pnl" (
	"date" date PRIMARY KEY NOT NULL,
	"start_equity" double precision NOT NULL,
	"end_equity" double precision NOT NULL,
	"pnl" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"equity" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"strategy" text NOT NULL,
	"direction" text NOT NULL,
	"qty" double precision NOT NULL,
	"entry_price" double precision NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"atr_at_entry" double precision NOT NULL,
	"hard_stop" double precision NOT NULL,
	"watermark" double precision NOT NULL,
	"trail_stop" double precision,
	"trail_atr_mult" double precision,
	"last_price" double precision,
	CONSTRAINT "positions_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"symbol" text NOT NULL,
	"strategy" text NOT NULL,
	"direction" text NOT NULL,
	"qty" double precision NOT NULL,
	"entry_price" double precision NOT NULL,
	"exit_price" double precision NOT NULL,
	"pnl" double precision NOT NULL,
	"exit_reason" text NOT NULL,
	"entry_time" timestamp with time zone NOT NULL
);
