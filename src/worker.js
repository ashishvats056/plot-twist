// Service worker: keeps each Meet tab's empty background photo so it survives
// reloads. It lives in chrome.storage.session (memory only, never on disk,
// gone when Chrome quits) and is deleted on ✕ or when the tab closes.
importScripts('actions.js');

const A = globalThis.PlotTwistActions;
const key = (tabId) => `bgPhoto:${tabId}`;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only our own bridge, in the top frame of a Meet tab.
  const tabId = sender.tab && sender.tab.id;
  if (sender.id !== chrome.runtime.id || typeof tabId !== 'number' || sender.frameId !== 0
    || !String(sender.url).startsWith('https://meet.google.com/') || !msg || typeof msg !== 'object') return false;
  if (msg.type === 'savePhoto') {
    const photo = A.sanitizeBgPhoto(msg.photo);
    if (photo) chrome.storage.session.set({ [key(tabId)]: photo }).catch(() => {});
  } else if (msg.type === 'dropPhoto') {
    chrome.storage.session.remove(key(tabId)).catch(() => {});
  } else if (msg.type === 'loadPhoto') {
    chrome.storage.session.get(key(tabId))
      .then((got) => reply({ photo: A.sanitizeBgPhoto(got[key(tabId)]) }), () => reply({ photo: null }));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(key(tabId)).catch(() => {});
});
