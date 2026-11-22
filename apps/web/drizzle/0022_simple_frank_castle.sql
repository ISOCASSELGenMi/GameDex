CREATE TABLE "metacritic_pages" (
	"slug" varchar(255) PRIMARY KEY NOT NULL,
	"state" varchar(16) NOT NULL,
	"title" text,
	"release_date" date,
	"release_year" integer,
	"companies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metascore" integer,
	"metascore_count" integer,
	"userscore" numeric(5, 1),
	"userscore_count" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
