CREATE TABLE "game_engines" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	CONSTRAINT "game_engines_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "game_engines_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "game_game_engines" (
	"game_id" integer NOT NULL,
	"game_engine_id" integer NOT NULL,
	CONSTRAINT "game_game_engines_game_id_game_engine_id_pk" PRIMARY KEY("game_id","game_engine_id")
);
--> statement-breakpoint
CREATE TABLE "game_game_modes" (
	"game_id" integer NOT NULL,
	"game_mode_id" integer NOT NULL,
	CONSTRAINT "game_game_modes_game_id_game_mode_id_pk" PRIMARY KEY("game_id","game_mode_id")
);
--> statement-breakpoint
CREATE TABLE "game_modes" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	CONSTRAINT "game_modes_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "game_modes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "game_player_perspectives" (
	"game_id" integer NOT NULL,
	"player_perspective_id" integer NOT NULL,
	CONSTRAINT "game_player_perspectives_game_id_player_perspective_id_pk" PRIMARY KEY("game_id","player_perspective_id")
);
--> statement-breakpoint
CREATE TABLE "player_perspectives" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	CONSTRAINT "player_perspectives_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "player_perspectives_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "version_parent_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "version_title" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "storyline" text;--> statement-breakpoint
ALTER TABLE "game_game_engines" ADD CONSTRAINT "game_game_engines_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_game_engines" ADD CONSTRAINT "game_game_engines_game_engine_id_game_engines_id_fk" FOREIGN KEY ("game_engine_id") REFERENCES "public"."game_engines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_game_modes" ADD CONSTRAINT "game_game_modes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_game_modes" ADD CONSTRAINT "game_game_modes_game_mode_id_game_modes_id_fk" FOREIGN KEY ("game_mode_id") REFERENCES "public"."game_modes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_player_perspectives" ADD CONSTRAINT "game_player_perspectives_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_player_perspectives" ADD CONSTRAINT "game_player_perspectives_player_perspective_id_player_perspectives_id_fk" FOREIGN KEY ("player_perspective_id") REFERENCES "public"."player_perspectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_game_engines_game_engine_game_idx" ON "game_game_engines" USING btree ("game_engine_id","game_id");--> statement-breakpoint
CREATE INDEX "game_game_modes_game_mode_game_idx" ON "game_game_modes" USING btree ("game_mode_id","game_id");--> statement-breakpoint
CREATE INDEX "game_player_perspectives_player_perspective_game_idx" ON "game_player_perspectives" USING btree ("player_perspective_id","game_id");--> statement-breakpoint
CREATE INDEX "games_parent_type_idx" ON "games" USING btree ("parent_game_id","game_type");--> statement-breakpoint
CREATE INDEX "games_version_parent_idx" ON "games" USING btree ("version_parent_id");