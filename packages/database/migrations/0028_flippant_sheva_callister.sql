CREATE TABLE "layer_collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"owner_user_id" uuid,
	"owner_group_id" uuid,
	"source_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layer_collection_owner_check" CHECK (num_nonnulls("layer_collection"."owner_user_id","layer_collection"."owner_group_id")=1)
);
--> statement-breakpoint
CREATE TABLE "layer_collection_member" (
	"collection_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "layer_collection_member_collection_id_layer_id_pk" PRIMARY KEY("collection_id","layer_id")
);
--> statement-breakpoint
CREATE TABLE "map_import_receipt" (
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_import_receipt_user_id_request_id_pk" PRIMARY KEY("user_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_owner_group_id_group_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_collection_member" ADD CONSTRAINT "layer_collection_member_collection_id_layer_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."layer_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_collection_member" ADD CONSTRAINT "layer_collection_member_layer_id_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_import_receipt" ADD CONSTRAINT "map_import_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;