
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
    
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    audioCtxRef.current = audioCtx;
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    
    const dest = audioCtx.createMediaStreamDestination();

    let bgmSource: AudioBufferSourceNode | null = null;
    if (bgmBuffer) {
      bgmSource = audioCtx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      const bgmGain = audioCtx.createGain();
      bgmGain.gain.value = bgmVolume;
      bgmSource.connect(bgmGain);
      bgmGain.connect(dest);
      bgmGain.connect(audioCtx.destination);
      bgmSource.start(0);
    }

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([...canvasStream.getTracks(), ...dest.stream.getAudioTracks()]);

    const recorder = new MediaRecorder(combinedStream, { 
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 8000000 
    });
    recorderRef.current = recorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      // 途中で止められた（isRecordingがfalseになった）場合はダウンロードさせない
      if (!isRecording && chunks.length > 0) return;
      
      const finalBlob = new Blob(chunks, { type: 'video/mp4' });
      const videoUrl = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `HistoryShorts_${script.topicName}.mp4`;
      a.click();
      onFinish(videoUrl);
    };

    recorder.start();

    let sceneIdx = -1;

    const playNextScene = () => {
      if (!isRecording) return;
      sceneIdx++;
      if (sceneIdx >= script.scenes.length) {
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
          bgmSource?.stop();
          if (audioCtx.state !== 'closed') {
            audioCtx.close().catch(console.error);
          }
        }, 1000);
        return;
      }

      const scene = script.scenes[sceneIdx];
      const img = images[sceneIdx];
      const dur = (scene.duration || 5) * 1000;
      const start = performance.now();

      if (scene.audioBuffer) {
        const s = audioCtx.createBufferSource();
        s.buffer = scene.audioBuffer;
        s.connect(dest);
        s.connect(audioCtx.destination);
        s.start(0);
      }

      const drawFrame = () => {
        if (!isRecording) return;
        const elapsed = performance.now() - start;
        const p = Math.min(elapsed / dur, 1);

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
        const z = 1.0 + (p * 0.1);
        drawImageCover(ctx, img, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT, z);

        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, VIDEO_HEIGHT * 0.75, VIDEO_WIDTH, VIDEO_HEIGHT * 0.25);

        ctx.font = '900 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FF69B4'; 
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 10;
        
        const cleaned = cleanText(scene.narrationText);
        const lines = wrapText(ctx, cleaned, VIDEO_WIDTH - 120);
        lines.forEach((line, i) => {
          const y = VIDEO_HEIGHT * 0.84 + (i * 72);
          ctx.strokeText(line, VIDEO_WIDTH / 2, y);
          ctx.fillText(line, VIDEO_WIDTH / 2, y);
        });

        if (p < 1) animationRef.current = requestAnimationFrame(drawFrame);
        else playNextScene();
      };
      animationRef.current = requestAnimationFrame(drawFrame);
    };

    const startTitleTime = performance.now();
    const drawTitleFrame = () => {
      if (!isRecording) return;
      const p = Math.min((performance.now() - startTitleTime) / TITLE_DURATION, 1);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
      
      if (images[0]) {
        ctx.globalAlpha = 0.4;
        drawImageCover(ctx, images[0], 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT, 1.0);
        ctx.globalAlpha = 1.0;
      }

      const bounce = 1.0 + Math.abs(Math.sin(p * Math.PI * 4)) * 0.05;
      ctx.save();
      ctx.translate(VIDEO_WIDTH / 2, VIDEO_HEIGHT / 2);
      ctx.scale(bounce, bounce);
      
      ctx.font = '900 80px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'black'; ctx.lineWidth = 20; 
      ctx.strokeText("歴史オネエ秘話", 0, -110);
      ctx.fillStyle = '#FF1493'; ctx.fillText("歴史オネエ秘話", 0, -110);
      
      let fontSize = 110;
      ctx.font = `900 ${fontSize}px sans-serif`;
      while (ctx.measureText(script.topicName).width > VIDEO_WIDTH - 100 && fontSize > 40) {
        fontSize -= 5;
        ctx.font = `900 ${fontSize}px sans-serif`;
      }
      ctx.strokeStyle = 'black'; ctx.lineWidth = 15;
      ctx.strokeText(script.topicName, 0, 40);
      ctx.fillStyle = 'white'; ctx.fillText(script.topicName, 0, 40);
      
      ctx.font = 'bold 50px sans-serif';
      ctx.fillStyle = '#00FFFF'; ctx.fillText("〜地獄のショーよッ！〜", 0, 160);
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
      // 録画中断時のクリーンアップ
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
          <div className="absolute top-10 left-10 flex items-center gap-3">
            <div className="w-5 h-5 bg-pink-600 rounded-full animate-ping shadow-[0_0_20px_pink]"></div>
            <span className="text-sm font-black text-white tracking-widest uppercase italic">ON AIR: DRAG SHOW</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoGenerator;
