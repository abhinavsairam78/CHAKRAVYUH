// Browser recognition cannot reliably separate a nearby speaker from the caller.
// Use a fresh recognizer after each playback window and reject late old events.
export function createRecognitionGate({ Recognition, lang, onResult, onState = () => {}, onError = () => {}, tailMs = 650, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let wanted = false, blocked = false, recognizer = null, timer = null;
  function clearPending() { if (timer !== null) clearTimer(timer); timer = null; }
  function abort() {
    const old = recognizer;
    recognizer = null;
    if (old) { try { old.abort(); } catch {} }
  }
  function launch() {
    clearPending();
    if (!wanted || blocked || recognizer) return;
    const mine = new Recognition();
    recognizer = mine;
    mine.lang = lang;
    mine.continuous = true;
    mine.interimResults = true;
    let consumed = 0;
    mine.onresult = (event) => {
      if (!wanted || blocked || recognizer !== mine) return;
      let final = '', interim = '';
      for (let i = Math.max(event.resultIndex, consumed); i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) { final += ' ' + result[0].transcript; consumed = i + 1; }
        else interim += result[0].transcript;
      }
      onResult({ final, interim, consumeInterim: () => { consumed = event.results.length; } });
    };
    mine.onend = () => {
      if (recognizer !== mine) return;
      recognizer = null;
      if (wanted && !blocked) timer = setTimer(launch, 150);
    };
    mine.onerror = (event) => {
      if (recognizer !== mine) return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        wanted = false; clearPending(); abort(); onState('off');
      }
      onError(event);
    };
    try { mine.start(); onState('on'); }
    catch (error) { wanted = false; abort(); onState('off'); onError({ error: 'start-failed', message: error.message }); }
  }
  return {
    start() { wanted = true; if (!blocked) launch(); },
    hold() { blocked = true; clearPending(); abort(); onState('speaking'); },
    release() {
      if (!blocked) return;
      clearPending();
      timer = setTimer(() => { timer = null; blocked = false; if (wanted) launch(); }, tailMs);
    },
    stop() { wanted = false; blocked = false; clearPending(); abort(); onState('off'); }
  };
}
