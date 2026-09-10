# Deferred schema changes

Every item here was found by a story-testing agent that could implement everything
except the persistence it needed. None of them were applied, because a dozen agents
share one database and one workspace: a migration mid-flight would have reset or
altered the data they were actively testing against, and regenerating the Prisma
client would have broken their typechecks at random moments.

They are collected here to be applied as **one deliberate migration** once the agents
stop writing. Nothing below is speculative — each field has a named consumer that is
already built and waiting for it.

## 1. Workspace and user preferences (US-395–400)

Reported by the workspace/team/settings agent. The settings UI exists; none of it
survives a reload.

```prisma
enum ThemePreference { LIGHT DARK SYSTEM }
enum DefaultPostDestination { DRAFT QUEUE SCHEDULE }
enum AiCreativity { PRECISE BALANCED CREATIVE }

model WorkspacePreferences {
  workspaceId              String   @unique @db.Uuid
  defaultPostDestination   DefaultPostDestination @default(DRAFT)
  defaultPublishHour       Int      @default(9)
  defaultPublishMinute     Int      @default(0)
  requireApprovalByDefault Boolean  @default(false)
  defaultHashtags          String[] @default([])
  defaultCta               String   @default("")
  aiCreativity             AiCreativity @default(BALANCED)
  aiUseBrandVoice          Boolean  @default(true)
  aiAutoAdaptPlatforms     Boolean  @default(true)
}
```

Also `Workspace.preferences WorkspacePreferences?` with cascade deletion, and
`User.themePreference ThemePreference @default(SYSTEM)`.

Consumers, all already written: `/account` reads the theme and the root providers
apply it to `<html data-theme>`; workspace settings edits the rest; the composer and
post creation initialize from the posting defaults; new platform versions seed their
hashtags from `defaultHashtags`; the composer and AI generation fall back to
`defaultCta`; the AI service maps `aiCreativity` to temperature and uses the other two
flags to decide whether to include brand voice and whether to auto-adapt per platform.

## 2. Notification preferences and a missing event type

`User.notificationEmailEnabled` already exists. Add `notificationInAppEnabled`,
`notificationApprovalsEnabled`, `notificationPublishingFailuresEnabled` (all
`@default(true)`) and `notificationWeeklyDigestEnabled` (`@default(false)`), and have
the notification and email services filter delivery by event category.

`NotificationType` (schema.prisma:112-121) has no AI-completion event, so a finished
generation cannot notify anyone. This blocks US-362 outright, and the AI Studio agent
independently hit the same wall.

## 3. AI generation provenance (AI Studio agent)

Generated media currently carries its origin without a real relation. Add Prisma
relations and indexes for `MediaAsset.aiGenerationId` and `AiMediaJob.outputAssetId`
so provenance is queryable rather than a loose identifier.

## 4. Saved search views (US-378)

Reported by the analytics/search agent. Search supports full filtering and sorting,
but there is no model to persist a named view, so a user rebuilds the same query
every time.

## 5. Post lifecycle gaps (drafts and post-state agent)

- **No `ARCHIVED` status and no archive field**, so US-290 cannot be built. Posts can
  only be hard-deleted.
- **No undo token or deletion history**, so US-496, US-497 and US-500 are blocked:
  deletion is permanent and rescheduling cannot be undone.
The workspace agent confirmed the remaining two do genuinely need schema, and
specified them:

**Rejection has no distinct state.** A rejected post is set back to `DRAFT`, so its
author cannot tell rejection from a post they simply never submitted. Add `REJECTED`
to `PostStatus`, have rejection set it instead of `DRAFT`, and update every exhaustive
status map, filter, lifecycle action and badge — the post-state action matrix must
gain a row for it.

**Approval comments cannot be threaded**, so a conversation about a post has nowhere
to live:

```prisma
model ApprovalComment {
  parentId String? @db.Uuid
  parent   ApprovalComment?  @relation("ApprovalReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies  ApprovalComment[] @relation("ApprovalReplies")

  @@index([parentId])
}
```

Replies use `decision = COMMENT`, and parent and reply must be validated to share the
same post and workspace.

## 6. Skipped queue slots (US-239)

Reported by the queue and recurrence agent. `QueueItem` can only represent a slot that
holds a post, so a slot the user deliberately skipped cannot be recorded and reappears
as available. Needs a record that reserves an empty slot as intentionally skipped.

## 7. Invoice and payment method history (US-385, US-386)

Reported by the billing agent. Nothing persists provider invoice identifiers, status,
amounts or hosted URLs, and nothing stores a payment method's brand, last four digits
or expiry. Until those exist the billing page can only disclose honestly that this
environment has no payment provider; a real deployment would send users to the
provider's own portal.

## Sequencing

Apply as one migration, then regenerate the client, then let the waiting consumers be
wired up — most are a few lines each, because the UI was built against the intended
shape and only the persistence is missing.
