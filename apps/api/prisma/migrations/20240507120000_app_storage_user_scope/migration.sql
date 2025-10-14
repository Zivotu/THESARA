-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_app_storage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "app_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT '__legacy__',
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

INSERT INTO "new_app_storage" ("id", "app_id", "room_id", "key", "value", "created_at", "updated_at")
SELECT "id", "app_id", "room_id", "key", "value", "created_at", "updated_at" FROM "app_storage";

DROP TABLE "app_storage";
ALTER TABLE "new_app_storage" RENAME TO "app_storage";

CREATE UNIQUE INDEX "app_storage_app_room_user_key" ON "app_storage"("app_id", "room_id", "user_id", "key");
CREATE INDEX "app_storage_lookup_idx" ON "app_storage"("app_id", "room_id", "user_id", "key");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
