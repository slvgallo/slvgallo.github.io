const params = new URLSearchParams(window.location.search);
const id = params.get('id');

// YouTube IDを抽出する関数
function extractYouTubeId(url) {
  const patterns = [
    // 通常のYouTube動画
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/vi\/)([^&\n?#]+)/,
    // YouTube Shorts
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// IDから日付を自動生成する関数
function generateDateFromId(id) {
  if (id.length >= 4) {
    const yearMonth = id.substring(0, 4);
    const year = yearMonth.substring(0, 2);
    const month = yearMonth.substring(2, 4);
    
    // 年を2000年代に変換
    const fullYear = `20${year}`;
    
    // 月を英語に変換
    const monthNames = {
      '01': 'JAN', '02': 'FEB', '03': 'MAR', '04': 'APR',
      '05': 'MAY', '06': 'JUNE', '07': 'JULY', '08': 'AUG',
      '09': 'SEPT', '10': 'OCT', '11': 'NOV', '12': 'DEC'
    };
    
    const monthName = monthNames[month] || month;
    return `${monthName} ${fullYear}`;
  }
  return id; // フォーマットが違う場合はそのまま返す
}

// YouTube動画のアスペクト比を取得する関数
async function getYouTubeAspectRatio(videoId) {
  try {
    const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await response.json();
    
    if (data.width && data.height) {
      return {
        width: data.width,
        height: data.height,
        ratio: data.width / data.height
      };
    }
  } catch (error) {
    console.log('アスペクト比取得エラー:', error);
  }
  
  // デフォルトアスペクト比（16:9）
  return {
    width: 16,
    height: 9,
    ratio: 16/9
  };
}

// メディアタイプごとのハンドラーを定義
const mediaHandlers = {
  // 画像の処理
  image: (mediaItem, fullContainer, contentContainer) => {
    const img = document.createElement('img');
    img.src = mediaItem.src;
    img.alt = 'Project image';
    img.loading = 'lazy';
    fullContainer.appendChild(img);
  },
  
  // 動画の処理
  video: async (mediaItem, fullContainer, contentContainer) => {
    const videoWrap = document.createElement('div');
    videoWrap.className = 'video-wrap';
    
    const iframe = document.createElement('iframe');
    
    // YouTube URLからIDを抽出
    const videoId = extractYouTubeId(mediaItem.src);
    if (videoId) {
      // アスペクト比を取得
      const aspectRatio = await getYouTubeAspectRatio(videoId);
      
      // 埋め込みURLを設定
      iframe.src = `https://www.youtube.com/embed/${videoId}`;
      
      // アスペクト比に基づいてスタイルを設定
      iframe.style.position = 'absolute';
      iframe.style.top = '0';
      iframe.style.left = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      
      // コンテナにアスペクト比を設定
      videoWrap.style.position = 'relative';
      videoWrap.style.paddingBottom = `${(1 / aspectRatio.ratio) * 100}%`;
      videoWrap.style.height = '0';
      videoWrap.style.overflow = 'hidden';
    } else {
      iframe.src = mediaItem.src;
    }
    
    iframe.frameBorder = 0;
    iframe.allowFullscreen = true;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    
    videoWrap.appendChild(iframe);
    fullContainer.appendChild(videoWrap);
  },

  // Processingの処理
  processing: (mediaItem, fullContainer, contentContainer) => {
    console.log('Processing URL:', mediaItem.src);
    const processingWrap = document.createElement('div');
    processingWrap.className = 'processing-wrap';
    
    const iframe = document.createElement('iframe');
    iframe.src = mediaItem.src;
    console.log('iframe.src set to:', iframe.src);
    iframe.frameBorder = 0;
    iframe.allowFullscreen = true;
    
    processingWrap.appendChild(iframe);
    fullContainer.appendChild(processingWrap);
  },

  // Sketchfabの処理
  sketchfab: (mediaItem, fullContainer, contentContainer) => {
    const sketchfabWrap = document.createElement('div');
    sketchfabWrap.className = 'sketchfab-wrap';
    
    const iframe = document.createElement('iframe');
    iframe.src = mediaItem.src;
    iframe.frameBorder = 0;
    iframe.allowFullscreen = true;
    iframe.allow = "autoplay; fullscreen; vr";
    
    sketchfabWrap.appendChild(iframe);
    fullContainer.appendChild(sketchfabWrap);
  },

  // SoundCloudの処理
  soundcloud: (mediaItem, fullContainer, contentContainer) => {
    const soundcloudWrap = document.createElement('div');
    soundcloudWrap.className = 'soundcloud-wrap';
    
    const iframe = document.createElement('iframe');
    iframe.src = mediaItem.src;
    iframe.frameBorder = 0;
    iframe.allow = "autoplay";
    
    soundcloudWrap.appendChild(iframe);
    fullContainer.appendChild(soundcloudWrap);
  },

  // Flickrの処理
  flickr: (mediaItem, fullContainer, contentContainer) => {
    const img = document.createElement('img');
    img.src = mediaItem.src;
    img.alt = 'Flickr image';
    img.loading = 'lazy';
    img.style.cursor = 'pointer';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    
    // 画像読み込み後に縦横比をチェック
    img.addEventListener('load', () => {
      const aspectRatio = img.naturalHeight / img.naturalWidth;
      if (aspectRatio > 1.2) { // 縦長の場合
        img.style.maxHeight = '1024px';
        img.style.objectFit = 'contain';
        
        // 親コンテナに左寄せクラスを追加
        const wrapper = document.createElement('div');
        wrapper.style.textAlign = 'left';
        wrapper.style.display = 'inline-block';
        
        // 画像をwrapperに移動
        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);
      }
    });
    
    // Flickr画像クリックで元ページに飛ぶ
    img.addEventListener('click', () => {
      // Flickrの写真IDを抽出してURLを生成
      const flickrMatch = mediaItem.src.match(/\/(\d+)_[a-f0-9]{10}_b\.jpg$/);
      if (flickrMatch) {
        const photoId = flickrMatch[1];
        window.open(`https://www.flickr.com/photos/slvgallo/${photoId}`, '_blank');
      }
    });
    
    fullContainer.appendChild(img);
  }
};

fetch('data/works.json')
  .then(res => res.json())
  .then(async works => {
    const work = works.find(w => w.id===id);
    if(!work) return;

    document.getElementById('project-title').textContent = work.title;
    document.getElementById('page-title').textContent = work.title;
    
    // 改行コードを<br>に変換して表示
    const descElement = document.getElementById('project-desc');
    if (work.desc) {
      descElement.innerHTML = work.desc.replace(/\n/g, '<br>');
    } else {
      descElement.textContent = '';
    }
    
    // YouTube URLを処理
    work.media.forEach(mediaItem => {
      if (mediaItem.type === 'video' && mediaItem.src.includes('youtube.com')) {
        const videoId = extractYouTubeId(mediaItem.src);
        if (videoId) {
          // サムネイルを自動生成
          if (work.thumb && work.thumb.includes('youtube.com')) {
            work.thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
          }
          // 埋め込みコードを自動生成
          mediaItem.src = `https://www.youtube.com/embed/${videoId}`;
        }
      }
    });
    
    // 日付とタグを表示
    const autoDate = generateDateFromId(work.id);
    document.getElementById('project-date').textContent = autoDate;
    
    const tagsContainer = document.getElementById('project-tags');
    tagsContainer.innerHTML = '';
    
    // セパレーターを追加
    const separator = document.createElement('span');
    separator.className = 'project-separator';
    separator.textContent = ' | ';
    tagsContainer.appendChild(separator);
    
    work.tags.forEach(tag => {
      const tagElement = document.createElement('a');
      tagElement.href = `index.html?filter=${tag}`;
      tagElement.className = 'project-tag';
      tagElement.textContent = `#${tag}`;
      tagsContainer.appendChild(tagElement);
    });

    const fullMediaContainer = document.getElementById('project-media-full');
    const contentMediaContainer = document.getElementById('project-media');
    
    // 新しいメディア配列構造に対応
    if (Array.isArray(work.media)) {
      // 配列形式：交互表示
      for (const mediaItem of work.media) {
        const handler = mediaHandlers[mediaItem.type];
        if (handler) {
          await handler(mediaItem, fullMediaContainer, contentMediaContainer);
        }
      }
    } else {
      // 従来のオブジェクト形式（後方互換性）
      Object.keys(work.media).forEach(key => {
        const value = work.media[key];
        if (key === 'images' && Array.isArray(value)) {
          value.forEach(src => {
            mediaHandlers.image({type: 'image', src: src}, fullMediaContainer, contentMediaContainer);
          });
        } else if (key === 'videos' && Array.isArray(value)) {
          value.forEach(src => {
            mediaHandlers.video({type: 'video', src: src}, fullMediaContainer, contentMediaContainer);
          });
        }
      });
    }
  });
