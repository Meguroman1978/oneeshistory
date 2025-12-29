
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
      // レースコンディション対策: 選択直後は成功とみなして進む
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

        // クォータ対策でシーン間にウェイトを入れる
        if (i > 0) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 3000); // 3秒待機
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
      // クォータ超過またはリソース不足（無料ティアの制限）の判定
      const isQuotaError = 
        errorMessage.includes('429') || 
        errorMessage.toLowerCase().includes('quota') || 
        errorMessage.includes('RESOURCE_EXHAUSTED') ||
        errorMessage.includes('limit: 0') ||
        errorMessage.includes('limit exceeded');
      
      const isNotFoundError = errorMessage.includes('Requested entity was not found.');

      if (isNotFoundError || isQuotaError) {
        let msg = "あらやだ、APIの壁にぶち当たったわッ！";
        if (errorMessage.includes('limit: 0')) {
          msg = "あんた！そのプロジェクト、課金設定がされてないか制限されてるわッ！有料プロジェクトのAPIキーを選び直しなさい！";
        } else if (isQuotaError) {
          msg = "無料枠を使い切ったみたいね。有料プロジェクトのキーなら無限に生成できるわよッ！";
        } else {
          msg = "APIキーの設定が正しくないみたい。もう一度選び直してちょうだい！";
        }
        
        addLog(msg, 'error');
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

  // APIキー選択画面
  if (isKeySetupVisible) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-6">
        <div className="max-w-md w-full bg-gradient-to-br from-purple-900/40 to-pink-900/40 border border-pink-500/50 rounded-[3rem] p-10 text-center shadow-[0_0_100px_rgba(236,72,153,0.3)]">
          <h2 className="text-4xl font-black bg-gradient-to-r from-pink-300 to-purple-400 bg-clip-text text-transparent italic mb-6 text-glow">
            オネエの特別室へ
          </h2>
          <p className="text-pink-100/80 mb-8 font-bold leading-relaxed">
            あんた、この動画ショーを本気で楽しみたければ<br/>
            <span className="text-pink-400 font-black text-lg underline underline-offset-4 decoration-pink-500">「有料プロジェクト(Pay-as-you-go)」</span><br/>
            から発行したAPIキーを用意しなさいッ！
          </p>
          <div className="space-y-4">
            <button
              onClick={handleOpenKeySelector}
              className="w-full py-5 bg-gradient-to-r from-pink-600 to-purple-700 rounded-2xl font-black text-xl hover:scale-105 active:scale-95 transition-all shadow-xl shadow-pink-500/30 border border-white/20"
            >
              APIキーを選択し直すわッ！
            </button>
            <div className="pt-4 text-left bg-black/40 p-4 rounded-xl border border-white/10 text-xs text-gray-400">
              <p className="font-bold text-pink-300 mb-2">💡 解決のヒント:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Google AI Studioで「Pay-as-you-go」に設定済みか確認。</li>
                <li>「limit: 0」は、そのモデルの使用が許可されていない証拠よ。</li>
                <li>無料枠のキーだと、画像や音声生成ですぐ制限がかかっちゃうの。</li>
              </ul>
            </div>
            <a
              href="https://ai.google.dev/gemini-api/docs/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[10px] text-purple-300 hover:text-pink-300 underline underline-offset-4 opacity-70 mt-2"
            >
              課金設定の公式ガイド（英語だけど読みなさい！）
            </a>
            <button
              onClick={() => setIsKeySetupVisible(false)}
              className="block w-full text-xs text-gray-600 hover:text-white mt-4 transition-colors"
            >
              今はいいわ（閉じる）
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

        <div className="mt-4 flex-1 bg-black/40 rounded-2xl p-4 overflow-y-auto text-[10px] font-mono border border-purple-500/20 scrollbar-thin">
          {logs.map((log, i) => (
            <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-pink-400' : 'text-gray-500'}`}>
              <span className="opacity-30">[{log.timestamp}]</span> {log.message}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center bg-black/40 rounded-[3rem] border border-purple-500/10 relative overflow-hidden shadow-inner">
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
          <div className="text-purple-900/50 text-center uppercase tracking-[0.5em] font-black pointer-events-none">
            <p className="text-8xl mb-4 italic text-glow-purple">ShowTime</p>
            <p className="text-sm">テーマを入力してショーを始めなさい！</p>
          </div>
        )}
        {isBusy && status !== GenerationStatus.RECORDING && (
          <div className="flex flex-col items-center gap-6">
            <div className="w-20 h-20 border-8 border-pink-500 border-t-transparent rounded-full animate-spin shadow-[0_0_20px_rgba(236,72,153,0.5)]"></div>
            <div className="text-center">
              <p className="text-pink-500 font-black animate-pulse uppercase tracking-widest text-lg">Preparing the Stage...</p>
              <p className="text-xs text-purple-400 opacity-60 mt-2">※クォータ制限を避けるため、ゆっくり作っているわ。</p>
            </div>
          </div>
        )}
        {status === GenerationStatus.ERROR && !isKeySetupVisible && (
          <div className="text-center p-10 bg-red-900/20 rounded-3xl border border-red-500/30 backdrop-blur-md">
            <p className="text-red-400 font-black text-2xl mb-4 italic">あらやだ、トラブル発生よ！</p>
            <button 
              onClick={() => setIsKeySetupVisible(true)}
              className="px-8 py-4 bg-red-600 rounded-2xl font-black hover:bg-red-500 transition-all active:scale-95 shadow-lg shadow-red-500/30"
            >
              APIキーの設定を今すぐ直すッ！
            </button>
          </div>
        )}
      </div>
      
      <style>{`
        .text-glow { text-shadow: 0 0 10px rgba(255,105,180,0.8); }
        .text-glow-purple { text-shadow: 0 0 20px rgba(147,51,234,0.3); }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(147,51,234,0.3); border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;
