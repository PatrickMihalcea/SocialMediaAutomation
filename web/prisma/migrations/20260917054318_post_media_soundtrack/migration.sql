-- AlterTable
ALTER TABLE "post_media" ADD COLUMN     "audio_asset_id" UUID,
ADD COLUMN     "audio_start" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
