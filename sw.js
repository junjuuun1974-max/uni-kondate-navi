/**
 * sw.js - Uni献立ナビ Service Worker
 *
 * キャッシュ戦略:
 * - アプリシェル (HTML/CSS/JS): Cache First
 * - 画像リソース:               Cache First (CDN画像をキャッシュ)
 * - APIリクエスト:              Network First → Cache Fallback
 *
 * FUTURE: 本番では以下を追加
 * - Background Sync: オフライン中の操作ログをオンライン復帰時に送信
 * - Push Notification: 当日メニュー更新通知
 * - Periodic Background Sync: 毎朝6時に自動同期
 */

var CACHE_VERSION = 'v1';
var CACHE_NAME = 'uni-kondate-navi-' + CACHE_VERSION;

/* キャッシュするアプリシェル */
var PRECACHE_URLS = [
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json'
  /* FUTURE: アイコンファイルを追加
  './icons/icon-192.png',
  './icons/icon-512.png'
  */
];

/* ============================================================
   インストール: アプリシェルをプリキャッシュ
   ============================================================ */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .then(function() {
        return self.skipWaiting();
      })
      .catch(function(err) {
        console.warn('[SW] Precache failed:', err);
      })
  );
});

/* ============================================================
   アクティベート: 古いキャッシュを削除
   ============================================================ */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function(name) {
              return name.startsWith('uni-kondate-navi-') && name !== CACHE_NAME;
            })
            .map(function(name) {
              return caches.delete(name);
            })
        );
      })
      .then(function() {
        return self.clients.claim();
      })
  );
});

/* ============================================================
   フェッチ: リクエスト種別に応じたキャッシュ戦略
   ============================================================ */
self.addEventListener('fetch', function(event) {
  var request = event.request;

  /* GETリクエスト以外はスキップ */
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  /* 外部オリジン (Google Fonts など) はネットワーク優先 */
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(function() {
          return caches.match(request);
        })
    );
    return;
  }

  /* FUTURE: APIリクエスト → Network First, Cache Fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  */

  /* 画像リクエスト → Cache First, Network Fallback */
  if (/\.(jpg|jpeg|png|webp|gif|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  /* アプリシェル (HTML / CSS / JS) → Cache First */
  event.respondWith(cacheFirstStrategy(request));
});

/* ---- Cache First 戦略 ---- */
function cacheFirstStrategy(request) {
  return caches.match(request)
    .then(function(cached) {
      if (cached) return cached;
      return fetch(request)
        .then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(function() {
          /* オフラインかつキャッシュなし → index.html にフォールバック */
          if (request.headers.get('accept') && request.headers.get('accept').indexOf('text/html') !== -1) {
            return caches.match('./index.html');
          }
        });
    });
}

/* ---- Network First 戦略 (API用) ---- */
function networkFirstStrategy(request) {
  return fetch(request)
    .then(function(response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, clone);
        });
      }
      return response;
    })
    .catch(function() {
      return caches.match(request);
    });
}
