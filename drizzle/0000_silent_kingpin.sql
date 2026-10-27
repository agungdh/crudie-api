CREATE TABLE "pegawai" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pegawai_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nip" text NOT NULL,
	"nama" text NOT NULL,
	"email" text,
	"jabatan" text,
	"unit_kerja" text,
	"telepon" text,
	"alamat" text,
	"status" text DEFAULT 'aktif' NOT NULL,
	"tanggal_masuk" date,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE INDEX "pegawai_uuid_idx" ON "pegawai" USING hash ("uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "pegawai_nip_unique" ON "pegawai" USING btree (lower("nip")) WHERE "pegawai"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pegawai_email_unique" ON "pegawai" USING btree (lower("email")) WHERE "pegawai"."deleted_at" is null;