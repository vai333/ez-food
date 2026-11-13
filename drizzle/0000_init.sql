CREATE TABLE "achievements" (
	"user_id" uuid NOT NULL,
	"badge_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"validator_result" jsonb,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"error" text,
	"response" jsonb
);
--> statement-breakpoint
CREATE TABLE "busy_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"label" text DEFAULT 'Busy' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"meal_id" uuid,
	"kind" text DEFAULT 'deviation' NOT NULL,
	"deviation_type" text,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_text" text,
	"mood" smallint,
	"hunger" smallint,
	"energy" smallint,
	"joint_comfort" smallint,
	"digestion" smallint,
	"symptom_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"intervention_shown" text,
	"intervention_helped" boolean,
	"red_flag" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_event_id" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"free_text" text,
	"shown_context" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_queue_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "pantry_items" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preference_scores" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"alpha" real DEFAULT 1 NOT NULL,
	"beta" real DEFAULT 1 NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prep_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"date_due" date NOT NULL,
	"time_due" integer NOT NULL,
	"recipe_slug" text NOT NULL,
	"meal_date" date NOT NULL,
	"slot" text NOT NULL,
	"task_type" text NOT NULL,
	"instruction" text NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"recovery" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"ua" text,
	"last_ok_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"data" jsonb NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"validator" jsonb,
	"council" jsonb,
	"created_by_user" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "scheduled_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"day_no" integer NOT NULL,
	"slot" text NOT NULL,
	"planned_recipes" jsonb NOT NULL,
	"planned_start" integer NOT NULL,
	"planned_end" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"actual_recipe" text,
	"actual_at" timestamp with time zone,
	"shift_minutes" integer DEFAULT 0 NOT NULL,
	"shift_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"insight_type" text NOT NULL,
	"summary" text NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"suggested_adjustment" text,
	"status" text DEFAULT 'active' NOT NULL,
	"model_generated" boolean DEFAULT false NOT NULL,
	"user_edited_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_slug" text NOT NULL,
	"start_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_ref" text NOT NULL,
	"display_name" text DEFAULT 'Friend' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"eating_window_start" text DEFAULT '12:00' NOT NULL,
	"eating_window_end" text DEFAULT '20:00' NOT NULL,
	"wake_window_start" text DEFAULT '06:00' NOT NULL,
	"wake_window_end" text DEFAULT '08:00' NOT NULL,
	"learned_wake_time" text DEFAULT '06:45' NOT NULL,
	"strict_capsicum" boolean DEFAULT true NOT NULL,
	"clinician_aware" boolean DEFAULT false NOT NULL,
	"clinician_aware_at" timestamp with time zone,
	"disclaimer_ack_at" timestamp with time zone,
	"consent_personalisation" boolean DEFAULT true NOT NULL,
	"learning_paused" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"doctor_allows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dinner_carb" text DEFAULT 'rice' NOT NULL,
	"language_pref" text DEFAULT 'en' NOT NULL,
	"wake_hook_token_hash" text,
	"red_flag_until" timestamp with time zone,
	"notif_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"onboarded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_user_ref_unique" UNIQUE("user_ref")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"ref" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_queue" ADD CONSTRAINT "notification_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_scores" ADD CONSTRAINT "preference_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_tasks" ADD CONSTRAINT "prep_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_meals" ADD CONSTRAINT "scheduled_meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_insights" ADD CONSTRAINT "user_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ach_user_badge" ON "achievements" USING btree ("user_id","badge_id");--> statement-breakpoint
CREATE INDEX "ai_calls_hash" ON "ai_calls" USING btree ("prompt_hash");--> statement-breakpoint
CREATE INDEX "ai_calls_ts" ON "ai_calls" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "busy_user_date" ON "busy_blocks" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "checkins_user_date" ON "checkins" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "events_user_ts" ON "events" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "events_user_type" ON "events" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "events_client_id" ON "events" USING btree ("user_id","client_event_id");--> statement-breakpoint
CREATE INDEX "notif_due" ON "notification_queue" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pantry_user_key" ON "pantry_items" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "pref_user_key" ON "preference_scores" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "prep_user_key" ON "prep_tasks" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_user_date_slot" ON "scheduled_meals" USING btree ("user_id","date","slot");--> statement-breakpoint
CREATE INDEX "insights_user" ON "user_insights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_plans_user" ON "user_plans" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_user_ref" ON "xp_ledger" USING btree ("user_id","ref");--> statement-breakpoint
CREATE INDEX "xp_user_date" ON "xp_ledger" USING btree ("user_id","date");