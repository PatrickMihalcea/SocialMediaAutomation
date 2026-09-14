/*
  Warnings:

  - You are about to drop the column `audio_analyzed_at` on the `media_assets` table. All the data in the column will be lost.
  - The `beat_grid` column on the `media_assets` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "media_assets" DROP COLUMN "audio_analyzed_at",
ADD COLUMN     "analysed_at" TIMESTAMP(3),
ADD COLUMN     "beat_analyzer" TEXT,
ADD COLUMN     "beat_grid_version" INTEGER,
ADD COLUMN     "beat_strength" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
ADD COLUMN     "beats_per_bar" INTEGER,
ADD COLUMN     "downbeats" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
DROP COLUMN "beat_grid",
ADD COLUMN     "beat_grid" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[];

-- CreateIndex
CREATE INDEX "media_assets_type_analysed_at_idx" ON "media_assets"("type", "analysed_at");
