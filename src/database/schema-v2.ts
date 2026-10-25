import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
  type SQLiteTableExtraConfigValue
} from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at').notNull().$defaultFn(Date.now)

const updatedAt = () =>
  integer('updated_at').notNull().$defaultFn(Date.now)

const ck = (name: string, expression: string) =>
  check(name, sql.raw(expression))

export const jobStates = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
] as const

export const phases = [
  'discovering',
  'downloading',
  'verifying',
  'committing',
  'rolling_back',
  'finished'
] as const

export const outcomes = [
  'completed',
  'failed',
  'cancelled',
  'interrupted'
] as const

// 플랫폼·프로필·URL

export const platforms = sqliteTable('platform', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique()
})

export const profiles = sqliteTable('profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id').notNull(),
  ownerName: text('owner_name'),
  platformId: integer('platform_id')
    .notNull()
    .references(() => platforms.id),
  updatedAt: updatedAt()
}, t => [
  uniqueIndex('uq_owner_platform').on(t.ownerId, t.platformId),
  uniqueIndex('uq_profile_platform_id').on(t.platformId, t.id)
])

export const downloadUrls = sqliteTable('download_urls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull(),
  normalizationVersion: integer('normalization_version').notNull(),
  legacyVideoId: text('legacy_video_id'),
  createdAt: createdAt()
}, t => [
  uniqueIndex('uq_request_url')
    .on(t.normalizationVersion, t.normalizedUrl),
  ck('ck_url_version', 'normalization_version > 0')
])

// 부모 묶음

export const medias = sqliteTable('media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceKind: text('source_kind', {
    enum: ['download', 'local', 'legacy']
  }).notNull(),
  requestUrlId: integer('request_url_id')
    .references(() => downloadUrls.id),
  sourceTitle: text('source_title'),
  customTitle: text('custom_title'),
  coverFileId: integer('cover_file_id'),
  coverMode: text('cover_mode', {
    enum: ['auto', 'manual']
  }).notNull().default('auto'),
  lastDownloadCommitAttemptId: text('last_download_commit_attempt_id'),
  revision: integer('revision').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: integer('updated_at').$defaultFn(Date.now)
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('uq_media_request_url').on(t.requestUrlId),

  // 다른 부모의 파일을 표지로 지정할 수 없다.
  foreignKey({
    columns: [t.id, t.coverFileId],
    foreignColumns: [mediaFiles.mediaId, mediaFiles.id]
  }),

  foreignKey({
    columns: [t.id, t.lastDownloadCommitAttemptId],
    foreignColumns: [
      downloadAttempts.targetMediaId,
      downloadAttempts.id
    ]
  }),

  ck(
    'ck_media_source',
    "source_kind IN ('download','local','legacy')"
  ),
  ck(
    'ck_media_request',
    "(source_kind = 'download' AND request_url_id IS NOT NULL) OR " +
    "(source_kind IN ('local','legacy') AND request_url_id IS NULL)"
  ),
  ck(
    'ck_media_cover',
    "(cover_mode = 'auto' AND cover_file_id IS NULL) OR " +
    "(cover_mode = 'manual' AND cover_file_id IS NOT NULL)"
  ),
  ck('ck_media_revision', 'revision >= 0')
])

// 개별 파일

export const mediaFiles = sqliteTable('media_file', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaId: integer('media_id')
    .notNull()
    .references(
      (): AnySQLiteColumn => medias.id,
      { onDelete: 'cascade' }
    ),
  fileKey: text('file_key').notNull(),
  storageKind: text('storage_kind', {
    enum: [
      'app_managed',
      'external_reference',
      'unverified_legacy'
    ]
  }).notNull(),

  sourceUrl: text('source_url'),
  legacyUrlId: integer('legacy_url_id')
    .references(() => downloadUrls.id),
  externalId: text('external_id'),
  platformId: integer('platform_id')
    .references(() => platforms.id),
  profileId: integer('profile_id')
    .references(() => profiles.id),
  title: text('title'),

  filepath: text('filepath').notNull(),
  canonicalPathKey: text('canonical_path_key'),
  relativePath: text('relative_path'),
  localFolderLocationId: integer('local_folder_location_id'),
  filesize: integer('filesize'),
  mtimeNs: text('mtime_ns'),
  hashAlgorithm: text('hash_algorithm', { enum: ['sha256'] }),
  contentHash: text('content_hash'),

  kind: text('kind', {
    enum: ['image', 'video', 'audio', 'unknown']
  }).notNull(),
  position: integer('position').notNull(),
  duration: real('duration'),

  detectedFormat: text('detected_format'),
  width: integer('width'),
  height: integer('height'),
  orientation: integer('orientation'),
  frameCount: integer('frame_count'),
  pageCount: integer('page_count'),
  primaryImageIndex: integer('primary_image_index'),

  thumbnailPath: text('thumbnail_path'),
  thumbnailOrigin: text('thumbnail_origin', {
    enum: ['none', 'app_generated', 'unverified_legacy']
  }).notNull().default('none'),
  previewPath: text('preview_path'),
  cacheKey: text('cache_key'),
  imageEngineVersion: text('image_engine_version'),
  transformVersion: text('transform_version'),
  createdAt: createdAt()
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('uq_file_parent_id').on(t.mediaId, t.id),
  uniqueIndex('uq_file_key').on(t.mediaId, t.fileKey),
  uniqueIndex('uq_file_position').on(t.mediaId, t.position),

  // 같은 내용의 다른 경로는 허용하고 같은 원본 경로만 막는다.
  uniqueIndex('uq_external_path')
    .on(t.canonicalPathKey)
    .where(sql.raw("storage_kind = 'external_reference'")),

  index('idx_file_content_hash').on(t.contentHash),

  foreignKey({
    columns: [t.platformId, t.profileId],
    foreignColumns: [profiles.platformId, profiles.id]
  }),

  foreignKey({
    columns: [t.mediaId, t.localFolderLocationId],
    foreignColumns: [
      localFolderLocations.mediaId,
      localFolderLocations.id
    ]
  }),

  ck(
    'ck_file_profile_platform',
    'profile_id IS NULL OR platform_id IS NOT NULL'
  ),
  ck(
    'ck_file_storage',
    "storage_kind IN " +
    "('app_managed','external_reference','unverified_legacy')"
  ),
  ck(
    'ck_file_kind',
    "kind IN ('image','video','audio','unknown')"
  ),
  ck('ck_file_position', 'position >= 0'),
  ck(
    'ck_file_size_duration',
    '(filesize IS NULL OR filesize >= 0) AND ' +
    '(duration IS NULL OR duration >= 0)'
  ),
  ck(
    'ck_file_identity',
    'length(file_key) > 0 AND length(filepath) > 0'
  ),
  ck(
    'ck_file_hash',
    '(hash_algorithm IS NULL AND content_hash IS NULL) OR ' +
    "(hash_algorithm IS NOT NULL AND hash_algorithm = 'sha256' " +
    'AND content_hash IS NOT NULL AND length(content_hash) = 64 ' +
    "AND content_hash NOT GLOB '*[^0-9a-f]*')"
  ),
  ck(
    'ck_external_metadata',
    "storage_kind <> 'external_reference' OR (" +
    "kind = 'image' " +
    'AND canonical_path_key IS NOT NULL ' +
    'AND length(canonical_path_key) > 0 ' +
    'AND relative_path IS NOT NULL AND length(relative_path) > 0 ' +
    'AND local_folder_location_id IS NOT NULL ' +
    'AND filesize IS NOT NULL AND mtime_ns IS NOT NULL ' +
    'AND hash_algorithm IS NOT NULL AND content_hash IS NOT NULL ' +
    'AND detected_format IS NOT NULL ' +
    'AND width IS NOT NULL AND height IS NOT NULL)'
  ),
  ck(
    'ck_managed_location',
    "storage_kind = 'external_reference' OR " +
    'local_folder_location_id IS NULL'
  ),
  ck(
    'ck_image_dimensions',
    '(width IS NULL OR width > 0) AND ' +
    '(height IS NULL OR height > 0)'
  ),
  ck(
    'ck_image_structure',
    '(orientation IS NULL OR orientation BETWEEN 1 AND 8) AND ' +
    '(frame_count IS NULL OR frame_count > 0) AND ' +
    '(page_count IS NULL OR page_count > 0) AND ' +
    '(primary_image_index IS NULL OR primary_image_index >= 0)'
  ),
  ck(
    'ck_thumbnail_origin',
    "thumbnail_origin IN ('none','app_generated','unverified_legacy')"
  ),
  ck(
    'ck_thumbnail_path',
    "(thumbnail_origin = 'none' AND thumbnail_path IS NULL) OR " +
    "(thumbnail_origin <> 'none' AND thumbnail_path IS NOT NULL)"
  )
])

// 태그·즐겨찾기

export const tags = sqliteTable('tag', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  updatedAt: integer('updated_at')
})

export const mediaTags = sqliteTable('media_tag', {
  mediaId: integer('media_id')
    .notNull()
    .references(() => medias.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' })
}, t => [
  primaryKey({ columns: [t.mediaId, t.tagId] })
])

export const favorites = sqliteTable('favorite', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaId: integer('media_id')
    .notNull()
    .references(() => medias.id, { onDelete: 'cascade' }),
  createdAt: createdAt()
}, t => [
  uniqueIndex('uq_favorite_media').on(t.mediaId)
])

// ロ컬 폴더와 위치

export const localFolders = sqliteTable('local_folder', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaId: integer('media_id')
    .notNull()
    .references(() => medias.id, { onDelete: 'cascade' }),
  sourceTitle: text('source_title').notNull(),
  revision: integer('revision').notNull().default(0)
}, t => [
  uniqueIndex('uq_local_folder_media').on(t.mediaId),
  uniqueIndex('uq_local_folder_owner').on(t.mediaId, t.id),
  ck('ck_local_folder_revision', 'revision >= 0')
])

export const localFolderLocations = sqliteTable('local_folder_location', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  localFolderId: integer('local_folder_id').notNull(),
  mediaId: integer('media_id').notNull(),
  directoryPath: text('directory_path').notNull(),
  directoryKey: text('directory_key').notNull(),
  keyVersion: integer('key_version').notNull(),
  state: text('state', {
    enum: ['active', 'reserved', 'history']
  }).notNull()
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('uq_location_owner').on(t.mediaId, t.id),

  uniqueIndex('uq_reserved_directory')
    .on(t.directoryKey)
    .where(sql.raw("state IN ('active','reserved')")),

  foreignKey({
    columns: [t.mediaId, t.localFolderId],
    foreignColumns: [localFolders.mediaId, localFolders.id]
  }).onDelete('cascade'),

  ck('ck_location_version', 'key_version > 0'),
  ck(
    'ck_location_state',
    "state IN ('active','reserved','history')"
  )
])

// 다운로드 작업

export const downloadQueue = sqliteTable('download_queue', {
  id: text('id').primaryKey(),
  requestUrlId: integer('request_url_id')
    .notNull()
    .references(() => downloadUrls.id),
  originalUrl: text('original_url').notNull(),
  mode: text('mode', { enum: ['create', 'replace'] }).notNull(),

  targetMediaId: integer('target_media_id')
    .references(() => medias.id, { onDelete: 'set null' }),
  targetMediaIdSnapshot: integer('target_media_id_snapshot'),

  state: text('state', { enum: jobStates })
    .notNull()
    .default('pending'),
  optionsJson: text('options_json').notNull(),
  progress: integer('progress').notNull().default(0),

  recoveryEnabled: integer('recovery_enabled', {
    mode: 'boolean'
  }).notNull().default(false),
  autoRunLimit: integer('auto_run_limit').notNull().default(1),
  autoRunCount: integer('auto_run_count').default(0),
  autoHistoryUnknown: integer('auto_history_unknown', {
    mode: 'boolean'
  }).notNull().default(false),

  currentAttemptId: text('current_attempt_id'),
  cleanupRequired: integer('cleanup_required', {
    mode: 'boolean'
  }).notNull().default(false),

  title: text('title'),
  thumbnail: text('thumbnail'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  log: text('log'),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  createdAt: integer('created_at').$defaultFn(Date.now),
  updatedAt: integer('updated_at').$defaultFn(Date.now)
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('uq_active_download_url')
    .on(t.requestUrlId)
    .where(sql.raw(
      "state IN ('pending','running') OR cleanup_required = 1"
    )),

  index('idx_download_state').on(t.state, t.createdAt),

  foreignKey({
    columns: [t.id, t.currentAttemptId],
    foreignColumns: [downloadAttempts.jobId, downloadAttempts.id]
  }),

  ck('ck_download_mode', "mode IN ('create','replace')"),
  ck(
    'ck_download_state',
    "state IN ('pending','running','completed'," +
    "'failed','cancelled','interrupted')"
  ),
  ck('ck_download_progress', 'progress BETWEEN 0 AND 100'),
  ck(
    'ck_download_flags',
    'recovery_enabled IN (0,1) AND ' +
    'auto_history_unknown IN (0,1) AND cleanup_required IN (0,1)'
  ),
  ck(
    'ck_download_auto',
    'auto_run_limit >= 0 AND (' +
    '(auto_history_unknown = 1 AND auto_run_count IS NULL ' +
    'AND recovery_enabled = 0) OR ' +
    '(auto_history_unknown = 0 AND auto_run_count IS NOT NULL ' +
    'AND auto_run_count >= 0))'
  ),
  ck('ck_download_options', 'json_valid(options_json)')
])

export const downloadAttempts = sqliteTable('download_attempt', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references((): AnySQLiteColumn => downloadQueue.id),
  attemptNo: integer('attempt_no').notNull(),

  targetMediaId: integer('target_media_id')
    .references(
      (): AnySQLiteColumn => medias.id,
      { onDelete: 'set null' }
    ),
  targetMediaIdSnapshot: integer('target_media_id_snapshot'),

  trigger: text('trigger', {
    enum: [
      'manual_initial',
      'manual_retry',
      'manual_restart',
      'auto_recovery'
    ]
  }).notNull(),

  phase: text('phase', { enum: phases }).notNull(),
  outcome: text('outcome', { enum: outcomes }),
  manifestPath: text('manifest_path'),
  cancelRequestedAt: integer('cancel_requested_at'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  committedAt: integer('committed_at')
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('uq_download_attempt_no').on(t.jobId, t.attemptNo),
  uniqueIndex('uq_download_attempt_owner').on(t.jobId, t.id),
  uniqueIndex('uq_download_attempt_target').on(t.targetMediaId, t.id),

  ck('ck_download_attempt_no', 'attempt_no > 0'),
  ck(
    'ck_download_trigger',
    "trigger IN ('manual_initial','manual_retry'," +
    "'manual_restart','auto_recovery')"
  ),
  ck(
    'ck_download_phase',
    "phase IN ('discovering','downloading','verifying'," +
    "'committing','rolling_back','finished')"
  ),
  ck(
    'ck_download_outcome',
    "outcome IS NULL OR outcome IN " +
    "('completed','failed','cancelled','interrupted')"
  ),
  ck(
    'ck_download_commit',
    'committed_at IS NULL OR ' +
    "(outcome IS NOT NULL AND outcome = 'completed')"
  )
])

export const downloadTargets = sqliteTable('download_target', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id')
    .notNull()
    .references(() => downloadAttempts.id),
  targetKey: text('target_key').notNull(),
  sourceUrl: text('source_url').notNull(),
  metadataJson: text('metadata_json').notNull(),
  position: integer('position').notNull(),
  state: text('state', {
    enum: ['pending', 'downloading', 'downloaded', 'verified', 'failed']
  }).notNull(),
  stagedPath: text('staged_path'),
  finalPath: text('final_path'),
  errorCode: text('error_code')
}, t => [
  uniqueIndex('uq_download_target_key').on(t.attemptId, t.targetKey),
  uniqueIndex('uq_download_target_position').on(t.attemptId, t.position),
  ck('ck_download_target_position', 'position >= 0'),
  ck(
    'ck_download_target_state',
    "state IN ('pending','downloading','downloaded','verified','failed')"
  ),
  ck('ck_download_target_json', 'json_valid(metadata_json)')
])

// 로컬 가져오기 작업

export const localImportJobs = sqliteTable('local_import_job', {
  id: text('id').primaryKey(),
  rootPath: text('root_path').notNull(),
  rootKey: text('root_key').notNull(),
  scanRevision: integer('scan_revision').notNull().default(0),

  state: text('state', {
    enum: ['scanning', 'ready', ...jobStates]
  }).notNull(),

  cancelRequestedAt: integer('cancel_requested_at'),
  cleanupRequired: integer('cleanup_required', {
    mode: 'boolean'
  }).notNull().default(false),
  countsJson: text('counts_json').notNull(),
  revision: integer('revision').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  index('idx_import_job_state').on(t.state, t.createdAt),
  ck(
    'ck_import_job_state',
    "state IN ('scanning','ready','pending','running'," +
    "'completed','failed','cancelled','interrupted')"
  ),
  ck(
    'ck_import_job_revisions',
    'revision >= 0 AND scan_revision >= 0'
  ),
  ck('ck_import_job_cleanup', 'cleanup_required IN (0,1)'),
  ck('ck_import_job_counts', 'json_valid(counts_json)')
])

export const localImportFolders = sqliteTable('local_import_folder', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => localImportJobs.id),
  directoryPath: text('directory_path').notNull(),
  directoryKey: text('directory_key').notNull(),
  relativePath: text('relative_path').notNull(),
  localFolderId: integer('local_folder_id')
    .references(() => localFolders.id, { onDelete: 'set null' }),

  state: text('state', {
    enum: [...jobStates, 'skipped']
  }).notNull(),

  currentAttemptId: text('current_attempt_id'),
  cleanupRequired: integer('cleanup_required', {
    mode: 'boolean'
  }).notNull().default(false),
  errorCode: text('error_code')
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('uq_import_job_directory').on(t.jobId, t.directoryKey),

  foreignKey({
    columns: [t.id, t.currentAttemptId],
    foreignColumns: [
      localImportAttempts.importFolderId,
      localImportAttempts.id
    ]
  }),

  ck(
    'ck_import_folder_state',
    "state IN ('pending','running','completed','failed'," +
    "'cancelled','interrupted','skipped')"
  ),
  ck('ck_import_folder_cleanup', 'cleanup_required IN (0,1)')
])

export const localImportAttempts = sqliteTable('local_import_attempt', {
  id: text('id').primaryKey(),
  importFolderId: text('import_folder_id')
    .notNull()
    .references((): AnySQLiteColumn => localImportFolders.id),
  attemptNo: integer('attempt_no').notNull(),

  phase: text('phase', {
    enum: ['inspecting', 'committing', 'rolling_back', 'finished']
  }).notNull(),

  expectedMediaRevision: integer('expected_media_revision'),
  commitToken: text('commit_token').notNull(),
  manifestPath: text('manifest_path'),
  outcome: text('outcome', { enum: outcomes }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  committedAt: integer('committed_at')
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('uq_import_attempt_no')
    .on(t.importFolderId, t.attemptNo),
  uniqueIndex('uq_import_attempt_owner')
    .on(t.importFolderId, t.id),
  uniqueIndex('uq_import_commit_token').on(t.commitToken),

  ck('ck_import_attempt_no', 'attempt_no > 0'),
  ck(
    'ck_import_expected_revision',
    'expected_media_revision IS NULL OR expected_media_revision >= 0'
  ),
  ck(
    'ck_import_phase',
    "phase IN ('inspecting','committing','rolling_back','finished')"
  ),
  ck(
    'ck_import_outcome',
    "outcome IS NULL OR outcome IN " +
    "('completed','failed','cancelled','interrupted')"
  ),
  ck(
    'ck_import_commit',
    'committed_at IS NULL OR ' +
    "(outcome IS NOT NULL AND outcome = 'completed')"
  )
])

export const localImportTargets = sqliteTable('local_import_target', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id')
    .notNull()
    .references(() => localImportAttempts.id),
  pathKey: text('path_key').notNull(),
  relativePath: text('relative_path').notNull(),
  expectedStatJson: text('expected_stat_json').notNull(),
  inspectionJson: text('inspection_json'),

  state: text('state', {
    enum: ['pending', 'inspected', 'unchanged', 'changed', 'failed']
  }).notNull(),

  errorCode: text('error_code')
}, t => [
  uniqueIndex('uq_import_target_path').on(t.attemptId, t.pathKey),
  ck(
    'ck_import_target_state',
    "state IN ('pending','inspected','unchanged','changed','failed')"
  ),
  ck(
    'ck_import_target_json',
    'json_valid(expected_stat_json) AND ' +
    '(inspection_json IS NULL OR json_valid(inspection_json))'
  )
])

// 유지보수

export const maintenanceTasks = sqliteTable('maintenance_task', {
  id: text('id').primaryKey(),

  kind: text('kind', {
    enum: [
      'rollback_cleanup',
      'obsolete_file_cleanup',
      'search_reindex',
      'deletion_cleanup',
      'preview_generation'
    ]
  }).notNull(),

  state: text('state', {
    enum: ['pending', 'running', 'completed', 'failed']
  }).notNull(),

  ownerKind: text('owner_kind', {
    enum: ['system', 'download', 'local']
  }).notNull(),

  downloadAttemptId: text('download_attempt_id')
    .references(() => downloadAttempts.id),
  localAttemptId: text('local_attempt_id')
    .references(() => localImportAttempts.id),

  payloadJson: text('payload_json').notNull(),
  tryCount: integer('try_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  index('idx_maintenance_state').on(t.state, t.kind),
  ck(
    'ck_maintenance_kind',
    "kind IN ('rollback_cleanup','obsolete_file_cleanup'," +
    "'search_reindex','deletion_cleanup','preview_generation')"
  ),
  ck(
    'ck_maintenance_state',
    "state IN ('pending','running','completed','failed')"
  ),
  ck(
    'ck_maintenance_owner',
    "(owner_kind = 'system' AND download_attempt_id IS NULL " +
    'AND local_attempt_id IS NULL) OR ' +
    "(owner_kind = 'download' AND download_attempt_id IS NOT NULL " +
    'AND local_attempt_id IS NULL) OR ' +
    "(owner_kind = 'local' AND local_attempt_id IS NOT NULL " +
    'AND download_attempt_id IS NULL)'
  ),
  ck('ck_maintenance_try_count', 'try_count >= 0'),
  ck('ck_maintenance_payload', 'json_valid(payload_json)')
])

// 이관 기록·기존 행 원문

export const migrationRuns = sqliteTable('migration_run', {
  id: text('id').primaryKey(),
  targetVersion: integer('target_version').notNull(),
  sourceFingerprint: text('source_fingerprint').notNull(),
  schemaHash: text('schema_hash').notNull(),
  backupPath: text('backup_path'),
  completedAt: integer('completed_at').notNull()
}, t => [
  uniqueIndex('uq_migration_version').on(t.targetVersion),
  ck('ck_migration_version', 'target_version > 0')
])

export const legacyRecords = sqliteTable('legacy_record', {
  tableName: text('table_name').notNull(),
  rowKey: text('row_key').notNull(),
  payloadJson: text('payload_json').notNull()
}, t => [
  primaryKey({ columns: [t.tableName, t.rowKey] }),
  ck('ck_legacy_json', 'json_valid(payload_json)')
])

export type Media = typeof medias.$inferSelect
export type MediaFile = typeof mediaFiles.$inferSelect
export type NewMediaFile = typeof mediaFiles.$inferInsert
export type DownloadJob = typeof downloadQueue.$inferSelect
export type LocalImportJob = typeof localImportJobs.$inferSelect