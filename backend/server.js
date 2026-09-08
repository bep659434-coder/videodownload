const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ytdlp = require('youtube-dl-exec');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '10mb' }));

const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';


// ============================================================
// HOME
// ============================================================

app.get('/', (req, res) => {
  res.json({
    status: 'Video Download Hub v9',
    server: 'online',
    youtube: 'enabled',
    platforms: [
      'youtube',
      'instagram',
      'facebook',
      'tiktok'
    ]
  });
});


// ============================================================
// HEALTH
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '9.0.0'
  });
});


// ============================================================
// YOUTUBE ID
// ============================================================

function getYtId(url) {

  try {

    const u = new URL(url);

    const host = u.hostname
      .replace(/^www\./, '')
      .toLowerCase();

    // youtu.be/VIDEO_ID
    if (host === 'youtu.be') {

      return u.pathname
        .split('/')
        .filter(Boolean)[0] || null;

    }

    // youtube.com
    if (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com')
    ) {

      // youtube.com/watch?v=VIDEO_ID
      if (u.pathname === '/watch') {

        return u.searchParams.get('v');

      }

      const parts = u.pathname
        .split('/')
        .filter(Boolean);

      // youtube.com/shorts/VIDEO_ID
      // youtube.com/embed/VIDEO_ID
      // youtube.com/live/VIDEO_ID

      if (
        parts[0] === 'shorts' ||
        parts[0] === 'embed' ||
        parts[0] === 'live'
      ) {

        return parts[1] || null;

      }

    }

  } catch (e) {}

  return null;
}


// ============================================================
// SAFE FILE NAME
// ============================================================

function safeFileName(name) {

  return String(name || 'video')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 100);

}


// ============================================================
// QUALITY
// ============================================================

function getQuality(quality) {

  const q = String(quality || '1080')
    .toLowerCase();

  if (q === 'best') {
    return 2160;
  }

  if (
    q === '4k' ||
    q === '2160'
  ) {
    return 2160;
  }

  if (
    q === 'mp3' ||
    q.includes('320')
  ) {
    return 320;
  }

  const number = parseInt(q, 10);

  if (Number.isFinite(number)) {
    return number;
  }

  return 1080;
}


// ============================================================
// COBALT
// ============================================================

async function getCobaltDirect(url, quality) {

  const q = getQuality(quality);

  const apis = [
    'https://api.cobalt.tools',
    'https://co.wuk.sh'
  ];

  for (const api of apis) {

    try {

      console.log(`[COBALT] Trying ${api}`);

      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, 12000);

      const response = await fetch(
        `${api}/api/json`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': USER_AGENT
          },

          body: JSON.stringify({
            url: url,
            vQuality: String(q),
            filenamePattern: 'basic',
            isAudioOnly: false
          }),

          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        continue;
      }

      const data = await response.json();

      if (data && data.url) {

        console.log(
          `[COBALT SUCCESS] ${api}`
        );

        return data.url;
      }

    } catch (error) {

      console.log(
        `[COBALT ERROR] ${api}: ${error.message}`
      );

    }

  }

  return null;
}


// ============================================================
// PIPED
// ============================================================

async function getPipedDirect(videoId, quality) {

  const instances = [

    'https://pipedapi.kavin.rocks',

    'https://api.piped.private.coffee',

    'https://pipedapi.moomoo.me',

    'https://pipedapi.adminforge.de'

  ];

  const requestedQuality =
    getQuality(quality);

  for (const base of instances) {

    try {

      console.log(
        `[PIPED] Trying ${base}`
      );

      const controller =
        new AbortController();

      const timeout =
        setTimeout(() => {
          controller.abort();
        }, 10000);

      const response =
        await fetch(
          `${base}/streams/${encodeURIComponent(videoId)}`,
          {
            headers: {
              'User-Agent': USER_AGENT,
              'Accept': 'application/json'
            },
            signal: controller.signal
          }
        );

      clearTimeout(timeout);

      if (!response.ok) {
        continue;
      }

      const data =
        await response.json();

      if (!Array.isArray(data.videoStreams)) {
        continue;
      }

      let streams =
        data.videoStreams.filter(
          stream =>
            stream.url &&
            String(stream.mimeType || '')
              .includes('video/mp4')
        );

      if (!streams.length) {

        streams =
          data.videoStreams.filter(
            stream => stream.url
          );

      }

      streams =
        streams.filter(
          stream =>
            Number(stream.height) > 0
        );

      if (!streams.length) {
        continue;
      }

      streams.sort(
        (a, b) =>
          Number(b.height) -
          Number(a.height)
      );

      let selected =
        streams.find(
          stream =>
            Number(stream.height) ===
            requestedQuality
        );

      if (!selected) {

        selected =
          streams.find(
            stream =>
              Number(stream.height) <=
              requestedQuality
          );

      }

      if (!selected) {
        selected = streams[0];
      }

      if (selected && selected.url) {

        console.log(
          `[PIPED SUCCESS] ${base} - ${
            selected.quality ||
            selected.height
          }`
        );

        return selected.url;
      }

    } catch (error) {

      console.log(
        `[PIPED ERROR] ${base}: ${error.message}`
      );

    }

  }

  return null;
}


// ============================================================
// YT-DLP YOUTUBE EXTRACTOR
// ============================================================

async function getYtDlpDirect(
  url,
  quality
) {

  const q =
    getQuality(quality);

  let format;

  if (q >= 2160) {

    format =
      'bestvideo[height<=2160]+bestaudio/' +
      'best[height<=2160]/best';

  } else {

    format =
      `bestvideo[height<=${q}]+bestaudio/` +
      `best[height<=${q}]/best`;

  }


  // Try several YouTube clients.
  // Some current YouTube clients have different
  // PO-token requirements.

  const clientOptions = [

    'web_embedded',

    'tv',

    'android_vr',

    'mweb',

    'web_safari'

  ];


  for (const client of clientOptions) {

    try {

      console.log(
        `[YT-DLP] Trying client: ${client}`
      );

      const result =
        await ytdlp(url, {

          noPlaylist: true,

          noWarnings: true,

          skipDownload: true,

          getUrl: true,

          format: format,

          userAgent: USER_AGENT,

          extractorArgs:
            `youtube:player_client=${client}`

        });


      const output =
        String(result || '')
          .split(/\r?\n/)
          .map(x => x.trim())
          .filter(Boolean);


      if (output.length > 0) {

        console.log(
          `[YT-DLP SUCCESS] client=${client}`
        );

        return output[0];

      }

    } catch (error) {

      console.log(
        `[YT-DLP FAIL] client=${client}`
      );

      console.log(
        String(error.message || error)
          .slice(0, 500)
      );

    }

  }

  return null;
}


// ============================================================
// YOUTUBE DIRECT ENGINE
// ============================================================

async function getYouTubeDirect(
  url,
  quality
) {

  // 1. Cobalt
  let direct =
    await getCobaltDirect(
      url,
      quality
    );

  if (direct) {
    return direct;
  }


  // 2. Piped
  const videoId =
    getYtId(url);

  if (videoId) {

    direct =
      await getPipedDirect(
        videoId,
        quality
      );

    if (direct) {
      return direct;
    }

  }


  // 3. Local yt-dlp
  direct =
    await getYtDlpDirect(
      url,
      quality
    );

  return direct;
}


// ============================================================
// INFO
// ============================================================

app.post(
  '/api/info',
  async (req, res) => {

    const url =
      String(
        req.body?.url || ''
      ).trim();


    if (!url) {

      return res
        .status(400)
        .json({
          error: 'URL required'
        });

    }


    const videoId =
      getYtId(url);


    try {

      const info =
        await ytdlp(url, {

          noPlaylist: true,

          noWarnings: true,

          dumpSingleJson: true,

          skipDownload: true,

          userAgent: USER_AGENT

        });


      return res.json({

        title:
          info.title ||
          (videoId
            ? 'YouTube Video'
            : 'Video'),

        thumbnail:
          info.thumbnail ||
          (
            videoId
              ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
              : ''
          ),

        uploader:
          info.uploader ||
          (videoId
            ? 'YouTube'
            : ''),

        duration:
          info.duration || 0,

        platform:
          videoId
            ? 'youtube'
            : (
              info.extractorKey ||
              ''
            ),

        videoId:
          videoId || undefined

      });

    } catch (error) {

      console.log(
        `[INFO ERROR] ${error.message}`
      );


      // Keep frontend working even if
      // YouTube metadata extraction fails.

      if (videoId) {

        return res.json({

          title:
            'YouTube Video',

          thumbnail:
            `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,

          uploader:
            'YouTube',

          platform:
            'youtube',

          videoId:
            videoId

        });

      }


      return res.json({

        title: 'Video',

        thumbnail: ''

      });

    }

  }
);


// ============================================================
// GET INFO
// ============================================================

app.get(
  '/api/info',
  async (req, res) => {

    req.body = {
      url: req.query.url
    };

    return app._router.handle(
      req,
      res
    );

  }
);


// ============================================================
// DIRECT ENDPOINT
// ============================================================

app.get(
  '/api/direct',
  async (req, res) => {

    const url =
      String(
        req.query.url || ''
      ).trim();

    const quality =
      String(
        req.query.quality || '1080'
      ).trim();


    if (!url) {

      return res
        .status(400)
        .json({
          error: 'URL required'
        });

    }


    const videoId =
      getYtId(url);


    if (!videoId) {

      return res
        .status(400)
        .json({
          error:
            'Direct endpoint supports YouTube URLs.'
        });

    }


    console.log(
      `[DIRECT] YouTube ${videoId} quality=${quality}`
    );


    const directUrl =
      await getYouTubeDirect(
        url,
        quality
      );


    if (!directUrl) {

      return res
        .status(503)
        .json({

          error:
            'YouTube extraction is temporarily unavailable. Try 720p or try again shortly.',

          code:
            'YOUTUBE_EXTRACTION_FAILED'

        });

    }


    return res.json({

      downloadUrl:
        directUrl,

      filename:
        `YT_${videoId}_${safeFileName(quality)}.mp4`,

      direct:
        true

    });

  }
);


// ============================================================
// MAIN DOWNLOAD
// ============================================================

app.get(
  '/api/download',
  async (req, res) => {

    const url =
      String(
        req.query.url || ''
      ).trim();

    const quality =
      String(
        req.query.quality || '1080'
      ).trim();


    if (!url) {

      return res
        .status(400)
        .json({
          error: 'URL required'
        });

    }


    const videoId =
      getYtId(url);


    console.log(
      `[REQUEST] ${url.slice(0, 100)} | quality=${quality} | youtube=${!!videoId}`
    );


    // ========================================================
    // YOUTUBE
    // ========================================================

    if (videoId) {

      const directUrl =
        await getYouTubeDirect(
          url,
          quality
        );


      if (!directUrl) {

        return res
          .status(503)
          .json({

            error:
              'YouTube extraction is temporarily unavailable. Try 720p or try again shortly.',

            code:
              'YOUTUBE_EXTRACTION_FAILED'

          });

      }


      // Try server proxy first
      try {

        const controller =
          new AbortController();

        const timeout =
          setTimeout(() => {
            controller.abort();
          }, 30000);


        const response =
          await fetch(
            directUrl,
            {
              headers: {
                'User-Agent':
                  USER_AGENT
              },
              signal:
                controller.signal
            }
          );


        clearTimeout(timeout);


        if (!response.ok) {

          throw new Error(
            `YouTube CDN HTTP ${response.status}`
          );

        }


        const buffer =
          Buffer.from(
            await response.arrayBuffer()
          );


        if (buffer.length < 5000) {

          throw new Error(
            'Downloaded file is too small'
          );

        }


        res.setHeader(
          'Content-Type',
          'video/mp4'
        );


        res.setHeader(
          'Content-Disposition',
          `attachment; filename="YT_${videoId}_${safeFileName(quality)}.mp4"`
        );


        res.setHeader(
          'Access-Control-Allow-Origin',
          '*'
        );


        console.log(
          `[YOUTUBE FILE] ${buffer.length} bytes`
        );


        return res.send(
          buffer
        );


      } catch (error) {

        console.log(
          `[YOUTUBE PROXY FALLBACK] ${error.message}`
        );


        // Return direct CDN URL.
        // Frontend can open/download it.

        return res.json({

          downloadUrl:
            directUrl,

          filename:
            `YT_${videoId}_${safeFileName(quality)}.mp4`,

          direct:
            true

        });

      }

    }


    // ========================================================
    // INSTAGRAM / FACEBOOK / TIKTOK
    // ========================================================

    const id =
      crypto.randomBytes(8)
        .toString('hex');


    const output =
      path.join(
        TEMP_DIR,
        `${id}.%(ext)s`
      );


    try {

      await ytdlp(
        url,
        {

          noPlaylist: true,

          noWarnings: true,

          format: 'best',

          output: output,

          mergeOutputFormat: 'mp4',

          userAgent:
            USER_AGENT

        },
        {
          timeout: 120000
        }
      );


      const files =
        fs.readdirSync(
          TEMP_DIR
        ).filter(
          file =>
            file.startsWith(id)
        );


      if (!files.length) {

        return res
          .status(500)
          .json({
            error:
              'Download failed'
          });

      }


      const file =
        path.join(
          TEMP_DIR,
          files[0]
        );


      return res.download(
        file,
        `video_${Date.now()}.mp4`,
        () => {

          try {

            fs.unlinkSync(
              file
            );

          } catch {}

        }
      );


    } catch (error) {

      console.log(
        `[OTHER PLATFORM ERROR] ${error.message}`
      );


      return res
        .status(500)
        .json({

          error:
            'Download failed'

        });

    }

  }
);


// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      `Video Download Hub v9 running on port ${PORT}`
    );

  }
);
