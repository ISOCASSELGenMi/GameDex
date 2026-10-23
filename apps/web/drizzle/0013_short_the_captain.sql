CREATE TYPE "public"."unlock_type" AS ENUM('theme', 'collectible', 'achievement');--> statement-breakpoint
CREATE TABLE "user_unlocks" (
	"user_id" integer NOT NULL,
	"type" "unlock_type" NOT NULL,
	"key" varchar(48) NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_unlocks_user_id_type_key_pk" PRIMARY KEY("user_id","type","key")
);
--> statement-breakpoint
ALTER TABLE "user_unlocks" ADD CONSTRAINT "user_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;