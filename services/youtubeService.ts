
export interface YouTubeUploadParams {
  clientId: string;
  clientSecret: string;
  videoBlob: Blob;
  title: string;
  description: string;
  onProgress?: (msg: string) => void;
}

export const uploadToYouTube = async ({
  clientId,
  videoBlob,
  title,
  description,
  onProgress
}: YouTubeUploadParams): Promise<string> => {
  // Google OAuthは末尾のスラッシュの有無を厳密に区別するわッ！「origin + /」にするのが定石よッ！
  const cleanRedirectUri = new URL(window.location.href.replace(/^blob:/, '')).origin + '/';

  onProgress?.(`Google様にお伺いを立ててるわ...`);
  onProgress?.(`【重要】GCPコンソールの承認済みリダイレクトURIに「${cleanRedirectUri}」を登録しなさいッ！`);

  // 1. OAuth2 Authorization
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(cleanRedirectUri)}&response_type=token&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')}`;
  
  return new Promise((resolve, reject) => {
    const authWindow = window.open(authUrl, 'youtube-auth', 'width=500,height=600');
    
    const checkToken = setInterval(async () => {
      try {
        if (!authWindow || authWindow.closed) {
          clearInterval(checkToken);
          reject(new Error("認証がキャンセルされたわッ！やる気あるの？"));
          return;
        }

        const url = authWindow.location.href;
        if (url.includes('access_token=')) {
          const token = new URLSearchParams(url.split('#')[1]).get('access_token');
          authWindow.close();
          clearInterval(checkToken);

          if (!token) {
            reject(new Error("トークンが取れないわ。Google様のご機謙が悪そうね。"));
            return;
          }

          onProgress?.("認証成功！アンタの動画をYouTubeのサーバーにねじ込んでるわよッ！");

          // 2. Upload Video
          const metadata = {
            snippet: {
              title,
              description,
              categoryId: '22', // People & Blogs
            },
            status: {
              privacyStatus: 'public', // 公開！大儲けよッ！
              selfDeclaredMadeForKids: false,
            },
          };

          const formData = new FormData();
          formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
          formData.append('video', videoBlob);

          const response = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
            body: formData,
          });

          if (!response.ok) {
            const err = await response.json();
            reject(new Error(`アップロード失敗: ${err.error?.message || '不明なエラー'}`));
            return;
          }

          const result = await response.json();
          onProgress?.("アップロード完了！アンタ、ついに世界デビューよッ！");
          resolve(`https://www.youtube.com/watch?v=${result.id}`);
        }
      } catch (e) {
        // Cross-origin access error is expected until redirect happens
      }
    }, 500);
  });
};
