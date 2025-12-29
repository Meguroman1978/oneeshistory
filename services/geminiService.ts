
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptData, Scene, ArtStyle } from "../types";

/**
 * Utility function to handle API retries with exponential backoff.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 5, delay = 10000, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error("AbortError");
  
  try {
    return await fn();
  } catch (error: any) {
    if (signal?.aborted || error.name === 'AbortError') throw new Error("AbortError");

    const errorMessage = error.message || "";
    const isRateLimit = 
      errorMessage.includes('429') || 
      error.status === 429 || 
      errorMessage.toLowerCase().includes('resource_exhausted') ||
      errorMessage.toLowerCase().includes('quota') ||
      errorMessage.includes('limit: 0');

    if (retries > 0 && isRateLimit) {
      console.warn(`制限に達しました。リトライします... (${retries}回目)`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error("AbortError"));
        });
      });
      return withRetry(fn, retries - 1, delay * 1.5, signal);
    }
    throw error;
  }
}

export const generateScript = async (topic: string, numScenes: number, signal?: AbortSignal): Promise<ScriptData> => {
  return withRetry(async () => {
    // APIコール直前にインスタンス化して最新のAPIキーを使用
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: `あなたは歴史界の裏側を知り尽くした、野太い声のカリスマドラァグクイーン（オネエ）です。テーマは「${topic}」です。
      
      【脚本のスタイル】
      - 「ちょっとあんたたち！」「おだまり！」「〜なのよッ！」といった、インパクトのあるオネエ言葉で書いてください。
      - 【重要】YouTubeで禁止されている暴力ワード（死ぬ、殺す、死体、暗殺、処刑など）は絶対に使わないで。
      - 歴史上どうしても避けられない場合は、必ず文字として「[ピー]」と書いてください。
      - 1シーンのセリフは20〜30文字程度。合計 ${numScenes} シーン。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            topicName: { type: Type.STRING },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  imagePrompt: { type: Type.STRING },
                  narrationText: { type: Type.STRING },
                },
                required: ["imagePrompt", "narrationText"]
              }
            }
          },
          required: ["title", "topicName", "scenes"]
        }
      }
    });

    if (!response.text) throw new Error("Empty script response");
    return JSON.parse(response.text);
  }, 5, 10000, signal);
};

export const generateSceneImage = async (prompt: string, style: ArtStyle, signal?: AbortSignal): Promise<string> => {
  return withRetry(async () => {
    // APIコール直前にインスタンス化
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    const stylePrompt = style === 'manga' 
      ? "Epic Japanese Manga art style, dramatic shadows, high contrast" 
      : "Ultra-realistic historical cinematic shot, 8k, Rembrandt lighting";

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `${stylePrompt}. ${prompt}. 9:16 aspect ratio.` }]
      },
      config: {
        imageConfig: { aspectRatio: "9:16" }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("No image generated");
  }, 5, 10000, signal);
};

export const generateSceneAudio = async (text: string, audioCtx: AudioContext, signal?: AbortSignal): Promise<AudioBuffer> => {
  return withRetry(async () => {
    // APIコール直前にインスタンス化
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `野太くドスの効いたカリスマオネエ風に。[ピー]という言葉が出てきたら、そこだけ少し間をあけて読んで: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio generated");

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    const alignedLen = bytes.length - (bytes.length % 2);
    const dataInt16 = new Int16Array(bytes.buffer.slice(0, alignedLen));
    const buffer = audioCtx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    
    return buffer;
  }, 5, 10000, signal);
};
