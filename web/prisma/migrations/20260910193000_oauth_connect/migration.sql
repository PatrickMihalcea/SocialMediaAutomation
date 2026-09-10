CREATE TABLE "oauth_attempts" (
    "id" UUID NOT NULL,
    "state_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_verifier_encrypted" TEXT,
    "reconnect_account_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_selections" (
    "id" UUID NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "results_encrypted" TEXT NOT NULL,
    "reconnect_account_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_selections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_attempts_state_hash_key" ON "oauth_attempts"("state_hash");
CREATE INDEX "oauth_attempts_user_id_expires_at_idx" ON "oauth_attempts"("user_id", "expires_at");
CREATE INDEX "oauth_attempts_workspace_id_platform_idx" ON "oauth_attempts"("workspace_id", "platform");
CREATE INDEX "oauth_attempts_expires_at_idx" ON "oauth_attempts"("expires_at");
CREATE UNIQUE INDEX "oauth_selections_secret_hash_key" ON "oauth_selections"("secret_hash");
CREATE INDEX "oauth_selections_user_id_expires_at_idx" ON "oauth_selections"("user_id", "expires_at");
CREATE INDEX "oauth_selections_workspace_id_platform_idx" ON "oauth_selections"("workspace_id", "platform");
CREATE INDEX "oauth_selections_expires_at_idx" ON "oauth_selections"("expires_at");

ALTER TABLE "oauth_attempts" ADD CONSTRAINT "oauth_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_attempts" ADD CONSTRAINT "oauth_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_selections" ADD CONSTRAINT "oauth_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_selections" ADD CONSTRAINT "oauth_selections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
