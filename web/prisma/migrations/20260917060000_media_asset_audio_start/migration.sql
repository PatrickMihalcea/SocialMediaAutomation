-- Default start point for an audio asset, in seconds.
-- Nullable: a track with no chosen start plays from the beginning, which is
-- distinct from a track deliberately set to start at 0.
ALTER TABLE "media_assets" ADD COLUMN "audio_start" DOUBLE PRECISION;
