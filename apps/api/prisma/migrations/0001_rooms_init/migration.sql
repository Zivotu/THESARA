-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomCode" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Member_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" TEXT NOT NULL,
    "note" TEXT,
    "estPriceCents" INTEGER,
    "bought" BOOLEAN NOT NULL DEFAULT false,
    "actualPriceCents" INTEGER,
    "addedBy" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCents" INTEGER NOT NULL,
    "by" TEXT NOT NULL,
    "itemsJson" TEXT NOT NULL,
    CONSTRAINT "Purchase_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "response" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_roomCode_key" ON "Room"("roomCode");

-- CreateIndex
CREATE INDEX "Room_roomCode_idx" ON "Room"("roomCode");

-- CreateIndex
CREATE INDEX "Member_roomId_idx" ON "Member"("roomId");

-- CreateIndex
CREATE INDEX "Item_roomId_idx" ON "Item"("roomId");

-- CreateIndex
CREATE INDEX "Purchase_roomId_idx" ON "Purchase"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_scope_key" ON "IdempotencyKey"("key", "scope");
