const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const root = process.cwd();
const file = (relativePath) => path.join(root, relativePath);
const read = (relativePath) => fs.readFileSync(file(relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(file(relativePath));

const requiredFiles = [
  'lib/rewards/config.ts',
  'lib/server/schnell-rewards.ts',
  'lib/server/admin-inbox.ts',
  'lib/server/reward-photo-storage.ts',
  'lib/server/reward-cleanup.ts',
  'lib/server/showcase-live-events.ts',
  'components/rewards/RewardCelebration.tsx',
  'components/rewards/RewardCamera.tsx',
  'components/rewards/admin/RewardProgramPanel.tsx',
  'components/rewards/admin/RewardModerationPanel.tsx',
  'components/showcase/WinnerCelebrationOverlay.tsx',
  'components/admin/AdminAttentionBell.tsx',
  'app/api/admin/rewards/route.ts',
  'app/api/admin/attention/route.ts',
  'app/api/admin/cron/reward-cleanup/route.ts',
  'app/api/schnellbestellung/reward/submission/route.ts',
  'app/api/showcase/events/route.ts',
  'app/api/rewards/photos/[id]/route.ts',
  'prisma/migrations/20260728190000_add_schnell_reward_showcase_events/migration.sql',
];

for (const relativePath of requiredFiles) {
  assert(exists(relativePath), `Eksik dosya: ${relativePath}`);
}

const rewardConfig = read('lib/rewards/config.ts');
const rewardEngine = read('lib/server/schnell-rewards.ts');
const schnellServer = read('lib/server/schnellbestellung.ts');
const orderRoute = read('app/api/schnellbestellung/orders/route.ts');
const statusRoute = read('app/api/schnellbestellung/status/route.ts');
const schnellClient = read('components/schnellbestellung/SchnellClient.tsx');
const successPage = read('app/schnellbestellung/success/page.tsx');
const celebration = read('components/rewards/RewardCelebration.tsx');
const camera = read('components/rewards/RewardCamera.tsx');
const submissionRoute = read('app/api/schnellbestellung/reward/submission/route.ts');
const photoStorage = read('lib/server/reward-photo-storage.ts');
const photoRoute = read('app/api/rewards/photos/[id]/route.ts');
const cleanup = read('lib/server/reward-cleanup.ts');
const adminRewards = read('app/api/admin/rewards/route.ts');
const adminAttention = read('app/api/admin/attention/route.ts');
const attentionBell = read('components/admin/AdminAttentionBell.tsx');
const reviewRoute = read('app/api/admin/showcase/reviews/route.ts');
const reviewPanel = read('components/showcase/admin/ReviewModerationPanel.tsx');
const showcasePlayer = read('components/showcase/ShowcasePlayer.tsx');
const showcaseEvents = read('app/api/showcase/events/route.ts');
const showcaseEventServer = read('lib/server/showcase-live-events.ts');
const tvDomain = read('lib/tv/domain.ts');
const tvCard = read('components/tv/OrderCard.tsx');
const printProxy = read('print-proxy/index.cjs');
const prismaSchema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260728190000_add_schnell_reward_showcase_events/migration.sql');

// Safe rollout: no campaign starts itself after deployment.
assert(rewardConfig.includes('enabled: false'), 'Şanslı Sipariş varsayılanı kapalı olmalı');
assert(rewardConfig.includes('timezone: "Europe/Berlin"'));
assert(rewardConfig.includes('maxWinsPerDevicePerDay: 1'));
assert(rewardConfig.includes('photoRetentionMinutes: 60'));
assert(rewardConfig.includes('photoMode: "name_photo"'));
assert(rewardConfig.includes('targetScreenSlugs: ["brand"]'));

// Adaptive spontaneous winner schedule: no reward is lost when no order arrives
// at a preselected clock time.
assert(!rewardEngine.includes('generateRewardSlots'));
assert(rewardEngine.includes('computeAdaptiveWinChance'));
assert(rewardEngine.includes('createHmac("sha256", rewardSecret())'));
assert(rewardEngine.includes('minOrdersBetweenWins'));
assert(rewardEngine.includes('if (progress >= 0.96)'));
assert(rewardEngine.includes('slotIndex: nextWinSequence'));
assert(rewardEngine.includes('deviceWins >= program.maxWinsPerDevicePerDay'));
assert(rewardEngine.includes('weightedChoice<RewardCandidate>'));

// Basket-aware rewards: only an already present eligible item can become free.
assert(rewardEngine.includes('categoryItems(items, category)'));
assert(rewardEngine.includes('if (!item) return null'));
assert(rewardEngine.includes('if (burgerUnits.length < 2) return null'));
assert(rewardEngine.includes('definition.type === "percent_order"'));
assert(!rewardEngine.includes('canonicalItems.push({ name: "Hummus"'), 'Sepete rastgele ürün eklenmemeli');

// Reward is decided and persisted inside the existing Serializable order transaction.
assert(schnellServer.includes('Prisma.TransactionIsolationLevel.Serializable'));
assert(/const rewardDecision = [\s\S]*await decideSchnellReward/.test(schnellServer));
assert(schnellServer.includes('item.category === "lunch"'));
assert(schnellServer.includes('discount + rewardDecision.discountAmount'));
assert(schnellServer.includes('payable - rewardDecision.discountAmount'));
assert(schnellServer.includes('transaction.schnellRewardWin.create'));
assert(schnellServer.includes('reward: rewardDecision'));
assert(schnellServer.includes('rewardFromOrderMeta(meta)'));
assert(orderRoute.includes('reward: result.reward || null'));
assert(statusRoute.includes('reward: rewardFromOrderMeta(meta)'));

// The customer sees the number first, then the short same-page celebration.
assert(schnellClient.includes('prewarmRewardCelebration()'));
assert(schnellClient.includes('bb_schnell_reward:'));
assert(successPage.includes('RewardCelebration'));
assert(successPage.includes('window.setTimeout(() => setRewardVisible(true), 700)'));
assert(successPage.includes('/api/schnellbestellung/status'));
assert(celebration.includes('DU HAST'));
assert(celebration.includes('GEWONNEN!'));
assert(celebration.includes('Weiter'));
assert(celebration.includes('Dein Gewinn bleibt auch ohne Namen oder Foto vollständig gültig'));
assert(celebration.includes('Math.max(5, Math.min(12, reward.celebrationSeconds || 7))'));

// Front-camera-first capture, local preview, retake, automatic local selection,
// and no upload before consent/submission.
assert(camera.includes('facingMode: { ideal: "user" }'));
assert(camera.includes('capture="user"'));
assert(camera.includes('Nochmal aufnehmen'));
assert(camera.includes('setConfirmed(Boolean(file))'));
assert(camera.includes('onChange(file, nextUrl)'));
assert(camera.includes('canvas.toBlob(resolve, "image/webp", 0.82)'));
assert(camera.indexOf('uploadTemporaryWinnerPhoto') === -1, 'Kamera bileseni dogrudan yukleme yapmamali');
assert(submissionRoute.includes('const consent = String(form.get("consent") || "") === "true"'));
assert(submissionRoute.includes('if (!consent)'));
assert(submissionRoute.includes('photo.size > 2 * 1024 * 1024'));
assert(submissionRoute.includes('uploadTemporaryWinnerPhoto'));
assert(submissionRoute.includes('orphan cleanup failed'));

// Temporary private storage and hard deletion.
assert(photoStorage.includes('winner-temp-photos'));
assert(photoStorage.includes('public: false'));
assert(photoStorage.includes('SUPABASE_SERVICE_ROLE_KEY'));
assert(photoRoute.includes('verifyWinnerPhotoAccessToken'));
assert(photoRoute.includes('Cache-Control": "private, no-store'));
assert(cleanup.includes('deleteTemporaryWinnerPhoto'));
assert(cleanup.includes('photoStoragePath: null'));
assert(cleanup.includes('photoStatus: "deleted"'));
assert(adminRewards.includes('action === "reject"'));
assert(adminRewards.includes('action === "approve_photo"'));
assert(adminRewards.includes('action === "approve_name"'));

// Admin inbox for winner photos/names and Google reviews.
assert(submissionRoute.includes('createAdminInboxNotification'));
assert(submissionRoute.includes('winner_photo_approval'));
assert(adminAttention.includes('status: "unread"'));
assert(attentionBell.includes('/api/admin/attention'));
assert(attentionBell.includes('"serviceWorker" in navigator'));
assert(attentionBell.includes('BB_ADMIN_PUSH'));
assert(reviewRoute.includes('google_review_approval'));
assert(reviewRoute.includes('Yeni Google yorumu onay bekliyor'));
assert(reviewRoute.includes('resolveAdminInboxNotification'));
assert(reviewPanel.includes('id="google-review-moderation"'));
assert(reviewPanel.includes('Bekleyen: {pendingCount}'));

// Showcase event is a temporary overlay and scene timer resumes with remaining time.
assert(showcasePlayer.includes('/api/showcase/events'));
assert(showcasePlayer.includes('WinnerCelebrationOverlay'));
assert(showcasePlayer.includes('sceneTimerRemainingMsRef'));
assert(showcasePlayer.includes('if (liveEvent) return'));
assert(showcasePlayer.includes('delay - elapsed'));
assert(showcaseEvents.includes('verifyShowcaseEventAckToken'));
assert(showcaseEvents.includes('status: "played"'));
assert(showcaseEventServer.includes('SHOWCASE_EVENT_SECRET_NOT_CONFIGURED'));
assert(showcaseEventServer.includes('const lifetimeMs = Math.max('));
assert(showcaseEventServer.includes('(params.program.showcaseDurationSeconds + 120) * 1_000'));
assert(showcaseEventServer.includes('const expiresAt = new Date(scheduledAt.getTime() + lifetimeMs)'));

// TV/receipt show the reward once and keep old order flow intact.
assert(tvCard.includes('🎁 {reward.customerLabel || reward.label}'));
assert(tvDomain.includes('Glücksgewinn –'));
assert(tvDomain.includes('let remaining = +Math.max(0, num(totals.discountSum)).toFixed(2)'));
assert(tvDomain.includes('rewardAmount'));
assert(tvDomain.includes('consume('));
assert(printProxy.includes('Glücksgewinn - ${rewardLabel}'));
assert(printProxy.includes('regularDiscount - rewardDiscount'));

// Additive DB migration with uniqueness against duplicate order/slot wins.
for (const model of [
  'model SchnellRewardWin',
  'model SchnellWinnerSubmission',
  'model ShowcaseLiveEvent',
  'model AdminInboxNotification',
]) {
  assert(prismaSchema.includes(model), `Prisma modeli eksik: ${model}`);
}
assert(migration.includes('CREATE UNIQUE INDEX "SchnellRewardWin_orderId_key"'));
assert(migration.includes('CREATE UNIQUE INDEX "SchnellRewardWin_tenantId_businessDate_slotIndex_key"'));
assert(migration.includes('winner-temp') === false, 'Storage secret/path migration içine yazılmamalı');

// Basic syntax validation for modified runtime JavaScript.
const nodeCheck = spawnSync(process.execPath, ['--check', file('print-proxy/index.cjs')], {
  encoding: 'utf8',
});
assert.strictEqual(nodeCheck.status, 0, nodeCheck.stderr || 'print-proxy syntax failed');

// Never package real environment files or obvious live secrets in the implementation files.
const implementationFiles = [
  ...requiredFiles,
  'lib/server/schnellbestellung.ts',
  'components/showcase/ShowcasePlayer.tsx',
  'components/schnellbestellung/SchnellClient.tsx',
  'app/schnellbestellung/success/page.tsx',
  'lib/tv/domain.ts',
  'print-proxy/index.cjs',
  'prisma/schema.prisma',
];
const secretPatterns = [
  /sk_live_[A-Za-z0-9]{16,}/,
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /whsec_[A-Za-z0-9]{16,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];
for (const relativePath of implementationFiles) {
  const source = read(relativePath);
  for (const pattern of secretPatterns) {
    assert(!pattern.test(source), `Muhtemel secret bulundu: ${relativePath}`);
  }
}

console.log('reward/showcase regression tests: OK');
