CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by" varchar(128) NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_settings_audit_changed_idx" ON "app_settings_audit" USING btree ("changed_at" DESC NULLS LAST,"id" DESC NULLS LAST);