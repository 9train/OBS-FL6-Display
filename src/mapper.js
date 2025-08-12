// Local "learned" names placeholder. Replace with your real mapper if you have it.
export function loadMappings(){
  try {
    const raw = localStorage.getItem('learnedMappings');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
