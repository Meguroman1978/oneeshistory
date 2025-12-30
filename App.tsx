
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GenerationStatus, ScriptData, LogEntry, Scene, GeneratorSettings, SuggestionResult, VeoMode, StudioProfile, ArtStyle, BgmType, AspectRatio, VideoHistoryItem } from './types';
import { generateScript, generateSceneImage, generateSceneAudio, getHistoricalSuggestion, generateSceneVideo } from './services/geminiService';
import { uploadToYouTube } from './services/youtubeService';
import VideoGenerator from './components/VideoGenerator';

const DB_NAME = 'MysteryArchiveDB_Permanent_V2';
const STORE_NAME = 'Videos';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveVideoToDB = async (item: VideoHistoryItem) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getVideosFromDB = async (): Promise<VideoHistoryItem[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const DEFAULT_PROFILE: StudioProfile = { id: 'main', name: 'メインプロジェクト', youtubeClientId: '1052425356858-11f29mh8moemrisj4jgbs8e33jr2e023.apps.googleusercontent.com', youtubeClientSecret: '' };
const SPARE_PROFILE: StudioProfile = { id: 'secondary', name: 'セカンダリプロジェクト', youtubeClientId: '281751451780-ojlpbn4kccrq1tlpcl5ukkdpvk853hvc.apps.googleusercontent.com', youtubeClientSecret: '' };

const App: React.FC = () => {
  const [topic, setTopic] = useState('');
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [bgmBuffer, setBgmBuffer] = useState<AudioBuffer | null>(null);
  const [bgmFileName, setBgmFileName] = useState<string>('');
  const [showBgmWarning, setShowBgmWarning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [videoHistory, setVideoHistory] = useState<VideoHistoryItem[]>([]);
  const [settings, setSettings] = useState<GeneratorSettings>(() => {
    const saved = localStorage.getItem('generator_settings_v18');
    const def = { numScenes: 6, sceneDuration: 15, artStyle: 'manga' as ArtStyle, bgmType: 'energy' as BgmType, bgmVolume: 0.20, aspectRatio: '9:16' as AspectRatio, veoMode: 'none' as VeoMode, profiles: [DEFAULT_PROFILE, SPARE_PROFILE], activeProfileId: 'main' };
    return saved ? { ...def, ...JSON.parse(saved) } : def;
  });
  const [status, setStatus] = useState<GenerationStatus>(GenerationStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [script, setScript] = useState<ScriptData | null>(null);
  const [titleAudio, setTitleAudio] = useState<AudioBuffer | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [finalVideoBlob, setFinalVideoBlob] = useState<Blob | null>(null);
  const [isCockpitOpen, setIsCockpitOpen] = useState(false);
  const [partialScenes, setPartialScenes] = useState<Scene[]>([]);

  const activeProfile = settings.profiles.find(p => p.id === settings.activeProfileId) || settings.profiles[0];
  const isBusy = status !== GenerationStatus.IDLE && status !== GenerationStatus.COMPLETED && status !== GenerationStatus.ERROR;

  useEffect(() => { localStorage.setItem('generator_settings_v18', JSON.stringify(settings)); }, [settings]);
  
  useEffect(() => { 
    getVideosFromDB().then(v => {
      const sorted = v.sort((a,b) => b.timestamp.localeCompare(a.timestamp))
                      .map(item => ({...item, url: item.blob ? URL.createObjectURL(item.blob) : undefined}));
      setVideoHistory(sorted);
    });
  }, []);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [{ message, timestamp: new Date().toLocaleTimeString(), type }, ...prev]);
  }, []);

  const handleBgmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBgmFileName(file.name);
    try {
      const audioCtx = new AudioContext();
      const buffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
      setBgmBuffer(buffer); addLog("BGMセット完了！完璧だわッ！", "success");
    } catch (err: any) { addLog(`BGMエラー: ${err.message}`, "error"); }
  };

  const fetchNextSuggestion = useCallback(async () => {
    try {
      addLog("ヒストリアの書庫から、とっておきの闇を探してるわ...待ってなさいッ！");
      const result = await getHistoricalSuggestion(topic ? [topic] : []);
      setSuggestion(result); 
      setTopic(result.name); 
      addLog(`新ネタ：${result.name}`, "success");
    } catch (e: any) { addLog(`推薦エラー: ${e.message}`, "error"); }
  }, [addLog, topic]);

  useEffect(() => { if (!topic) fetchNextSuggestion(); }, []);

  const handleStart = async (forceNoBgm: boolean = false) => {
    if (!bgmBuffer && !forceNoBgm) { setShowBgmWarning(true); return; }
    setShowBgmWarning(false);
    if (!topic.trim()) return;
    const hasKey = await (window as any).aistudio?.hasSelectedApiKey();
    if (!hasKey) await (window as any).aistudio?.openSelectKey();

    setFinalVideoUrl(null); setFinalVideoBlob(null); setPartialScenes([]);
    try {
      setStatus(GenerationStatus.SCRIPTING);
      addLog(`「${topic}」を執筆中...`);
      const currentScript = await generateScript(topic, settings.numScenes, settings.sceneDuration);
      setScript(currentScript);

      setStatus(GenerationStatus.GENERATING_ASSETS);
      const audioCtx = new AudioContext({ sampleRate: 44100 });
      addLog("タイトルの声を刻み中...");
      const tAudio = await generateSceneAudio(currentScript.titleNarrationText, audioCtx);
      setTitleAudio(tAudio);

      const completedScenes = [];
      for (let i = 0; i < currentScript.scenes.length; i++) {
        addLog(`錬成中: ${i + 1}/${currentScript.scenes.length}`);
        const sceneBase = currentScript.scenes[i];
        const img = await generateSceneImage(sceneBase.imagePrompt, settings.artStyle, settings.aspectRatio);
        const audio = await generateSceneAudio(sceneBase.narrationText, audioCtx);
        let video; if (settings.veoMode === 'all' || (settings.veoMode === 'first' && i === 0)) video = await generateSceneVideo(sceneBase.imagePrompt, settings.aspectRatio, (msg) => addLog(msg));
        const newScene = { ...sceneBase, imageUrl: img, videoUrl: video, audioBuffer: audio, duration: audio.duration };
        completedScenes.push(newScene); setPartialScenes([...completedScenes]);
      }
      setScript({ ...currentScript, scenes: completedScenes });
      setStatus(GenerationStatus.RECORDING);
    } catch (e: any) { addLog(`制作エラー: ${e.message}`, 'error'); setStatus(GenerationStatus.ERROR); }
  };

  const handleFinish = async (videoUrl: string, blob: Blob) => {
    setFinalVideoBlob(blob); setFinalVideoUrl(videoUrl);
    if (script) {
      const scriptForHistory: ScriptData = {
        ...script,
        scenes: script.scenes.map(({ audioBuffer, ...rest }) => ({ ...rest }))
      };
      
      const newItem: VideoHistoryItem = { 
        id: Date.now().toString(), 
        topic: script.topicName, 
        blob, 
        script: scriptForHistory, 
        timestamp: new Date().toLocaleString() 
      };
      
      try {
        await saveVideoToDB(newItem);
        setVideoHistory(prev => [{...newItem, url: videoUrl}, ...prev].slice(0, 10));
        addLog("不滅のアーカイブに保存したわよッ！", "success");
      } catch (err: any) {
        addLog(`アーカイブ保存エラー: ${err.message}`, "error");
      }
    }
    setStatus(GenerationStatus.COMPLETED);
    fetchNextSuggestion();
  };

  const handleYouTubeUploadFromHistory = async (blob: Blob, itemScript: ScriptData) => {
    if (!activeProfile.youtubeClientId) { addLog("コックピットで設定しなさいッ！", "error"); setIsCockpitOpen(true); return; }
    setIsUploading(true);
    try {
      const url = await uploadToYouTube({ clientId: activeProfile.youtubeClientId, clientSecret: activeProfile.youtubeClientSecret, videoBlob: blob, title: itemScript.title, description: itemScript.description, onProgress: (msg) => addLog(msg) });
      addLog(`成功！ URL: ${url}`, "success"); window.open(url, '_blank');
    } catch (e: any) { addLog(`YouTubeエラー: ${e.message}`, "error"); } finally { setIsUploading(false); }
  };

  const isShort = settings.aspectRatio === '9:16';
  // Google OAuthは末尾のスラッシュの有無を厳密に区別するわッ！一般的な登録形式に合わせて「origin + /」にするのが正解よッ！
  const currentFullRedirectUri = new URL(window.location.href.replace(/^blob:/, '')).origin + '/';

  return (
    <div className="flex h-screen bg-[#050505] text-zinc-100 font-sans overflow-hidden selection:bg-pink-600">
      {/* Cockpit Restoration */}
      {isCockpitOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl">
          <div className="w-full max-w-2xl bg-zinc-900 p-10 rounded-[4rem] border-2 border-pink-500 flex flex-col gap-8 shadow-[0_0_150px_rgba(236,72,153,0.3)]">
            <h2 className="text-3xl font-black italic text-pink-400 text-center uppercase tracking-tighter">STUDIO COCKPIT</h2>
            <div className="space-y-4">
               <label className="text-[10px] font-black text-pink-300 uppercase px-1">PROJECT PROFILING</label>
               <div className="grid grid-cols-2 gap-4">
                 {settings.profiles.map(p => (
                   <button key={p.id} onClick={() => setSettings({...settings, activeProfileId: p.id})} className={`p-6 rounded-[2.5rem] border-2 transition-all flex flex-col items-center ${settings.activeProfileId === p.id ? 'border-pink-500 bg-pink-500/10' : 'border-zinc-800 bg-black/40 text-zinc-600'}`}>
                     <span className="font-black italic uppercase text-sm">{p.name}</span>
                     <span className="text-[8px] font-black uppercase mt-1">{settings.activeProfileId === p.id ? 'ACTIVE' : 'SPARE'}</span>
                   </button>
                 ))}
               </div>
            </div>
            <div className="bg-zinc-800/30 p-8 rounded-[3rem] border border-zinc-700/30 space-y-5">
               <div className="space-y-1">
                 <label className="text-[9px] font-black text-zinc-500 uppercase px-1">YOUTUBE CLIENT ID</label>
                 <input type="text" value={activeProfile.youtubeClientId} onChange={e => {
                    const newProfiles = settings.profiles.map(p => p.id === settings.activeProfileId ? {...p, youtubeClientId: e.target.value} : p);
                    setSettings({...settings, profiles: newProfiles});
                 }} className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-[10px] font-mono outline-none focus:border-pink-500" />
               </div>
               <div className="space-y-1">
                 <label className="text-[9px] font-black text-zinc-500 uppercase px-1">YOUTUBE CLIENT SECRET</label>
                 <input type="password" value={activeProfile.youtubeClientSecret} onChange={e => {
                    const newProfiles = settings.profiles.map(p => p.id === settings.activeProfileId ? {...p, youtubeClientSecret: e.target.value} : p);
                    setSettings({...settings, profiles: newProfiles});
                 }} className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-[10px] font-mono outline-none focus:border-pink-500" />
               </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <button onClick={() => (window as any).aistudio?.openSelectKey()} className="py-5 bg-indigo-950/40 hover:bg-indigo-600 rounded-[2.5rem] font-black text-[10px] border border-indigo-500/30 uppercase tracking-widest">GEMINI API KEY</button>
               <button onClick={() => navigator.clipboard.writeText(currentFullRedirectUri)} className="py-5 bg-zinc-800 hover:bg-zinc-700 rounded-[2.5rem] font-black text-[10px] uppercase tracking-widest">COPY REDIRECT URI</button>
            </div>
            <button onClick={() => setIsCockpitOpen(false)} className="w-full py-6 bg-pink-600 rounded-[3rem] font-black text-sm uppercase transition-all active:scale-95 shadow-lg shadow-pink-600/20">CLOSE COCKPIT</button>
          </div>
        </div>
      )}

      {/* Main UI Restoration */}
      <div className="w-[480px] p-8 border-r border-zinc-900 flex flex-col bg-zinc-950/90 shrink-0 overflow-y-auto scrollbar-none">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-4xl font-black italic bg-gradient-to-br from-pink-500 to-indigo-500 bg-clip-text text-transparent">MYSTERY</h1>
            <p className="text-[10px] font-bold text-zinc-500 tracking-[0.3em] uppercase ml-1">CREATION DECK</p>
          </div>
          <button onClick={() => setIsCockpitOpen(true)} className="w-12 h-12 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-center hover:bg-zinc-800 active:scale-90 transition-all">⚙️</button>
        </div>

        <div className="space-y-6 flex-1">
          <div className="space-y-4">
            <div className="flex justify-between items-center px-1">
               <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">MAIN TOPIC</label>
               <button onClick={() => fetchNextSuggestion()} className="text-zinc-500 hover:text-white transition-all">🔄</button>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
               <input type="text" value={topic} onChange={e => setTopic(e.target.value)} disabled={isBusy} className="w-full bg-transparent font-black text-sm outline-none" />
            </div>
            {suggestion && (
              <div className="bg-pink-900/10 border border-pink-500/20 p-4 rounded-xl">
                 <p className="text-[10px] text-pink-400 italic leading-relaxed">{suggestion.reason}</p>
              </div>
            )}
          </div>

          <div className="bg-indigo-950/20 p-6 rounded-[2.5rem] border border-indigo-500/20 space-y-4">
            <div className="flex justify-between items-center px-1">
              <label className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">AUDIO LAB (CUSTOM BGM)</label>
              <span className="text-[10px] font-black text-indigo-500">{Math.round(settings.bgmVolume * 100)}%</span>
            </div>
            <div className="flex gap-4 items-center">
              <label className="flex-1 cursor-pointer group">
                <div className="bg-indigo-600/10 group-hover:bg-indigo-600/20 border-2 border-dashed border-indigo-500/30 rounded-2xl p-4 text-center">
                  <span className="text-[10px] font-black text-indigo-300 uppercase truncate block">{bgmFileName || "SOUL-DEEP BGM UPLOAD"}</span>
                </div>
                <input type="file" accept="audio/*" onChange={handleBgmUpload} className="hidden" />
              </label>
              <input type="range" min="0" max="1" step="0.01" value={settings.bgmVolume} onChange={e => setSettings({...settings, bgmVolume: parseFloat(e.target.value)})} className="w-1/3 accent-pink-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 bg-zinc-900/30 p-6 rounded-[2.5rem] border border-zinc-800/50">
             <div className="space-y-3">
               <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-1">ASPECT RATIO</label>
               <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-zinc-800">
                 <button onClick={() => setSettings({...settings, aspectRatio: '9:16'})} className={`flex-1 py-2 rounded-lg text-[9px] font-black ${settings.aspectRatio === '9:16' ? 'bg-white text-black' : 'text-zinc-600'}`}>SHORTS</button>
                 <button onClick={() => setSettings({...settings, aspectRatio: '16:9'})} className={`flex-1 py-2 rounded-lg text-[9px] font-black ${settings.aspectRatio === '16:9' ? 'bg-white text-black' : 'text-zinc-600'}`}>REGULAR</button>
               </div>
             </div>
             <div className="space-y-3">
               <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-1">VEO GENERATION MODE</label>
               <select value={settings.veoMode} onChange={e => setSettings({...settings, veoMode: e.target.value as VeoMode})} className="w-full bg-black border border-zinc-800 rounded-xl p-3 text-[10px] font-black uppercase outline-none">
                 <option value="none">IMAGES ONLY</option>
                 <option value="first">FIRST SCENE VIDEO</option>
                 <option value="all">FULL VIDEO</option>
               </select>
             </div>
             <div className="space-y-2">
               <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-1 flex justify-between">SCENES <span>{settings.numScenes}</span></label>
               <input type="range" min="3" max="10" value={settings.numScenes} onChange={e => setSettings({...settings, numScenes: parseInt(e.target.value)})} className="w-full accent-pink-500" />
             </div>
             <div className="space-y-2">
               <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-1 flex justify-between">DURATION <span>{settings.sceneDuration}S</span></label>
               <input type="range" min="5" max="30" value={settings.sceneDuration} onChange={e => setSettings({...settings, sceneDuration: parseInt(e.target.value)})} className="w-full accent-pink-500" />
             </div>
          </div>

          <div className="h-32 bg-black/60 rounded-[2rem] p-5 overflow-y-auto text-[9px] font-mono border border-zinc-900 scrollbar-none">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-pink-500 rounded-full animate-pulse"></span>
              <span className="text-pink-500 font-black uppercase">{activeProfile.name}</span>
              <span className="ml-auto text-zinc-600">{partialScenes.length} / {settings.numScenes}</span>
            </div>
            {logs.map((l, i) => (
              <div key={i} className={`mb-1 flex gap-3 ${l.type === 'error' ? 'text-red-500 font-bold' : l.type === 'success' ? 'text-pink-400' : 'text-zinc-600'}`}>
                <span className="opacity-40">[{l.timestamp}]</span><span>{l.message}</span>
              </div>
            ))}
          </div>

          <div className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setSettings({...settings, artStyle: 'realistic'})} className={`py-4 rounded-2xl font-black text-[11px] border ${settings.artStyle === 'realistic' ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-900/40 border-zinc-800 text-zinc-600'}`}>実写シネマ</button>
                <button onClick={() => setSettings({...settings, artStyle: 'manga'})} className={`py-4 rounded-2xl font-black text-[11px] border ${settings.artStyle === 'manga' ? 'bg-purple-600 border-purple-500' : 'bg-zinc-900/40 border-zinc-800 text-zinc-600'}`}>漫画アニメ</button>
             </div>
             {!isBusy && (
               <button onClick={() => handleStart()} className="w-full py-10 bg-white text-black hover:bg-zinc-100 rounded-[4rem] font-black text-3xl uppercase tracking-widest shadow-2xl active:scale-95 transition-all">GENERATE</button>
             )}
             {isBusy && (
               <div className="w-full py-10 bg-zinc-900 rounded-[4rem] text-center animate-pulse text-zinc-500 font-black text-xl">L O A D I N G . . .</div>
             )}
          </div>

          {videoHistory.length > 0 && !isBusy && (
            <div className="space-y-3 pt-6 border-t border-zinc-900 flex-1 overflow-y-auto scrollbar-none">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">MYSTERY ARCHIVES</label>
              <div className="space-y-3 pb-8">
                {videoHistory.map(item => (
                  <div key={item.id} className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 flex flex-col gap-4 group hover:border-pink-500/40 transition-all">
                    <div className="flex-1">
                      <p className="text-[11px] font-black text-zinc-100 truncate uppercase">{item.topic}</p>
                      <p className="text-[8px] text-zinc-500 font-mono mt-0.5">{item.timestamp}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setScript(item.script); setFinalVideoUrl(item.url || null); setStatus(GenerationStatus.COMPLETED); }} className="flex-1 py-2 bg-zinc-800 hover:bg-pink-600 rounded-xl text-[9px] font-black uppercase transition-all">PLAY</button>
                      {item.blob && (
                        <>
                          <a href={item.url} download={`mystery_${item.topic}.webm`} className="flex-1 py-2 bg-zinc-800 hover:bg-indigo-600 rounded-xl text-center text-[9px] font-black uppercase flex items-center justify-center transition-all">DL</a>
                          <button onClick={() => handleYouTubeUploadFromHistory(item.blob!, item.script)} className="flex-1 py-2 bg-zinc-800 hover:bg-red-600 rounded-xl text-[9px] font-black uppercase transition-all">YT</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center relative bg-[#0a0a0a]">
        {status === GenerationStatus.RECORDING ? (
          script && <VideoGenerator script={script} titleAudioBuffer={titleAudio} isRecording={true} aspectRatio={settings.aspectRatio} bgmBuffer={bgmBuffer} bgmVolume={settings.bgmVolume} onFinish={handleFinish} />
        ) : status === GenerationStatus.COMPLETED && finalVideoUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 gap-8 animate-in">
             <div className="relative border-[12px] border-pink-600/50 rounded-[4rem] overflow-hidden shadow-[0_0_150px_rgba(236,72,153,0.3)] bg-black"
                  style={{ height: isShort ? '85%' : 'auto', width: isShort ? 'auto' : '85%', aspectRatio: isShort ? '9/16' : '16/9' }}>
               <video key={finalVideoUrl} src={finalVideoUrl} controls playsInline autoPlay className="w-full h-full object-contain" />
               <div className="absolute top-6 left-6 bg-pink-600 px-4 py-2 rounded-full text-[10px] font-black shadow-lg">PREVIEW READY</div>
             </div>
             <button onClick={() => { setStatus(GenerationStatus.IDLE); setFinalVideoUrl(null); }} className="px-12 py-5 bg-zinc-800 hover:bg-zinc-700 rounded-full font-black text-sm uppercase tracking-widest shadow-xl transition-all">New Project</button>
          </div>
        ) : (
          <div className="text-zinc-900 font-black text-8xl tracking-[2em] uppercase opacity-[0.03] select-none animate-pulse">MYSTERY</div>
        )}
      </div>
      
      <style>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .animate-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
        input[type="range"] { -webkit-appearance: none; height: 4px; background: #1a1a1a; border-radius: 2px; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; height: 18px; width: 18px; border-radius: 50%; background: #fff; cursor: pointer; border: 4px solid #ec4899; box-shadow: 0 0 10px rgba(236,72,153,0.4); }
      `}</style>
    </div>
  );
};

export default App;
