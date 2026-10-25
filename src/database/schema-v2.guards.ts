// Drizzle 스냅샷에 포함되지 않는 트리거다.
// 실제 이관에서 테이블·데이터 반영 뒤 함께 설치한다.
export const schemaV2Guards = [
  ...(['INSERT', 'UPDATE'] as const).flatMap(event => [
    `
      CREATE TRIGGER v2_local_folder_${event.toLowerCase()}
      BEFORE ${event} ON local_folder
      WHEN NOT EXISTS (
        SELECT 1 FROM media
        WHERE id = NEW.media_id AND source_kind = 'local'
      )
      BEGIN
        SELECT RAISE(ABORT, 'LOCAL_FOLDER_SOURCE_MISMATCH');
      END;
    `,
    `
      CREATE TRIGGER v2_file_source_${event.toLowerCase()}
      BEFORE ${event} ON media_file
      WHEN NOT EXISTS (
        SELECT 1 FROM media
        WHERE id = NEW.media_id AND (
          (
            source_kind = 'local'
            AND NEW.storage_kind = 'external_reference'
          )
          OR (
            source_kind IN ('download','legacy')
            AND NEW.storage_kind IN (
              'app_managed','unverified_legacy'
            )
          )
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'FILE_SOURCE_MISMATCH');
      END;
    `,
    `
      CREATE TRIGGER v2_file_location_${event.toLowerCase()}
      BEFORE ${event} ON media_file
      WHEN NEW.storage_kind = 'external_reference'
        AND NOT EXISTS (
          SELECT 1 FROM local_folder_location
          WHERE id = NEW.local_folder_location_id
            AND media_id = NEW.media_id
            AND state IN ('active','reserved')
        )
      BEGIN
        SELECT RAISE(ABORT, 'INVALID_LOCAL_LOCATION');
      END;
    `
  ]),
  `
    CREATE TRIGGER v2_media_source_update
    BEFORE UPDATE OF source_kind ON media
    WHEN (
      NEW.source_kind <> 'local'
      AND EXISTS (
        SELECT 1 FROM local_folder WHERE media_id = OLD.id
      )
    ) OR EXISTS (
      SELECT 1 FROM media_file
      WHERE media_id = OLD.id AND (
        (
          NEW.source_kind = 'local'
          AND storage_kind <> 'external_reference'
        )
        OR (
          NEW.source_kind <> 'local'
          AND storage_kind = 'external_reference'
        )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'MEDIA_SOURCE_MISMATCH');
    END;
  `,
  `
    CREATE TRIGGER v2_location_update
    BEFORE UPDATE ON local_folder_location
    WHEN EXISTS (
      SELECT 1 FROM media_file
      WHERE local_folder_location_id = OLD.id
    ) AND (
      NEW.state = 'history'
      OR NEW.media_id <> OLD.media_id
      OR NEW.local_folder_id <> OLD.local_folder_id
      OR NEW.directory_path <> OLD.directory_path
      OR NEW.directory_key <> OLD.directory_key
      OR NEW.key_version <> OLD.key_version
    )
    BEGIN
      SELECT RAISE(ABORT, 'LOCATION_IN_USE');
    END;
  `,
  `
    CREATE TRIGGER v2_media_delete
    BEFORE DELETE ON media
    WHEN EXISTS (
      SELECT 1 FROM download_queue
      WHERE target_media_id = OLD.id
        AND (
          state IN ('pending','running')
          OR cleanup_required = 1
        )
    ) OR EXISTS (
      SELECT 1 FROM local_import_folder f
      JOIN local_folder l ON l.id = f.local_folder_id
      WHERE l.media_id = OLD.id
        AND (
          f.state IN ('pending','running')
          OR f.cleanup_required = 1
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'JOB_ACTIVE');
    END;
  `
]