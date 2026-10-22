import {recordHistory,clearHistory,historyChanged} from './history';
import {startDirectDownload,cancelDirectDownload,handleOffscreen,directDownloadChanged} from './direct';
import type { Lecture } from './types';
const CANVAS = 'https://canvas.ssu.ac.kr';
async function openStudio() {
  const url = chrome.runtime.getURL('studio.html');
  const existing = await chrome.tabs.query({ url });
  if (existing[0]?.id) { await chrome.tabs.update(existing[0].id, { active: true }); await chrome.windows.update(existing[0].windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
}
chrome.action.onClicked.addListener(async tab => {
  if (tab.id && tab.url?.startsWith(CANVAS + '/')) await chrome.storage.local.set({ sourceTabId: tab.id });
  await openStudio();
});
let saveChain = Promise.resolve();
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if(msg?.type==='LX_DOWNLOAD'){startDirectDownload(msg.lecture,sender).then(jobId=>respond({ok:true,jobId})).catch(error=>respond({ok:false,error:error.message}));return true;}
  if(msg?.type==='LX_CANCEL_DOWNLOAD'){cancelDirectDownload(msg.jobId,sender).then(()=>respond({ok:true}));return true;}
  if (msg?.type === 'LX_DETECTED') {
    if (!sender.tab?.id || !sender.url?.startsWith(CANVAS + '/') || !Array.isArray(msg.lectures)) return;
    const tabId = sender.tab.id;
    saveChain = saveChain.catch(() => {}).then(async () => {
      const key = `lectures:${tabId}`;
      const state = await chrome.storage.local.get(key);
      const old: Lecture[] = Array.isArray(state[key]) ? state[key] as Lecture[] : [];
      const incoming: Lecture[] = msg.lectures.slice(0, 500).filter((l: Lecture) => l && typeof l.id === 'string' && typeof l.title === 'string').map((l: Lecture) => ({ ...l, tabId, frameId: sender.frameId, documentId: sender.documentId }));
      const merged = new Map(old.map(l => [l.id, l]));
      for (const l of incoming) merged.set(l.id, { ...merged.get(l.id), ...l });
      await chrome.storage.local.set({ [key]: [...merged.values()].slice(-500), sourceTabId: tabId });
    });
    return;
  }
  if (msg?.type === 'LX_OPEN') {
    if (!sender.tab || !sender.url?.startsWith(CANVAS + '/')) return;
    void chrome.storage.local.set({ sourceTabId: sender.tab.id, selectedLectureId: msg.id }).then(openStudio);
    return;
  }
  // Privileged operations are accepted only from this extension's own UI, never a web content script.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if(msg?.type?.startsWith('LX_OFFSCREEN_')&&!msg.target){handleOffscreen(msg,sender).then(()=>respond({ok:true})).catch(error=>respond({ok:false,error:error.message}));return true;}
  if(msg?.type==='LX_RECORD_DOWNLOAD'||msg?.type==='LX_CLEAR_HISTORY'){
    const task=msg.type==='LX_CLEAR_HISTORY'?clearHistory():recordHistory(msg.downloadId,msg.title);
    task.then(history=>respond({ok:true,history})).catch(error=>respond({ok:false,error:error.message}));return true;
  }
});
chrome.downloads.onChanged.addListener(delta=>{historyChanged(delta);void directDownloadChanged(delta);});
chrome.tabs.onRemoved.addListener(tabId => { void chrome.storage.local.remove(`lectures:${tabId}`); });
