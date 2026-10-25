// 버전 2의 배포용 DDL 스냅샷이다.
// 앱 실행 중에는 drizzle-kit으로 다시 생성하지 않는다.
// 보호 트리거는 migrate.ts가 schema-v2.guards.ts에서 가져와 별도로 설치한다.
export const schemaV2Sql: readonly string[] = Object.freeze([
    `CREATE TABLE "download_attempt" (
    "id" text PRIMARY KEY NOT NULL,
    "job_id" text NOT NULL,
    "attempt_no" integer NOT NULL,
    "target_media_id" integer,
    "target_media_id_snapshot" integer,
    "trigger" text NOT NULL,
    "phase" text NOT NULL,
    "outcome" text,
    "manifest_path" text,
    "cancel_requested_at" integer,
    "started_at" integer NOT NULL,
    "finished_at" integer,
    "committed_at" integer,
    FOREIGN KEY ("job_id") REFERENCES "download_queue"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("target_media_id") REFERENCES "media"("id") ON UPDATE no action ON DELETE set null,
    CONSTRAINT "ck_download_attempt_no" CHECK(attempt_no > 0),
    CONSTRAINT "ck_download_trigger" CHECK(trigger IN ('manual_initial','manual_retry','manual_restart','auto_recovery')),
    CONSTRAINT "ck_download_phase" CHECK(phase IN ('discovering','downloading','verifying','committing','rolling_back','finished')),
    CONSTRAINT "ck_download_outcome" CHECK(outcome IS NULL OR outcome IN ('completed','failed','cancelled','interrupted')),
    CONSTRAINT "ck_download_commit" CHECK(committed_at IS NULL OR (outcome IS NOT NULL AND outcome = 'completed'))
);`,

    `CREATE UNIQUE INDEX "uq_download_attempt_no" ON "download_attempt" ("job_id","attempt_no");`,

    `CREATE UNIQUE INDEX "uq_download_attempt_owner" ON "download_attempt" ("job_id","id");`,

    `CREATE UNIQUE INDEX "uq_download_attempt_target" ON "download_attempt" ("target_media_id","id");`,

    `CREATE TABLE "download_queue" (
    "id" text PRIMARY KEY NOT NULL,
    "request_url_id" integer NOT NULL,
    "original_url" text NOT NULL,
    "mode" text NOT NULL,
    "target_media_id" integer,
    "target_media_id_snapshot" integer,
    "state" text DEFAULT 'pending' NOT NULL,
    "options_json" text NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "recovery_enabled" integer DEFAULT false NOT NULL,
    "auto_run_limit" integer DEFAULT 1 NOT NULL,
    "auto_run_count" integer DEFAULT 0,
    "auto_history_unknown" integer DEFAULT false NOT NULL,
    "current_attempt_id" text,
    "cleanup_required" integer DEFAULT false NOT NULL,
    "title" text,
    "thumbnail" text,
    "error_code" text,
    "error_message" text,
    "log" text,
    "started_at" integer,
    "finished_at" integer,
    "created_at" integer,
    "updated_at" integer,
    FOREIGN KEY ("request_url_id") REFERENCES "download_urls"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("target_media_id") REFERENCES "media"("id") ON UPDATE no action ON DELETE set null,
    FOREIGN KEY ("id","current_attempt_id") REFERENCES "download_attempt"("job_id","id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_download_mode" CHECK(mode IN ('create','replace')),
    CONSTRAINT "ck_download_state" CHECK(state IN ('pending','running','completed','failed','cancelled','interrupted')),
    CONSTRAINT "ck_download_progress" CHECK(progress BETWEEN 0 AND 100),
    CONSTRAINT "ck_download_flags" CHECK(recovery_enabled IN (0,1) AND auto_history_unknown IN (0,1) AND cleanup_required IN (0,1)),
    CONSTRAINT "ck_download_auto" CHECK(auto_run_limit >= 0 AND ((auto_history_unknown = 1 AND auto_run_count IS NULL AND recovery_enabled = 0) OR (auto_history_unknown = 0 AND auto_run_count IS NOT NULL AND auto_run_count >= 0))),
    CONSTRAINT "ck_download_options" CHECK(json_valid(options_json))
);`,

    `CREATE UNIQUE INDEX "uq_active_download_url" ON "download_queue" ("request_url_id") WHERE state IN ('pending','running') OR cleanup_required = 1;`,

    `CREATE INDEX "idx_download_state" ON "download_queue" ("state","created_at");`,

    `CREATE TABLE "download_target" (
    "id" text PRIMARY KEY NOT NULL,
    "attempt_id" text NOT NULL,
    "target_key" text NOT NULL,
    "source_url" text NOT NULL,
    "metadata_json" text NOT NULL,
    "position" integer NOT NULL,
    "state" text NOT NULL,
    "staged_path" text,
    "final_path" text,
    "error_code" text,
    FOREIGN KEY ("attempt_id") REFERENCES "download_attempt"("id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_download_target_position" CHECK(position >= 0),
    CONSTRAINT "ck_download_target_state" CHECK(state IN ('pending','downloading','downloaded','verified','failed')),
    CONSTRAINT "ck_download_target_json" CHECK(json_valid(metadata_json))
);`,

    `CREATE UNIQUE INDEX "uq_download_target_key" ON "download_target" ("attempt_id","target_key");`,

    `CREATE UNIQUE INDEX "uq_download_target_position" ON "download_target" ("attempt_id","position");`,

    `CREATE TABLE "download_urls" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "url" text NOT NULL,
    "normalized_url" text NOT NULL,
    "normalization_version" integer NOT NULL,
    "legacy_video_id" text,
    "created_at" integer NOT NULL,
    CONSTRAINT "ck_url_version" CHECK(normalization_version > 0)
);`,

    `CREATE UNIQUE INDEX "uq_request_url" ON "download_urls" ("normalization_version","normalized_url");`,

    `CREATE TABLE "favorite" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "media_id" integer NOT NULL,
    "created_at" integer NOT NULL,
    FOREIGN KEY ("media_id") REFERENCES "media"("id") ON UPDATE no action ON DELETE cascade
);`,

    `CREATE UNIQUE INDEX "uq_favorite_media" ON "favorite" ("media_id");`,

    `CREATE TABLE "legacy_record" (
    "table_name" text NOT NULL,
    "row_key" text NOT NULL,
    "payload_json" text NOT NULL,
    PRIMARY KEY("table_name", "row_key"),
    CONSTRAINT "ck_legacy_json" CHECK(json_valid(payload_json))
);`,

    `CREATE TABLE "local_folder_location" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "local_folder_id" integer NOT NULL,
    "media_id" integer NOT NULL,
    "directory_path" text NOT NULL,
    "directory_key" text NOT NULL,
    "key_version" integer NOT NULL,
    "state" text NOT NULL,
    FOREIGN KEY ("media_id","local_folder_id") REFERENCES "local_folder"("media_id","id") ON UPDATE no action ON DELETE cascade,
    CONSTRAINT "ck_location_version" CHECK(key_version > 0),
    CONSTRAINT "ck_location_state" CHECK(state IN ('active','reserved','history'))
);`,

    `CREATE UNIQUE INDEX "uq_location_owner" ON "local_folder_location" ("media_id","id");`,

    `CREATE UNIQUE INDEX "uq_reserved_directory" ON "local_folder_location" ("directory_key") WHERE state IN ('active','reserved');`,

    `CREATE TABLE "local_folder" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "media_id" integer NOT NULL,
    "source_title" text NOT NULL,
    "revision" integer DEFAULT 0 NOT NULL,
    FOREIGN KEY ("media_id") REFERENCES "media"("id") ON UPDATE no action ON DELETE cascade,
    CONSTRAINT "ck_local_folder_revision" CHECK(revision >= 0)
);`,

    `CREATE UNIQUE INDEX "uq_local_folder_media" ON "local_folder" ("media_id");`,

    `CREATE UNIQUE INDEX "uq_local_folder_owner" ON "local_folder" ("media_id","id");`,

    `CREATE TABLE "local_import_attempt" (
    "id" text PRIMARY KEY NOT NULL,
    "import_folder_id" text NOT NULL,
    "attempt_no" integer NOT NULL,
    "phase" text NOT NULL,
    "expected_media_revision" integer,
    "commit_token" text NOT NULL,
    "manifest_path" text,
    "outcome" text,
    "started_at" integer NOT NULL,
    "finished_at" integer,
    "committed_at" integer,
    FOREIGN KEY ("import_folder_id") REFERENCES "local_import_folder"("id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_import_attempt_no" CHECK(attempt_no > 0),
    CONSTRAINT "ck_import_expected_revision" CHECK(expected_media_revision IS NULL OR expected_media_revision >= 0),
    CONSTRAINT "ck_import_phase" CHECK(phase IN ('inspecting','committing','rolling_back','finished')),
    CONSTRAINT "ck_import_outcome" CHECK(outcome IS NULL OR outcome IN ('completed','failed','cancelled','interrupted')),
    CONSTRAINT "ck_import_commit" CHECK(committed_at IS NULL OR (outcome IS NOT NULL AND outcome = 'completed'))
);`,

    `CREATE UNIQUE INDEX "uq_import_attempt_no" ON "local_import_attempt" ("import_folder_id","attempt_no");`,

    `CREATE UNIQUE INDEX "uq_import_attempt_owner" ON "local_import_attempt" ("import_folder_id","id");`,

    `CREATE UNIQUE INDEX "uq_import_commit_token" ON "local_import_attempt" ("commit_token");`,

    `CREATE TABLE "local_import_folder" (
    "id" text PRIMARY KEY NOT NULL,
    "job_id" text NOT NULL,
    "directory_path" text NOT NULL,
    "directory_key" text NOT NULL,
    "relative_path" text NOT NULL,
    "local_folder_id" integer,
    "state" text NOT NULL,
    "current_attempt_id" text,
    "cleanup_required" integer DEFAULT false NOT NULL,
    "error_code" text,
    FOREIGN KEY ("job_id") REFERENCES "local_import_job"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("local_folder_id") REFERENCES "local_folder"("id") ON UPDATE no action ON DELETE set null,
    FOREIGN KEY ("id","current_attempt_id") REFERENCES "local_import_attempt"("import_folder_id","id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_import_folder_state" CHECK(state IN ('pending','running','completed','failed','cancelled','interrupted','skipped')),
    CONSTRAINT "ck_import_folder_cleanup" CHECK(cleanup_required IN (0,1))
);`,

    `CREATE UNIQUE INDEX "uq_import_job_directory" ON "local_import_folder" ("job_id","directory_key");`,

    `CREATE TABLE "local_import_job" (
    "id" text PRIMARY KEY NOT NULL,
    "root_path" text NOT NULL,
    "root_key" text NOT NULL,
    "scan_revision" integer DEFAULT 0 NOT NULL,
    "state" text NOT NULL,
    "cancel_requested_at" integer,
    "cleanup_required" integer DEFAULT false NOT NULL,
    "counts_json" text NOT NULL,
    "revision" integer DEFAULT 0 NOT NULL,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL,
    CONSTRAINT "ck_import_job_state" CHECK(state IN ('scanning','ready','pending','running','completed','failed','cancelled','interrupted')),
    CONSTRAINT "ck_import_job_revisions" CHECK(revision >= 0 AND scan_revision >= 0),
    CONSTRAINT "ck_import_job_cleanup" CHECK(cleanup_required IN (0,1)),
    CONSTRAINT "ck_import_job_counts" CHECK(json_valid(counts_json))
);`,

    `CREATE INDEX "idx_import_job_state" ON "local_import_job" ("state","created_at");`,

    `CREATE TABLE "local_import_target" (
    "id" text PRIMARY KEY NOT NULL,
    "attempt_id" text NOT NULL,
    "path_key" text NOT NULL,
    "relative_path" text NOT NULL,
    "expected_stat_json" text NOT NULL,
    "inspection_json" text,
    "state" text NOT NULL,
    "error_code" text,
    FOREIGN KEY ("attempt_id") REFERENCES "local_import_attempt"("id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_import_target_state" CHECK(state IN ('pending','inspected','unchanged','changed','failed')),
    CONSTRAINT "ck_import_target_json" CHECK(json_valid(expected_stat_json) AND (inspection_json IS NULL OR json_valid(inspection_json)))
);`,

    `CREATE UNIQUE INDEX "uq_import_target_path" ON "local_import_target" ("attempt_id","path_key");`,

    `CREATE TABLE "maintenance_task" (
    "id" text PRIMARY KEY NOT NULL,
    "kind" text NOT NULL,
    "state" text NOT NULL,
    "owner_kind" text NOT NULL,
    "download_attempt_id" text,
    "local_attempt_id" text,
    "payload_json" text NOT NULL,
    "try_count" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL,
    FOREIGN KEY ("download_attempt_id") REFERENCES "download_attempt"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("local_attempt_id") REFERENCES "local_import_attempt"("id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_maintenance_kind" CHECK(kind IN ('rollback_cleanup','obsolete_file_cleanup','search_reindex','deletion_cleanup','preview_generation')),
    CONSTRAINT "ck_maintenance_state" CHECK(state IN ('pending','running','completed','failed')),
    CONSTRAINT "ck_maintenance_owner" CHECK((owner_kind = 'system' AND download_attempt_id IS NULL AND local_attempt_id IS NULL) OR (owner_kind = 'download' AND download_attempt_id IS NOT NULL AND local_attempt_id IS NULL) OR (owner_kind = 'local' AND local_attempt_id IS NOT NULL AND download_attempt_id IS NULL)),
    CONSTRAINT "ck_maintenance_try_count" CHECK(try_count >= 0),
    CONSTRAINT "ck_maintenance_payload" CHECK(json_valid(payload_json))
);`,

    `CREATE INDEX "idx_maintenance_state" ON "maintenance_task" ("state","kind");`,

    `CREATE TABLE "media_file" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "media_id" integer NOT NULL,
    "file_key" text NOT NULL,
    "storage_kind" text NOT NULL,
    "source_url" text,
    "legacy_url_id" integer,
    "external_id" text,
    "platform_id" integer,
    "profile_id" integer,
    "title" text,
    "filepath" text NOT NULL,
    "canonical_path_key" text,
    "relative_path" text,
    "local_folder_location_id" integer,
    "filesize" integer,
    "mtime_ns" text,
    "hash_algorithm" text,
    "content_hash" text,
    "kind" text NOT NULL,
    "position" integer NOT NULL,
    "duration" real,
    "detected_format" text,
    "width" integer,
    "height" integer,
    "orientation" integer,
    "frame_count" integer,
    "page_count" integer,
    "primary_image_index" integer,
    "thumbnail_path" text,
    "thumbnail_origin" text DEFAULT 'none' NOT NULL,
    "preview_path" text,
    "cache_key" text,
    "image_engine_version" text,
    "transform_version" text,
    "created_at" integer NOT NULL,
    FOREIGN KEY ("media_id") REFERENCES "media"("id") ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY ("legacy_url_id") REFERENCES "download_urls"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("platform_id") REFERENCES "platform"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("platform_id","profile_id") REFERENCES "profiles"("platform_id","id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("media_id","local_folder_location_id") REFERENCES "local_folder_location"("media_id","id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_file_profile_platform" CHECK(profile_id IS NULL OR platform_id IS NOT NULL),
    CONSTRAINT "ck_file_storage" CHECK(storage_kind IN ('app_managed','external_reference','unverified_legacy')),
    CONSTRAINT "ck_file_kind" CHECK(kind IN ('image','video','audio','unknown')),
    CONSTRAINT "ck_file_position" CHECK(position >= 0),
    CONSTRAINT "ck_file_size_duration" CHECK((filesize IS NULL OR filesize >= 0) AND (duration IS NULL OR duration >= 0)),
    CONSTRAINT "ck_file_identity" CHECK(length(file_key) > 0 AND length(filepath) > 0),
    CONSTRAINT "ck_file_hash" CHECK((hash_algorithm IS NULL AND content_hash IS NULL) OR (hash_algorithm IS NOT NULL AND hash_algorithm = 'sha256' AND content_hash IS NOT NULL AND length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
    CONSTRAINT "ck_external_metadata" CHECK(storage_kind <> 'external_reference' OR (kind = 'image' AND canonical_path_key IS NOT NULL AND length(canonical_path_key) > 0 AND relative_path IS NOT NULL AND length(relative_path) > 0 AND local_folder_location_id IS NOT NULL AND filesize IS NOT NULL AND mtime_ns IS NOT NULL AND hash_algorithm IS NOT NULL AND content_hash IS NOT NULL AND detected_format IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)),
    CONSTRAINT "ck_managed_location" CHECK(storage_kind = 'external_reference' OR local_folder_location_id IS NULL),
    CONSTRAINT "ck_image_dimensions" CHECK((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)),
    CONSTRAINT "ck_image_structure" CHECK((orientation IS NULL OR orientation BETWEEN 1 AND 8) AND (frame_count IS NULL OR frame_count > 0) AND (page_count IS NULL OR page_count > 0) AND (primary_image_index IS NULL OR primary_image_index >= 0)),
    CONSTRAINT "ck_thumbnail_origin" CHECK(thumbnail_origin IN ('none','app_generated','unverified_legacy')),
    CONSTRAINT "ck_thumbnail_path" CHECK((thumbnail_origin = 'none' AND thumbnail_path IS NULL) OR (thumbnail_origin <> 'none' AND thumbnail_path IS NOT NULL))
);`,

    `CREATE UNIQUE INDEX "uq_file_parent_id" ON "media_file" ("media_id","id");`,

    `CREATE UNIQUE INDEX "uq_file_key" ON "media_file" ("media_id","file_key");`,

    `CREATE UNIQUE INDEX "uq_file_position" ON "media_file" ("media_id","position");`,

    `CREATE UNIQUE INDEX "uq_external_path" ON "media_file" ("canonical_path_key") WHERE storage_kind = 'external_reference';`,

    `CREATE INDEX "idx_file_content_hash" ON "media_file" ("content_hash");`,

    `CREATE TABLE "media_tag" (
    "media_id" integer NOT NULL,
    "tag_id" integer NOT NULL,
    PRIMARY KEY("media_id", "tag_id"),
    FOREIGN KEY ("media_id") REFERENCES "media"("id") ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON UPDATE no action ON DELETE cascade
);`,

    `CREATE TABLE "media" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "source_kind" text NOT NULL,
    "request_url_id" integer,
    "source_title" text,
    "custom_title" text,
    "cover_file_id" integer,
    "cover_mode" text DEFAULT 'auto' NOT NULL,
    "last_download_commit_attempt_id" text,
    "revision" integer DEFAULT 0 NOT NULL,
    "created_at" integer NOT NULL,
    "updated_at" integer,
    FOREIGN KEY ("request_url_id") REFERENCES "download_urls"("id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("id","cover_file_id") REFERENCES "media_file"("media_id","id") ON UPDATE no action ON DELETE no action,
    FOREIGN KEY ("id","last_download_commit_attempt_id") REFERENCES "download_attempt"("target_media_id","id") ON UPDATE no action ON DELETE no action,
    CONSTRAINT "ck_media_source" CHECK(source_kind IN ('download','local','legacy')),
    CONSTRAINT "ck_media_request" CHECK((source_kind = 'download' AND request_url_id IS NOT NULL) OR (source_kind IN ('local','legacy') AND request_url_id IS NULL)),
    CONSTRAINT "ck_media_cover" CHECK((cover_mode = 'auto' AND cover_file_id IS NULL) OR (cover_mode = 'manual' AND cover_file_id IS NOT NULL)),
    CONSTRAINT "ck_media_revision" CHECK(revision >= 0)
);`,

    `CREATE UNIQUE INDEX "uq_media_request_url" ON "media" ("request_url_id");`,

    `CREATE TABLE "migration_run" (
    "id" text PRIMARY KEY NOT NULL,
    "target_version" integer NOT NULL,
    "source_fingerprint" text NOT NULL,
    "schema_hash" text NOT NULL,
    "backup_path" text,
    "completed_at" integer NOT NULL,
    CONSTRAINT "ck_migration_version" CHECK(target_version > 0)
);`,

    `CREATE UNIQUE INDEX "uq_migration_version" ON "migration_run" ("target_version");`,

    `CREATE TABLE "platform" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "name" text NOT NULL
);`,

    `CREATE UNIQUE INDEX "platform_name_unique" ON "platform" ("name");`,

    `CREATE TABLE "profiles" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "owner_id" text NOT NULL,
    "owner_name" text,
    "platform_id" integer NOT NULL,
    "updated_at" integer NOT NULL,
    FOREIGN KEY ("platform_id") REFERENCES "platform"("id") ON UPDATE no action ON DELETE no action
);`,

    `CREATE UNIQUE INDEX "uq_owner_platform" ON "profiles" ("owner_id","platform_id");`,

    `CREATE UNIQUE INDEX "uq_profile_platform_id" ON "profiles" ("platform_id","id");`,

    `CREATE TABLE "tag" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "name" text NOT NULL,
    "updated_at" integer
);`,

    `CREATE UNIQUE INDEX "tag_name_unique" ON "tag" ("name");`
])
