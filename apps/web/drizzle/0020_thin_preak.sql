CREATE TABLE "metacritic_slugs" (
	"slug" varchar(255) PRIMARY KEY NOT NULL,
	"name_norm" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "metacritic_slugs_name_trgm_idx" ON "metacritic_slugs" USING gin ("name_norm" gin_trgm_ops);