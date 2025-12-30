
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ScriptData, AspectRatio } from '../types';

interface Props {
  script: ScriptData;
  titleAudioBuffer?: AudioBuffer | null;
  isRecording: boolean;
  aspectRatio: AspectRatio;
  bgmBuffer: AudioBuffer | null;
  bgmVolume: number;
  onFinish: (videoUrl: string, blob: Blob) => void;
}

const VideoGenerator: React.FC<Props> = ({ script, titleAudioBuffer, isRecording, aspectRatio, bgmBuffer, bgmVolume, onFinish }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const bgmGainRef = useRef<GainNode | null>(null);
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [videoElements, setVideoElements] = useState<(HTMLVideoElement | null)[]>([]);
  const [isAssetsReady, setIsAssetsReady] = useState(false);

  const isShort = aspectRatio === '9:16';
  const VW = isShort ? 720 : 1280;
  const VH = isShort ? 1280 : 720;
  const LINE_HEIGHT = isShort ? 90 : 75;
  const TEXT_AREA_Y = VH * 0.72;
  const SUBTITLE_BASE_Y = isShort ? VH * 0.88 : VH * 0.90; 
  const INTRO_DURATION = titleAudioBuffer ? titleAudioBuffer.duration * 1000 + 500 : 5000; 

  const POWER_WORDS_RED = ["死", "血", "殺", "絶望", "闇", "裏側", "呪", "禁断", "裏切り", "消失", "謎"];
  const POWER_WORDS_YELLOW = ["真実", "神", "宝", "黄金", "秘密", "奇跡", "衝撃", "閲覧注意", "最後"];

  useEffect(() => {
    const loadAssets = async () => {
      try {
        const imgPromises = script.scenes.map(scene => {
          return new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = scene.imageUrl!;
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Image failed"));
          });
        });
        const videoPromises = script.scenes.map(scene => {
          if (!scene.videoUrl) return Promise.resolve(null);
          return new Promise<HTMLVideoElement>((resolve) => {
            const v = document.createElement('video');
            v.src = scene.videoUrl!;
            v.crossOrigin = "anonymous";
            v.muted = true;
            v.loop = true;
            v.oncanplaythrough = () => resolve(v);
            v.load();
          });
        });
        const [loadedImgs, loadedVideos] = await Promise.all([Promise.all(imgPromises), Promise.all(videoPromises)]);
        setImages(loadedImgs);
        setVideoElements(loadedVideos);
        setIsAssetsReady(true);
      } catch (e) { console.error(e); }
    };
    if (script.scenes.length > 0) loadAssets();
  }, [script]);

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

  const drawImageCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLVideoElement, w: number, h: number, scale: number, blur = false) => {
    const imgWidth = (img instanceof HTMLVideoElement) ? img.videoWidth : img.width;
    const imgHeight = (img instanceof HTMLVideoElement) ? img.videoHeight : img.height;
    if (imgWidth === 0 || imgHeight === 0) return;
    const imgRatio = imgWidth / imgHeight;
    const canvasRatio = w / h;
    let sw, sh, sx, sy;
    if (imgRatio > canvasRatio) { sh = imgHeight; sw = imgHeight * canvasRatio; sx = (imgWidth - sw) / 2; sy = 0; }
    else { sw = imgWidth; sh = imgWidth / canvasRatio; sx = 0; sy = (imgHeight - sh) / 2; }
    const finalW = w * scale; const finalH = h * scale;
    if (blur) ctx.filter = 'blur(15px) brightness(0.4)'; else ctx.filter = 'brightness(0.7)';
    ctx.drawImage(img, sx, sy, sw, sh, (w - finalW) / 2, (h - finalH) / 2, finalW, finalH);
    ctx.filter = 'none';
  };

  const run = useCallback(async () => {
    if (!canvasRef.current || !isAssetsReady || images.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const audioCtx = new AudioContext({ sampleRate: 44100 });
    audioCtxRef.current = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();
    const masterGain = audioCtx.createGain();
    masterGain.connect(dest); masterGain.connect(audioCtx.destination);

    let bgmGain: GainNode | null = null;
    if (bgmBuffer) {
      const bgmSource = audioCtx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      bgmGain = audioCtx.createGain();
      bgmGain.gain.setValueAtTime(bgmVolume, audioCtx.currentTime);
      bgmSource.connect(bgmGain);
      bgmGain.connect(masterGain);
      bgmSource.start(0);
      bgmGainRef.current = bgmGain;
    }

    const recorder = new MediaRecorder(new MediaStream([...canvas.captureStream(30).getTracks(), ...dest.stream.getAudioTracks()]), { mimeType: 'video/webm;codecs=vp9,opus' });
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      onFinish(URL.createObjectURL(blob), blob);
    };
    recorder.start();

    const showIntro = () => {
      if (titleAudioBuffer) {
        const s = audioCtx.createBufferSource(); s.buffer = titleAudioBuffer; s.connect(masterGain); s.start(0);
      }
      return new Promise<void>(resolve => {
        const start = performance.now();
        const drawIntro = () => {
          const elapsed = performance.now() - start;
          const p = Math.min(elapsed / INTRO_DURATION, 1);
          ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, VW, VH);
          if (images[0]) drawImageCover(ctx, images[0], VW, VH, 1.1 - (p * 0.05), false);
          ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const headerP = Math.min(p * 2, 1);
          ctx.font = `900 ${isShort ? '80px' : '64px'} "Hiragino Sans", "Meiryo", sans-serif`;
          ctx.globalAlpha = headerP;
          ctx.strokeStyle = 'black'; ctx.lineWidth = 20; ctx.lineJoin = 'round';
          ctx.strokeText("オネエ歴史秘話", VW / 2, VH * 0.35);
          ctx.fillStyle = '#ec4899'; ctx.fillText("オネエ歴史秘話", VW / 2, VH * 0.35);
          const titleP = Math.max(0, Math.min((p - 0.1) * 2, 1));
          if (titleP > 0) {
            ctx.globalAlpha = titleP;
            ctx.font = `900 ${isShort ? '74px' : '60px'} "Hiragino Sans", "Meiryo", sans-serif`;
            const titleLines = wrapText(ctx, script.title, VW - 120);
            titleLines.forEach((line, i) => {
              const y = VH * 0.52 + (i * (isShort ? 100 : 80));
              ctx.strokeStyle = 'black'; ctx.lineWidth = 15; ctx.lineJoin = 'round';
              ctx.strokeText(line, VW / 2, y);
              ctx.fillStyle = 'white'; ctx.fillText(line, VW / 2, y);
            });
          }
          ctx.restore();
          if (elapsed < INTRO_DURATION) animationRef.current = requestAnimationFrame(drawIntro); else resolve();
        };
        animationRef.current = requestAnimationFrame(drawIntro);
      });
    };

    await showIntro();

    let sceneIdx = -1;
    const playNext = () => {
      sceneIdx++;
      if (sceneIdx >= script.scenes.length) {
        const fadeTime = 2.0; const now = audioCtx.currentTime;
        if (bgmGainRef.current) {
          bgmGainRef.current.gain.cancelScheduledValues(now);
          bgmGainRef.current.gain.setValueAtTime(bgmVolume, now);
          bgmGainRef.current.gain.linearRampToValueAtTime(0, now + fadeTime);
        }
        setTimeout(() => { if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop(); }, fadeTime * 1000);
        return;
      }
      const scene = script.scenes[sceneIdx];
      const img = images[sceneIdx]; const video = videoElements[sceneIdx];
      const dur = scene.audioBuffer ? scene.audioBuffer.duration * 1000 : 5000;
      const start = performance.now();
      if (scene.audioBuffer) { 
        const s = audioCtx.createBufferSource(); s.buffer = scene.audioBuffer; s.connect(masterGain); s.start(0); 
      }
      const draw = () => {
        const elapsed = performance.now() - start; const p = Math.min(elapsed / dur, 1);
        ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, VW, VH);
        const zoom = 1.05 + Math.sin(p * Math.PI) * 0.05;
        if (video) { video.currentTime = (elapsed / 1000) % video.duration; drawImageCover(ctx, video, VW, VH, zoom); }
        else drawImageCover(ctx, img, VW, VH, zoom, false);
        const grad = ctx.createLinearGradient(0, VH * 0.7, 0, VH);
        grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.9)');
        ctx.fillStyle = grad; ctx.fillRect(0, VH * 0.7, VW, VH * 0.3);
        ctx.save(); ctx.font = `900 ${isShort ? '64px' : '52px'} "Hiragino Sans", "Meiryo", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const rawLines = wrapText(ctx, scene.displayText, VW - 120);
        const totalTextHeight = rawLines.length * LINE_HEIGHT;
        const maxScroll = Math.max(0, totalTextHeight - LINE_HEIGHT * 1.5);
        const currentScrollY = p * maxScroll;
        ctx.beginPath(); ctx.rect(0, TEXT_AREA_Y, VW, VH - TEXT_AREA_Y); ctx.clip();
        rawLines.forEach((l, i) => {
          const x = VW / 2; const y = SUBTITLE_BASE_Y - currentScrollY + (i * LINE_HEIGHT);
          if (y > VH || y < TEXT_AREA_Y - LINE_HEIGHT) return;
          ctx.strokeStyle = 'black'; ctx.lineWidth = 18; ctx.lineJoin = 'round'; ctx.strokeText(l, x, y);
          ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeText(l, x, y);
          let color = 'white';
          if (POWER_WORDS_RED.some(w => l.includes(w))) color = '#ff3333';
          else if (POWER_WORDS_YELLOW.some(w => l.includes(w))) color = '#ffff00';
          ctx.fillStyle = color; ctx.fillText(l, x, y);
        });
        ctx.restore();
        if (p < 1) animationRef.current = requestAnimationFrame(draw); else playNext();
      };
      animationRef.current = requestAnimationFrame(draw);
    };
    playNext();
  }, [isAssetsReady, images, videoElements, script, titleAudioBuffer, bgmBuffer, bgmVolume, onFinish, isShort, VW, VH, SUBTITLE_BASE_Y, LINE_HEIGHT, TEXT_AREA_Y]);

  useEffect(() => { if (isRecording && isAssetsReady) run(); }, [isRecording, isAssetsReady, run]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-black p-4">
      <div className="relative border-[10px] border-pink-600/50 rounded-[3.5rem] overflow-hidden shadow-[0_0_150px_rgba(236,72,153,0.3)] bg-[#050505]" 
           style={{ height: isShort ? '96%' : 'auto', width: isShort ? 'auto' : '96%', aspectRatio: isShort ? '9/16' : '16/9' }}>
        <canvas ref={canvasRef} width={VW} height={VH} className="w-full h-full object-contain" />
        <div className="absolute top-8 left-8 bg-red-600 px-5 py-2 rounded-full text-[10px] font-black italic animate-pulse flex items-center gap-2 shadow-lg">
          <span className="w-2.5 h-2.5 bg-white rounded-full"></span>RECORDING
        </div>
      </div>
    </div>
  );
};

export default VideoGenerator;
