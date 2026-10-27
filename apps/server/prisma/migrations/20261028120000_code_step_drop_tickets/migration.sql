-- Support moved to Telegram only: support tickets are no longer stored.
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Ticket";
PRAGMA foreign_keys=on;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "codeReceivedAt" DATETIME;
