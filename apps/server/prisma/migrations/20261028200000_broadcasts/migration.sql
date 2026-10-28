-- AlterTable
ALTER TABLE "User" ADD COLUMN     "botBlockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" SERIAL NOT NULL,
    "authorId" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceChatId" BIGINT,
    "sourceMessageId" INTEGER,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "progressMessageId" INTEGER,
    "cursorUserId" BIGINT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_authorId_status_idx" ON "Broadcast"("authorId", "status");

-- CreateIndex
CREATE INDEX "Broadcast_status_idx" ON "Broadcast"("status");
