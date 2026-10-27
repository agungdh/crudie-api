CREATE TABLE "pegawai" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pegawai_nip_unique" ON "pegawai" USING btree (lower("nip")) WHERE "pegawai"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pegawai_email_unique" ON "pegawai" USING btree (lower("email")) WHERE "pegawai"."deleted_at" is null;