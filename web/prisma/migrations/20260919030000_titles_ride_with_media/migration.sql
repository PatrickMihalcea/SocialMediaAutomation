-- Titles no longer have ports of their own: every step emits the title of each
-- item it produces, and the engine carries them along the media connection.
--
-- The edges that used to wire them by hand now point at handles that no longer
-- exist. At run time they are harmless — they set the same key the ride-along
-- would — but the canvas cannot draw an edge to a missing handle, so they are
-- removed rather than left as connections that render nowhere.
--
-- Checked before writing this: every such edge came from the same step as its
-- media connection, so the ride-along delivers the identical value and no graph
-- changes what it produces.
DELETE FROM "workflow_edges"
WHERE "target_port" IN ('titles', 'titles1', 'titles2', 'titles3', 'titles4', 'labels')
   OR "source_port" IN ('titles', 'labels', 'imageTitles');
