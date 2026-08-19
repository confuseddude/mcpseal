CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_id_unique" UNIQUE("key_id")
);
--> statement-breakpoint
CREATE TABLE "device_codes" (
	"device_code" uuid PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"workspace_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"ts" text NOT NULL,
	"type" text NOT NULL,
	"server" text NOT NULL,
	"tool" text NOT NULL,
	"observed_hash" text,
	"expected_hash" text,
	"description_diff" text,
	"client_app" text NOT NULL,
	"severity" text NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"chain_hash" text NOT NULL,
	"batch_signature" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"hostname_hash" text,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"mcpseal_version" text,
	CONSTRAINT "machines_machine_id_unique" UNIQUE("machine_id")
);
--> statement-breakpoint
CREATE TABLE "org_signing_keys" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lockfile_json" text NOT NULL,
	"signature" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_events_workspace_ts" ON "events" USING btree ("workspace_id","ts");