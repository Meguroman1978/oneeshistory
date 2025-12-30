
import { GoogleGenAI, Type, Modality, GenerateContentResponse } from "@google/genai";
import { ScriptData, Scene, ArtStyle, SuggestionResult, AspectRatio } from "../types";

const FALLBACK_SUGGESTIONS: SuggestionResult[] = [
  { name: "織田信長のイケメンすぎる遺体消失", type: "person", reason: "お姉さんが教えたげるっ！本能寺で消えた信長の遺体...実は『生きたまま』あそこに運ばれたという、歴史を覆すドロドロの闇よッ！" },
  { name: "マリー・アントワネットの隠し子が尊すぎて震える", type: "person", reason: "全人類が震えた！断頭台の王妃が最期に託した、血脈を継ぐ『名もなき少年』。泥沼すぎて草ｗな行方を追うわよ！" },
  { name: "ツタンカーメンの毒殺説がエグすぎて草ｗ", type: "person", reason: "泥沼すぎて草ｗ！若き王の頭蓋骨に残された謎の打撲痕。王権争いの犠牲になったという真実に震えなさい。" },
  { name: "坂本龍馬を売った男がヤバすぎる裏話", type: "person", reason: "誰にも言っちゃダメよッ！近江屋事件の黒幕。一番信頼していた『あの男』の裏切りが、龍馬を殺したのよ。イケメンすぎるわ..." }
];

async function withRetry<T>(
  fn: () => Promise<T>, 
  retries = 10,
  baseDelay = 8000,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw new Error("AbortError");
  try {
    return await fn();
  } catch (error: any) {
    if (signal?.aborted || error.name === 'AbortError') throw new Error("AbortError");
    
    const status = error.status || (error.message?.includes('429') ? 429 : 0);
    const isQuotaError = status === 429 || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('resource_exhausted');
    
    if (retries > 0 && isQuotaError) {
      // 1日あたりの上限(limit: 0)やRESOURCE_EXHAUSTEDの場合、プロジェクトをローテート（切り替え）するわッ！
      if (error.message?.includes('per_day') || error.message?.includes('limit: 0')) {
        console.warn("[クォータ枯渇] 1日あたりの上限に達したわよ！別のプロジェクトに切り替えなさいッ！");
        if (typeof window !== 'undefined' && (window as any).aistudio) {
          alert("このプロジェクトの1日あたりの生成上限に達したわよッ！中断したくないなら、コックピットから別のAPIキー（プロジェクト）に切り替えて再開しなさいッ！");
          await (window as any).aistudio.openSelectKey();
          // キーが新しくなったはずだから、即座にリトライよ！
          return withRetry(fn, retries, baseDelay, signal);
        }
      }

      // 通常のレート制限（1分あたり等）なら少し休憩して再挑戦よ
      const waitTime = baseDelay * (11 - retries);
      console.warn(`[API制限中] ${waitTime}ms 休憩して再挑戦するわよ... (残り: ${retries})`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return withRetry(fn, retries - 1, baseDelay, signal);
    }
    throw error;
  }
}

const stripFurigana = (text: string): string => {
  return text.replace(/[（\(][^）\)]+[）\)]/g, '');
};

async function generateWithFallback(
  primaryModel: string,
  secondaryModel: string,
  contents: any,
  config: any,
  signal?: AbortSignal
): Promise<GenerateContentResponse> {
  const callModel = async (modelName: string) => {
    return await withRetry(async () => {
      // 常に最新のAPIキーでインスタンスを生成するのがプロジェクト・ローテーションの掟よッ！
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      return await ai.models.generateContent({ model: modelName, contents, config });
    }, 3, 5000, signal);
  };

  try {
    return await callModel(primaryModel);
  } catch (e) {
    console.warn(`[フォールバック] ${primaryModel}がダメだったから${secondaryModel}で試すわよッ！`);
    return await callModel(secondaryModel);
  }
}

export const getHistoricalSuggestion = async (excludeList: string[]): Promise<SuggestionResult> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `あなたは毒舌カリスマ歴史オネエの構成作家です。
「歴史秘話ヒストリア」の放送リスト（https://ja.wikipedia.org/wiki/%E6%AD%B4%E5%8F%B2%E7%A7%98%E8%A9%B1%E3%83%92%E3%82%B9%E3%83%88%E3%83%AA%E3%82%A2）を参考に、視聴者が「泥沼すぎて草ｗ」とのけぞるような衝撃的な歴史上の人物や事件を1つ提案しなさい。
Google検索を使って、ヒストリアで扱われた面白いエピソードをヒントにして。

【重要：避けるべきテーマ】
以下のテーマは既に提案済みか、アンタの好みじゃないから絶対に避けて：${excludeList.join(', ')}

出力は必ず以下のJSON形式のみ。
{"name":"名称","type":"person"|"event","reason":"オネエ言葉での煽り文句"}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { 
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }] 
      },
    });
    const parsed = JSON.parse(response.text);
    return { ...parsed, sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(parsed.name + " 謎")}` };
  }, 3, 3000).catch(() => {
    const filtered = FALLBACK_SUGGESTIONS.filter(s => !excludeList.includes(s.name));
    const list = filtered.length > 0 ? filtered : FALLBACK_SUGGESTIONS;
    return { ...list[Math.floor(Math.random() * list.length)], sourceUrl: "#" };
  });
};

export const generateScript = async (topic: string, numScenes: number, sceneDuration: number, signal?: AbortSignal): Promise<ScriptData> => {
  const prompt = `毒舌カリスマ歴史オネエとして、最強のショート動画脚本を書いて。
題材：「${topic}」

【重要：一字一句の掟】
1. titleNarrationText（タイトル読み上げ）とtitle（画面表示用タイトル）を生成しなさい。
2. narrationText（ナレーション）とdisplayText（字幕）は完全に同じ内容に。
3. ナレーション系(titleNarrationText, narrationText)には全漢字に（ふりがな）を付ける。
4. 字幕系(title, displayText)にはふりがなを付けない。
5. 文字量は各シーン ${sceneDuration} 秒。
6. 全 ${numScenes} シーン。`;

  const config = {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        titleNarrationText: { type: Type.STRING },
        topicName: { type: Type.STRING },
        description: { type: Type.STRING },
        scenes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              imagePrompt: { type: Type.STRING },
              narrationText: { type: Type.STRING },
              displayText: { type: Type.STRING },
            },
            required: ["imagePrompt", "narrationText", "displayText"]
          }
        }
      },
      required: ["title", "titleNarrationText", "topicName", "description", "scenes"]
    }
  };

  const response = await generateWithFallback('gemini-3-flash-preview', 'gemini-3-pro-preview', prompt, config, signal);
  const data: ScriptData = JSON.parse(response.text);
  
  // 画面表示用からはふりがなを剥ぎ取るわッ！
  data.title = stripFurigana(data.title);
  data.scenes = data.scenes.map(s => ({ ...s, displayText: stripFurigana(s.displayText) }));
  
  return data;
};

export const generateSceneAudio = async (text: string, audioCtx: AudioContext, signal?: AbortSignal): Promise<AudioBuffer> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `艶やかで迫力のあるオネエ言葉で語りなさい。声は【絶対に】野太い男の声(Fenrir)で固定し、女性のような高い声は禁止よ。：${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("音声生成失敗");
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const dataInt16 = new Int16Array(bytes.buffer.slice(0, bytes.length - (bytes.length % 2)));
    const buffer = audioCtx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  }, 5, 5000, signal);
};

export const generateSceneImage = async (prompt: string, style: ArtStyle, aspectRatio: AspectRatio, signal?: AbortSignal): Promise<string> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: `${style} style. ${prompt}. High quality.` }] },
      config: { imageConfig: { aspectRatio } }
    });
    const imgPart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    if (!imgPart?.inlineData) throw new Error("画像生成失敗");
    return `data:image/png;base64,${imgPart.inlineData.data}`;
  }, 5, 10000, signal);
};

export const generateSceneVideo = async (prompt: string, aspectRatio: AspectRatio, onProgress: (msg: string) => void): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  onProgress("歴史が動き出したわ...");
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: `Cinematic historical scene. ${prompt}`,
    config: { numberOfVideos: 1, resolution: '720p', aspectRatio }
  });
  while (!operation.done) {
    onProgress("AIが美を調整中よ...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation });
  }
  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
