// extractYouTubeId関数はutils.jsで定義

const params = new URLSearchParams(window.location.search);
const id = params.get('id');

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
    // srcが配列の場合は各画像を個別に表示、文字列の場合は単一画像を表示
    if (Array.isArray(mediaItem.src)) {
      mediaItem.src.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Project image';
        img.loading = 'lazy';
        
        // リンクがある場合は画像をリンクで囲む
        if (mediaItem.link) {
          const link = document.createElement('a');
          link.href = mediaItem.link;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.appendChild(img);
          fullContainer.appendChild(link);
        } else {
          fullContainer.appendChild(img);
        }
      });
    } else {
      const img = document.createElement('img');
      img.src = mediaItem.src;
      img.alt = 'Project image';
      img.loading = 'lazy';
      
      // リンクがある場合は画像をリンクで囲む
      if (mediaItem.link) {
        const link = document.createElement('a');
        link.href = mediaItem.link;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.appendChild(img);
        fullContainer.appendChild(link);
      } else {
        fullContainer.appendChild(img);
      }
    }
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
      
      // コンテナにアスペクト比を設定（固定16:9）
      videoWrap.style.position = 'relative';
      videoWrap.style.paddingBottom = '56.25%';
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
    // openprocessing.orgのURLを埋め込み用URLに変換
    let embedUrl = mediaItem.src;
    if (embedUrl.includes('openprocessing.org/sketch/')) {
      // https://openprocessing.org/sketch/123456 → https://openprocessing.org/sketch/123456/embed/
      if (!embedUrl.endsWith('/embed/')) {
        const sketchId = embedUrl.split('/sketch/')[1].split('/')[0];
        embedUrl = `https://openprocessing.org/sketch/${sketchId}/embed/`;
      }
    }
    
    const processingWrap = document.createElement('div');
    processingWrap.className = 'processing-wrap';
    
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    
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

  // HTMLの処理
  html: (mediaItem, fullContainer, contentContainer) => {
    const htmlWrap = document.createElement('div');
    htmlWrap.className = 'html-wrap';
    
    const iframe = document.createElement('iframe');
    iframe.src = mediaItem.src;
    iframe.frameBorder = 0;
    iframe.allowFullscreen = true;
    
    htmlWrap.appendChild(iframe);
    fullContainer.appendChild(htmlWrap);
  },

  // SoundCloudの処理
  soundcloud: (mediaItem, fullContainer, contentContainer) => {
    const soundcloudWrap = document.createElement('div');
    soundcloudWrap.className = 'soundcloud-wrap';
    
    const iframe = document.createElement('iframe');
    const src = (mediaItem.src || '').trim();
    if (/^https?:\/\//i.test(src)) {
      iframe.src = src;
    } else if (/^\d+$/.test(src)) {
      const trackUrl = `https://api.soundcloud.com/tracks/${src}`;
      iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(trackUrl)}&color=%230b0b0b&auto_play=true&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true`;
    } else {
      iframe.src = src;
    }
    iframe.frameBorder = "no";
    iframe.allow = "autoplay";
    
    soundcloudWrap.appendChild(iframe);
    
    // SoundCloudクレジットを追加
    const creditDiv = document.createElement('div');
    creditDiv.style.cssText = 'font-size: 10px; color: #cccccc;line-break: anywhere;word-break: normal;overflow: hidden;white-space: nowrap;text-overflow: ellipsis; font-family: Interstate,Lucida Grande,Lucida Sans Unicode,Lucida Sans,Garuda,Verdana,Tahoma,sans-serif;font-weight: 100;';
    creditDiv.innerHTML = '<a href="https://soundcloud.com/slvgallo" title="slvgallo" target="_blank" style="color: #cccccc; text-decoration: none;">slvgallo</a> · <a href="https://soundcloud.com/slvgallo/plr" title="PLR" target="_blank" style="color: #cccccc; text-decoration: none;">PLR</a>';
    
    soundcloudWrap.appendChild(creditDiv);
    fullContainer.appendChild(soundcloudWrap);
  },



  // 2カラム画像の処理
  image2column: (mediaItem, fullContainer, contentContainer) => {
    const image2columnWrap = document.createElement('div');
    image2columnWrap.className = 'image2column-wrap';
    
    mediaItem.src.forEach((src, index) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Project image';
      img.loading = 'lazy';
      
      // リンクがある場合は画像をリンクで囲む
      // mediaItem.linkが配列の場合と文字列の場合に対応
      if (mediaItem.link) {
        const link = document.createElement('a');
        if (Array.isArray(mediaItem.link)) {
          link.href = mediaItem.link[index] || mediaItem.link[0];
        } else {
          link.href = mediaItem.link;
        }
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.appendChild(img);
        image2columnWrap.appendChild(link);
      } else {
        image2columnWrap.appendChild(img);
      }
    });
    
    fullContainer.appendChild(image2columnWrap);
  }
};

fetch('data/works.json')
  .then(res => res.json())
  .then(async works => {
    const work = works.find(w => w.id===id);
    if(!work) return;

    document.getElementById('project-title').textContent = work.title;
    document.getElementById('page-title').textContent = `${work.id} - slvgallo`;
    
    // Open GraphとTwitterのタイトルも更新
    const ogTitle = document.getElementById('og-title');
    const twitterTitle = document.getElementById('twitter-title');
    if (ogTitle) ogTitle.content = `${work.id} - slvgallo`;
    if (twitterTitle) twitterTitle.content = `${work.id} - slvgallo`;
    
    // 改行コードを<br>に変換して表示
    const descElement = document.getElementById('project-desc');
    if (work.desc) {
      descElement.innerHTML = work.desc.replace(/\n/g, '<br>');
    } else {
      descElement.textContent = '';
    }
    
    // YouTube URLを処理
    work.media.forEach(mediaItem => {
      if (mediaItem.type === 'video' && (mediaItem.src.includes('youtube.com') || mediaItem.src.includes('youtu.be'))) {
        const videoId = extractYouTubeId(mediaItem.src);
        if (videoId) {
          // サムネイルを自動生成
          if (work.thumb && (work.thumb.includes('youtube.com') || work.thumb.includes('youtu.be'))) {
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
