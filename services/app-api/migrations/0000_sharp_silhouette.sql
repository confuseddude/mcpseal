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
	"prev_hash" text,
	"chain_hash" text,
	"batch_signature" text
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
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
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
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sso_configs" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"domain" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"scim_token_hash" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"stripe_sub_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "subscriptions_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
