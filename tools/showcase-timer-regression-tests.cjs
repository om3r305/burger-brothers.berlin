const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(process.argv[2] || process.cwd());
const playerPath = path.join(projectRoot, 'components', 'showcase', 'ShowcasePlayer.tsx');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

assert(fs.existsSync(playerPath), 'ShowcasePlayer.tsx exists');
if (!fs.existsSync(playerPath)) process.exit(1);

const source = fs.readFileSync(playerPath, 'utf8');

assert(
  !source.includes('[activeIndex, activeScenes, next, snapshot]'),
  'legacy timer dependency list that reset on every API poll is removed',
);
assert(
  source.includes('[advanceScene, playbackKey, sceneDurationSeconds]'),
  'main scene timer depends only on stable playback identity and duration',
);
assert(
  source.includes('[snapshot?.document, snapshot?.branding?.siteUrl]'),
  'active scene list stays stable while only runtime data is refreshed',
);
assert(
  source.includes('expectedPlaybackKey !== currentPlaybackKey'),
  'stale callbacks from previous scenes are ignored',
);
assert(
  source.includes('advancedPlaybackKeyRef.current === currentPlaybackKey'),
  'video end and timeout cannot advance twice',
);
assert(
  source.includes('key={playbackKey}'),
  'scene-local product/menu timers remount cleanly on main scene changes',
);

// Deterministic model of the production bug: polling every 3 seconds used to
// recreate the timeout before a 25-second QR scene could finish.
function simulateLegacy({ durationMs, pollMs, totalMs }) {
  let deadline = durationMs;
  let advances = 0;
  for (let now = pollMs; now <= totalMs; now += pollMs) {
    if (now >= deadline) {
      advances += 1;
      deadline = now + durationMs;
    }
    // Old React effect was cleaned up and recreated by every fresh snapshot.
    deadline = now + durationMs;
  }
  return advances;
}

function simulateFixed({ durationMs, pollMs, totalMs }) {
  let deadline = durationMs;
  let advances = 0;
  for (let now = pollMs; now <= totalMs; now += pollMs) {
    // Same playback key: polling does not touch the deadline.
    if (now >= deadline) {
      advances += 1;
      deadline += durationMs;
    }
  }
  return advances;
}

assert(
  simulateLegacy({ durationMs: 25_000, pollMs: 3_000, totalMs: 120_000 }) === 0,
  'regression model reproduces the old QR/menu freeze',
);
assert(
  simulateFixed({ durationMs: 25_000, pollMs: 3_000, totalMs: 120_000 }) >= 4,
  'fixed timer advances despite 3-second live-sync polling',
);

if (process.exitCode) process.exit(process.exitCode);
console.log('Showcase timer regression tests completed successfully.');
