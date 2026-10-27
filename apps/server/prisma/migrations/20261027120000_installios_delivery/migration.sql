-- CreateTable
CREATE TABLE "CodeWaitAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "waitId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeWaitAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentOrderId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "appId" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "appIconUrl" TEXT NOT NULL,
    "amountKopecks" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paymentId" TEXT,
    "paymentUrl" TEXT,
    "paymentSyncedAt" DATETIME,
    "deliveryRef" TEXT,
    "deliveryExpiresAt" DATETIME,
    "paidAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("amountKopecks", "appIconUrl", "appId", "appName", "completedAt", "createdAt", "id", "paidAt", "paymentId", "paymentMethod", "paymentOrderId", "paymentSyncedAt", "paymentUrl", "status", "updatedAt", "userId") SELECT "amountKopecks", "appIconUrl", "appId", "appName", "completedAt", "createdAt", "id", "paidAt", "paymentId", "paymentMethod", "paymentOrderId", "paymentSyncedAt", "paymentUrl", "status", "updatedAt", "userId" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_paymentOrderId_key" ON "Order"("paymentOrderId");
CREATE UNIQUE INDEX "Order_paymentId_key" ON "Order"("paymentId");
CREATE UNIQUE INDEX "Order_deliveryRef_key" ON "Order"("deliveryRef");
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CodeWaitAttempt_idempotencyKey_key" ON "CodeWaitAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CodeWaitAttempt_waitId_key" ON "CodeWaitAttempt"("waitId");

-- CreateIndex
CREATE INDEX "CodeWaitAttempt_orderId_groupId_idx" ON "CodeWaitAttempt"("orderId", "groupId");

