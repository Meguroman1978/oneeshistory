
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ScriptData } from '../types';

interface Props {
  script: ScriptData;
  isRecording: boolean;
  bgmBuffer: AudioBuffer | null;
  bgmVolume: number;
  onFinish: (videoUrl: string) => void;
}

const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 1280;
const TITLE_DURATION = 3000;

const NG_WORDS = [/死/g, /殺/g, /暗殺/g, /処刑/g, /虐殺/g, /自殺/g];

const VideoGenerator: React.FC<Props> = ({ script, isRecording, bgmBuffer, bgmVolume, onFinish }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [isAssetsReady, setIsAssetsReady] = useState(false);

  useEffect(() => {
    const loadImages = async () => {
      try {
        const loaded = await Promise.all(
          script.scenes.map(scene => {
            return new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.src = scene.imageUrl!;
              img.onload = () => resolve(img);
              img.onerror = () => reject(new Error("Image load failed"));
            });
          })
        );
        setImages(loaded);
        setIsAssetsReady(true);
      } catch (e) {
        console.error("Asset error:", e);
      }
    };
    if (script.scenes.length > 0) loadImages();
  }, [script]);

  const cleanText = (text: string) => {
    let result = text.replace(/\[ピー\]/g, "●●");
    NG_WORDS.forEach(reg => {
      result = result.replace(reg, "●●");
    });
    return result;
  };

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    const words = text.split('');
    let line = '', lines = [];
    for (let char of words) {
      if (ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    lines.push(line);
    return lines;
  };

  const drawImageCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, scale: number = 1.0) => {
    const imgRatio = img.width / img.height;
    const canvasRatio = w / h;
    let sw, sh, sx, sy;

    if (imgRatio > canvasRatio) {
      sh = img.height;
      sw = img.height * canvasRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = img.width / canvasRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }

    const finalW = w * scale;
    const finalH = h * scale;
    const finalX = x + (w - finalW) / 2;
    const finalY = y + (h - finalH) / 2;

    ctx.drawImage(img, sx, sy, sw, sh, finalX, finalY, finalW, finalH);
  };

  const run = useCallback(async () => {
    if (!canvasRef.current || !isAssetsReady) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    
    // AudioContextの初期化
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    audioCtxRef.current = audioCtx;
    
    // ブラウザの制限を解除するために一度Resume
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
    // 録画用ストリームの作成
    const dest = audioCtx.createMediaStreamDestination();
    const masterGain = audioCtx.createGain();
    masterGain.connect(dest);
    masterGain.connect(audioCtx.destination); // プレビュー中も音を出す

    // BGMの設定
    let bgmSource: AudioBufferSourceNode | null = null;
    if (bgmBuffer) {
      bgmSource = audioCtx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      const bgmGain = audioCtx.createGain();
      bgmGain.gain.value = bgmVolume;
      bgmSource.connect(bgmGain);
      bgmGain.connect(masterGain);
      bgmSource.start(0);
    }

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    // WebMとして一度保存し、ブラウザで再生可能な状態にする
    const recorder = new MediaRecorder(combinedStream, { 
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 5000000 
    });
    recorderRef.current = recorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      if (!chunks.length) return;
      const finalBlob = new Blob(chunks, { type: 'video/webm' });
      const videoUrl = URL.createObjectURL(finalBlob);
      
      // 自動ダウンロード
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `Final_Show_${script.topicName}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      onFinish(videoUrl);
    };

    recorder.start();

    let sceneIdx = -1;

    const playNextScene = () => {
      if (!isRecording) return;
      sceneIdx++;
      
      if (sceneIdx >= script.scenes.length) {
        // 終了処理
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
          bgmSource?.stop();
          if (audioCtx.state !== 'closed') audioCtx.close().catch(console.error);
        }, 1500);
        return;
      }

      const scene = script.scenes[sceneIdx];
      const img = images[sceneIdx];
      const dur = (scene.duration || 5) * 1000;
      const start = performance.now();

      // ナレーションの再生
      if (scene.audioBuffer) {
        const s = audioCtx.createBufferSource();
        s.buffer = scene.audioBuffer;
        s.connect(masterGain);
        s.start(0);
      }

      const drawFrame = () => {
        if (!isRecording) return;
        const elapsed = performance.now() - start;
        const p = Math.min(elapsed / dur, 1);

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
        const z = 1.0 + (p * 0.12); // 少しズーム
        drawImageCover(ctx, img, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT, z);

        // テロップ背景
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, VIDEO_HEIGHT * 0.78, VIDEO_WIDTH, VIDEO_HEIGHT * 0.22);

        // テロップ描画
        ctx.font = '900 46px "Hiragino Sans", "Meiryo", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFFFFF'; 
        ctx.strokeStyle = '#FF1493'; // オネエピンクの縁取り
        ctx.lineWidth = 12;
        ctx.lineJoin = 'round';
        
        const cleaned = cleanText(scene.narrationText);
        const lines = wrapText(ctx, cleaned, VIDEO_WIDTH - 100);
        lines.forEach((line, i) => {
          const y = VIDEO_HEIGHT * 0.86 + (i * 70);
          ctx.strokeText(line, VIDEO_WIDTH / 2, y);
          ctx.fillText(line, VIDEO_WIDTH / 2, y);
        });

        if (p < 1) animationRef.current = requestAnimationFrame(drawFrame);
        else playNextScene();
      };
      animationRef.current = requestAnimationFrame(drawFrame);
    };

    // 冒頭のタイトルカード表示
    const startTitleTime = performance.now();
    const drawTitleFrame = () => {
      if (!isRecording) return;
      const elapsed = performance.now() - startTitleTime;
      const p = Math.min(elapsed / TITLE_DURATION, 1);
      
      ctx.fillStyle = '#0a050a';
      ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
      
      if (images[0]) {
        ctx.globalAlpha = 0.35;
        drawImageCover(ctx, images[0], 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT, 1.0 + p * 0.05);
        ctx.globalAlpha = 1.0;
      }

      const bounce = 1.0 + Math.abs(Math.sin(p * Math.PI * 3)) * 0.03;
      ctx.save();
      ctx.translate(VIDEO_WIDTH / 2, VIDEO_HEIGHT / 2);
      ctx.scale(bounce, bounce);
      
      // メインタイトル
      ctx.font = '900 70px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 18; 
      ctx.strokeText("オネエ歴史秘話", 0, -120);
      ctx.fillStyle = '#FF1493'; ctx.fillText("オネエ歴史秘話", 0, -120);
      
      // テーマ名
      let fontSize = 90;
      ctx.font = `900 ${fontSize}px sans-serif`;
      while (ctx.measureText(script.topicName).width > VIDEO_WIDTH - 80 && fontSize > 35) {
        fontSize -= 5;
        ctx.font = `900 ${fontSize}px sans-serif`;
      }
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 14;
      ctx.strokeText(script.topicName, 0, 40);
      ctx.fillStyle = '#FFFFFF'; ctx.fillText(script.topicName, 0, 40);
      
      ctx.font = 'bold 45px sans-serif';
      ctx.fillStyle = '#00FFFF'; 
      ctx.strokeText("〜地獄の開幕よッ！〜", 0, 180);
      ctx.fillText("〜地獄の開幕よッ！〜", 0, 180);
      ctx.restore();

      if (p < 1) animationRef.current = requestAnimationFrame(drawTitleFrame);
      else playNextScene();
    };
    animationRef.current = requestAnimationFrame(drawTitleFrame);

  }, [isAssetsReady, images, script, bgmBuffer, bgmVolume, onFinish, isRecording]);

  useEffect(() => {
    if (isRecording && isAssetsReady) {
      run();
    } else if (!isRecording) {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(console.error);
        audioCtxRef.current = null;
      }
      cancelAnimationFrame(animationRef.current);
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [isRecording, isAssetsReady, run]);

  return (
    <div className="w-full h-full flex items-center justify-center p-6 bg-black">
      <div className="relative shadow-[0_0_120px_rgba(255,20,147,0.3)] rounded-[4rem] overflow-hidden border-[18px] border-gray-900 bg-black" 
           style={{ height: '90%', aspectRatio: '9/16' }}>
        <canvas ref={canvasRef} width={VIDEO_WIDTH} height={VIDEO_HEIGHT} className="w-full h-full object-contain" />
        {isRecording && (
          <div className="absolute top-10 left-10 flex items-center gap-3 bg-black/50 px-4 py-2 rounded-full border border-pink-500/50">
            <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse shadow-[0_0_10px_red]"></div>
            <span className="text-[10px] font-black text-white tracking-widest uppercase italic">LIVE MIXING...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoGenerator;
