
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GenerationStatus, ScriptData, LogEntry, Scene, GeneratorSettings, ArtStyle, BgmType } from './types';
import { generateScript, generateSceneImage, generateSceneAudio } from './services/geminiService';
import VideoGenerator from './components/VideoGenerator';

const App: React.FC = () => {
  const [topic, setTopic] = useState('本能寺の変の裏話');
  const [settings, setSettings] = useState<GeneratorSettings>({
    numScenes: 4,
    sceneDuration: 5,
    artStyle: 'manga',
    bgmType: 'bgm1',
    bgmVolume: 0.25
  });
  const [status, setStatus] = useState<GenerationStatus>(GenerationStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [script, setScript] = useState<ScriptData | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [bgmBuffer, setBgmBuffer] = useState<AudioBuffer | null>(null);
  const [isKeySetupVisible, setIsKeySetupVisible] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) {
          setIsKeySetupVisible(true);
        }
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio) {
      await aistudio.openSelectKey();
      setIsKeySetupVisible(false);
    }
  };

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [{ message, timestamp: new Date().toLocaleTimeString(), type }, ...prev]);
  }, []);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus(GenerationStatus.IDLE);
    setScript(null);
    addLog(`あらッ、ショーを中止したわよ！また気が向いたら呼んでちょうだい。`, 'info');
  }, [addLog]);

  const handleStart = async () => {
    if (!topic.trim()) return;
    setFinalVideoUrl(null);
    setBgmBuffer(null);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    try {
      setStatus(GenerationStatus.SCRIPTING);
      addLog(`カリスマオネエ、脚本執筆中よッ！`);

      const scriptData = await generateScript(topic, settings.numScenes, signal);
      if (signal.aborted) return;
      setScript(scriptData);
      addLog(`脚本完成！テーマは「${scriptData.topicName}」よ。`, 'success');

      setStatus(GenerationStatus.GENERATING_ASSETS);
      addLog(`素材をかき集めてるわ、ちょっと待ってなさい！`);
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });

      const bgmUrl = settings.bgmType === 'bgm1' 
        ? 'https://actions.google.com/sounds/v1/ambient/dark_room.ogg'
        : 'https://actions.google.com/sounds/v1/ambient/creepy_forest_atmosphere.ogg';
      
      const fetchBgm = async () => {
        try {
          const res = await fetch(bgmUrl, { signal });
          if (!res.ok) throw new Error(`BGM HTTP error: ${res.status}`);
          const arrayBuf = await res.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(arrayBuf);
          setBgmBuffer(decoded);
          addLog(`BGM「${settings.bgmType === 'bgm1' ? '歴史の闇' : 'オネエの溜息'}」の準備完了！`);
        } catch (e: any) {
          if (e.name !== 'AbortError') addLog(`BGM読み込み失敗: ${e.message}`, 'error');
        }
      };

      const updatedScenes: Scene[] = [];
      for (let i = 0; i < scriptData.scenes.length; i++) {
        if (signal.aborted) return;

        if (i > 0) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 2000);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error("AbortError"));
            });
          });
        }

        const scene = scriptData.scenes[i];
        addLog(`シーン ${i + 1}/${scriptData.scenes.length} を生成中...`);
        
        try {
          const imageUrl = await generateSceneImage(scene.imagePrompt, settings.artStyle, signal);
          const audioBuffer = await generateSceneAudio(scene.narrationText, audioCtx, signal);
          
          updatedScenes.push({
            ...scene,
            imageUrl,
            audioBuffer,
            duration: Math.max(audioBuffer.duration + 0.5, settings.sceneDuration)
          });
          
          addLog(`シーン ${i + 1} 完了！`);
        } catch (err: any) {
          if (err.name === 'AbortError') return;
          throw err;
        }
      }

      await fetchBgm();

      if (signal.aborted) return;
      setScript({ ...scriptData, scenes: updatedScenes });
      addLog(`全素材が揃ったわ！開演よッ！`, 'success');
      setStatus(GenerationStatus.RECORDING);

    } catch (error: any) {
      if (error.name === 'AbortError') return;
      console.error(error);

      const errorMessage = error.message || "";
      const isQuotaError = 
        errorMessage.includes('429') || 
        errorMessage.toLowerCase().includes('quota') || 
        errorMessage.includes('RESOURCE_EXHAUSTED') ||
        errorMessage.includes('limit: 0');
      const isNotFoundError = errorMessage.includes('Requested entity was not found.');

      if (isNotFoundError) {
        addLog("APIキーが無効か、プロジェクトが見つからないわッ！選び直して！", 'error');
        setIsKeySetupVisible(true);
        setStatus(GenerationStatus.ERROR);
        return;
      }

      if (isQuotaError) {
        addLog("あんた、APIのクォータ制限よッ！無料枠が尽きたか制限されてるわ。有料プロジェクトのキーを使えば解決するわよ！今すぐ設定しなさい！", 'error');
        setIsKeySetupVisible(true);
        setStatus(GenerationStatus.ERROR);
        return;
      }

      addLog(`あらやだエラー！: ${error.message}`, 'error');
      setStatus(GenerationStatus.ERROR);
    }
  };

  const handleFinish = (videoUrl: string) => {
    setStatus(GenerationStatus.COMPLETED);
    setFinalVideoUrl(videoUrl);
    addLog(`最高な動画ができたわよ！ダウンロードなさい！`, 'success');
    abortControllerRef.current = null;
  };

  const isBusy = status !== GenerationStatus.IDLE && status !== GenerationStatus.COMPLETED && status !== GenerationStatus.ERROR;

  // API Key selection overlay
  if (isKeySetupVisible) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-6">
        <div className="max-w-md w-full bg-gradient-to-br from-purple-900/40 to-pink-900/40 border border-pink-500/50 rounded-[3rem] p-10 text-center shadow-[0_0_100px_rgba(236,72,153,0.3)]">
          <h2 className="text-4xl font-black bg-gradient-to-r from-pink-300 to-purple-400 bg-clip-text text-transparent italic mb-6">
            オネエの楽屋へようこそ
          </h2>
          <p className="text-pink-100/80 mb-8 font-bold leading-relaxed">
            あんた、このショーを楽しみたければ<br/>自分のAPIキーを用意しなさいッ！<br/>
            <span className="text-pink-400 font-black">※「Quota exceeded (limit: 0)」エラーが出ている場合、有料プロジェクトのAPIキーを選択する必要があるわよ！</span>
          </p>
          <div className="space-y-4">
            <button
              onClick={handleOpenKeySelector}
              className="w-full py-5 bg-gradient-to-r from-pink-600 to-purple-700 rounded-2xl font-black text-xl hover:scale-105 active:scale-95 transition-all shadow-xl shadow-pink-500/30"
            >
              自分のAPIキーを使うわッ！
            </button>
            <a
              href="https://ai.google.dev/gemini-api/docs/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-purple-300 hover:text-pink-300 underline underline-offset-4 opacity-70"
            >
              課金設定の仕方がわからない？（ドキュメント）
            </a>
            <button
              onClick={() => setIsKeySetupVisible(false)}
              className="block w-full text-xs text-gray-500 hover:text-white mt-4"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen p-4 gap-4 bg-[#0a050a] text-white overflow-hidden font-sans">
      <div className="w-full lg:w-96 flex flex-col gap-4 bg-purple-900/20 p-6 rounded-[2.5rem] border border-purple-500/30 shrink-0 backdrop-blur-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-black bg-gradient-to-r from-pink-400 to-purple-600 bg-clip-text text-transparent italic tracking-tighter">
            オネエ歴史秘話
          </h1>
          <button 
            onClick={() => setIsKeySetupVisible(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="APIキー設定"
          >
            ⚙️
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-purple-300 uppercase font-black">歴史テーマ</label>
            <input
              type="text" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={isBusy}
              className="bg-white/5 border border-purple-500/30 rounded-xl p-4 text-white font-bold outline-none focus:border-pink-500 transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[10px] text-purple-300 uppercase font-black">シーン数</label>
              <input
                type="number" min="1" max="10" value={settings.numScenes}
                onChange={(e) => setSettings({...settings, numScenes: parseInt(e.target.value)})}
                className="w-full bg-white/5 border border-purple-500/30 rounded-xl p-3" disabled={isBusy}
              />
            </div>
            <div>
              <label className="text-[10px] text-purple-300 uppercase font-black">1シーン最低秒数</label>
              <input
                type="number" min="3" max="15" value={settings.sceneDuration}
                onChange={(e) => setSettings({...settings, sceneDuration: parseInt(e.target.value)})}
                className="w-full bg-white/5 border border-purple-500/30 rounded-xl p-3" disabled={isBusy}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-purple-300 uppercase font-black flex justify-between">
              <span>BGM 音量 ({Math.round(settings.bgmVolume * 100)}%)</span>
            </label>
            <input
              type="range" min="0" max="100" step="1" value={settings.bgmVolume * 100}
              onChange={(e) => setSettings({...settings, bgmVolume: parseInt(e.target.value) / 100})}
              disabled={isBusy}
              className="w-full accent-pink-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-purple-300 uppercase font-black">BGM 選択</label>
            <select
              value={settings.bgmType}
              onChange={(e) => setSettings({...settings, bgmType: e.target.value as BgmType})}
              className="w-full bg-white/5 border border-purple-500/30 rounded-xl p-3 outline-none focus:border-pink-500" disabled={isBusy}
            >
              <option value="bgm1">歴史の闇</option>
              <option value="bgm2">オネエの溜息</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-2">
          {!isBusy ? (
            <button
              onClick={handleStart}
              className="w-full py-5 rounded-2xl font-black text-xl shadow-2xl transition-all active:scale-95 bg-gradient-to-r from-pink-600 to-purple-700 hover:from-pink-500 hover:to-purple-600 shadow-pink-500/20"
            >
              動画生成開始よッ！
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="w-full py-5 rounded-2xl font-black text-xl shadow-2xl transition-all active:scale-95 bg-red-600 hover:bg-red-500 shadow-red-500/20 border-2 border-red-400"
            >
              キャンセルしてッ！
            </button>
          )}
          
          {finalVideoUrl && (
            <a
              href={finalVideoUrl}
              download={`history_drag_${topic}.mp4`}
              className="w-full py-4 bg-green-600 hover:bg-green-500 text-center rounded-2xl font-black text-lg transition-all shadow-xl shadow-green-500/20"
            >
              動画を保存する
            </a>
          )}
        </div>

        <div className="mt-4 flex-1 bg-black/40 rounded-2xl p-4 overflow-y-auto text-[10px] font-mono border border-purple-500/20">
          {logs.map((log, i) => (
            <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-pink-400' : 'text-gray-500'}`}>
              <span className="opacity-30">[{log.timestamp}]</span> {log.message}
            </div>
          ))}
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 flex flex-col items-center justify-center bg-black/40 rounded-[3rem] border border-purple-500/10 relative overflow-hidden">
        {(status === GenerationStatus.RECORDING || status === GenerationStatus.COMPLETED) && script && (
          <VideoGenerator 
            script={script} 
            isRecording={status === GenerationStatus.RECORDING} 
            bgmBuffer={bgmBuffer} 
            bgmVolume={settings.bgmVolume} 
            onFinish={handleFinish} 
          />
        )}
        {status === GenerationStatus.IDLE && (
          <div className="text-purple-900/50 text-center uppercase tracking-[0.5em] font-black">
            <p className="text-8xl mb-4 italic">ShowTime</p>
            <p className="text-sm">テーマを入力してショーを始めなさい！</p>
          </div>
        )}
        {isBusy && status !== GenerationStatus.RECORDING && (
          <div className="flex flex-col items-center gap-6">
            <div className="w-20 h-20 border-8 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-pink-500 font-black animate-pulse uppercase tracking-widest text-lg">Preparing the Stage...</p>
            <p className="text-xs text-purple-400 opacity-60">※クォータ制限を避けるため、ゆっくり作っているわ。</p>
          </div>
        )}
        {status === GenerationStatus.ERROR && !isKeySetupVisible && (
          <div className="text-center p-10 bg-red-900/20 rounded-3xl border border-red-500/30">
            <p className="text-red-400 font-black text-2xl mb-4 italic">あらやだ、トラブル発生よ！</p>
            <button 
              onClick={() => setIsKeySetupVisible(true)}
              className="px-6 py-3 bg-red-600 rounded-xl font-bold hover:bg-red-500 transition-colors"
            >
              APIキーの設定を確認する
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
