CREATE TABLE "pending_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_order_id" text NOT NULL,
	"broker_order_id" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"purpose" text NOT NULL,
	"qty" double precision NOT NULL,
	"strategy" text NOT NULL,
	"direction" text NOT NULL,
	"atr_at_entry" double precision,
	"trail_atr_mult" double precision,
	"entry_price" double precision,
	"entry_time" timestamp with time zone,
	"exit_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pending_orders_client_order_id_unique" UNIQUE("client_order_id")
);
