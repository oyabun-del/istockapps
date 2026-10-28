-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "appId" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "appIconUrl" TEXT NOT NULL,
    "priceKopecks" INTEGER NOT NULL,
    "discountKopecks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_appId_key" ON "OrderItem"("orderId", "appId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing order held exactly one app at full price: move it into an item.
INSERT INTO "OrderItem" ("orderId", "appId", "appName", "appIconUrl", "priceKopecks", "discountKopecks")
SELECT "id", "appId", "appName", "appIconUrl", "amountKopecks", 0 FROM "Order";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "subtotalKopecks" INTEGER,
ADD COLUMN "discountKopecks" INTEGER NOT NULL DEFAULT 0;

UPDATE "Order" SET "subtotalKopecks" = "amountKopecks";

ALTER TABLE "Order" ALTER COLUMN "subtotalKopecks" SET NOT NULL,
DROP COLUMN "appId",
DROP COLUMN "appName",
DROP COLUMN "appIconUrl";
