ALTER TABLE "events" ADD COLUMN "sequence" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "events" e SET "sequence" = c.n FROM (
  SELECT "entity_id", count(*)::int AS n FROM "change_feed"
  WHERE "entity_type" = 'event' AND "change_type" = 'date_changed' GROUP BY "entity_id"
) c WHERE c."entity_id" = e."id";
