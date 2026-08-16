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
