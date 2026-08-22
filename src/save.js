// Save/load: a single JSON blob in localStorage capturing enough of a run
// (wave, gold, upgrades, player/base stats, and in-progress enemies) to
// resume exactly where "Save & Quit" left off.

const SAVE_KEY = 'baseDefenseSave_v1';

function saveGame(snapshot) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (e) {
    return false;
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    // ignore
  }
}

// Meta-progression save: a small permanent record that survives across runs (unlike the
// single in-progress-run save above). Tracks Marks (a currency earned per wave survived,
// spent on unlocking alternate starting weapons) and wave checkpoints (unlocked for free by
// clearing a boss wave, letting a future run start further in without touching difficulty
// scaling — waveScale is already a pure function of wave number).
const META_SAVE_KEY = 'nightwardMeta_v1';

function loadMeta() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(META_SAVE_KEY));
  } catch (e) {
    raw = null;
  }
  return {
    v: 1,
    marks: raw && typeof raw.marks === 'number' ? raw.marks : 0,
    unlockedLoadouts: raw && Array.isArray(raw.unlockedLoadouts) ? raw.unlockedLoadouts : ['crossbow'],
    unlockedCheckpoints: raw && Array.isArray(raw.unlockedCheckpoints) ? raw.unlockedCheckpoints : [],
  };
}

function saveMeta(meta) {
  try {
    localStorage.setItem(META_SAVE_KEY, JSON.stringify(meta));
    return true;
  } catch (e) {
    return false;
  }
}
