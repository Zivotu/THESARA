-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS "RoomBridge";

CREATE TABLE "RoomBridge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "RoomBridge_appId_userId_storageKey_key" ON "RoomBridge"("appId", "userId", "storageKey");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
