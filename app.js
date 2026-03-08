/**
 * app.js - Uni献立ナビ v4
 *
 * v4 変更点:
 * - 工程全体像画面を追加（調理開始前に全工程を確認）
 * - 調理中・タイマー中にホームボタンを追加
 * - タイマー終了時に音を鳴らす（Web Audio API）
 */

'use strict';

/* ============================================================
   Supabase 設定
   ============================================================ */
var SUPABASE_URL = '';
var SUPABASE_KEY = '';

function loadSupabaseConfig() {
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';
}

async function sbFetch(table, params) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?' + (params || 'select=*');
  var res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    }
  });
  if (!res.ok) throw new Error('API error: ' + res.status);
  return res.json();
}

/* ============================================================
   曜日 & 日付ユーティリティ
   ============================================================ */
var WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

function formatDateJa(date) {
  var m = date.getMonth() + 1;
  var d = date.getDate();
  var w = WEEKDAYS_JA[date.getDay()];
  return m + '月' + d + '日（' + w + '）';
}

function getTodayISO() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/* ============================================================
   食事時間帯マッピング
   ============================================================ */
var MEAL_TIME_LABELS = {
  morning: { ja: '朝食', en: 'MORNING', icon: '🌅' },
  lunch:   { ja: '昼食', en: 'LUNCH',   icon: '☀️' },
  dinner:  { ja: '夕食', en: 'DINNER',  icon: '🌙' },
  snack:   { ja: 'おやつ', en: 'SNACK', icon: '🍵' }
};

/* ============================================================
   作業種別アイコンマップ
   ============================================================ */
var STEP_TYPE_ICONS = {
  cut:       '🔪',
  fry:       '🍳',
  mix:       '🥄',
  boil:      '♨️',
  simmer:    '🫕',
  bake:      '🔥',
  steam_con: '🌡️',
  steam:     '💨',
  plate:     '🍽️',
  season:    '🧂',
  cool:      '❄️',
  wash:      '💧',
  prep:      '👐',
  ccp_temp:  '🌡️',
  default:   '👨‍🍳'
};

function getStepIcon(step) {
  if (step.step_type && STEP_TYPE_ICONS[step.step_type]) return STEP_TYPE_ICONS[step.step_type];
  if (step.steam_con) return STEP_TYPE_ICONS['steam_con'];
  var d = (step.description || '') + ' ' + (step.description_en || '');
  if (/切る|切り|刻む|カット|cut|chop|dice/i.test(d))         return STEP_TYPE_ICONS['cut'];
  if (/炒める|炒め|揚げ|saute|stir.?fry|fry/i.test(d))       return STEP_TYPE_ICONS['fry'];
  if (/混ぜ|こね|捏ね|合わせ|mix|knead/i.test(d))             return STEP_TYPE_ICONS['mix'];
  if (/スチコン|コンベクション|convection/i.test(d))           return STEP_TYPE_ICONS['steam_con'];
  if (/煮込む|simmer/i.test(d))                               return STEP_TYPE_ICONS['simmer'];
  if (/茹でる|下茹で|ゆで|boil/i.test(d))                     return STEP_TYPE_ICONS['boil'];
  if (/焼く|焼き|グリル|bake|grill/i.test(d))                 return STEP_TYPE_ICONS['bake'];
  if (/蒸す|蒸し|steam/i.test(d))                             return STEP_TYPE_ICONS['steam'];
  if (/盛り付け|plate|serve/i.test(d))                        return STEP_TYPE_ICONS['plate'];
  if (/塩|醤油|みそ|調味|season/i.test(d))                    return STEP_TYPE_ICONS['season'];
  if (/冷ます|冷却|cool/i.test(d))                            return STEP_TYPE_ICONS['cool'];
  return STEP_TYPE_ICONS['default'];
}

/* ============================================================
   アプリ状態
   ============================================================ */
var MENUS = [];

var state = {
  currentScreen:    'home',
  screenHistory:    [],
  selectedMenu:     null,
  currentServings:  10,
  currentStepIndex: 0,
  selectedMealTime: null,
  filterCuisine:    'all',
  filterCategory:   'all',
  timerInterval:    null,
  timerRemaining:   0,
  timerTotal:       0
};

var RING_CIRC = 2 * Math.PI * 110;

/* ============================================================
   PWA: Service Worker 登録
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('./sw.js')
      .then(function(reg)  { console.log('[SW] Registered:', reg.scope); })
      .catch(function(err) { console.warn('[SW] Registration failed:', err); });
  });
}

/* ============================================================
   タイマー音（Web Audio API）― 目覚ましアラーム型・ループ継続
   ============================================================ */
var _alarmCtx          = null;
var _alarmLoopInterval = null;

function playAlarmSound() {
  stopAlarmSound(); /* 二重起動防止 */
  try {
    _alarmCtx = new (window.AudioContext || window.webkitAudioContext)();

    /* 1回分のビープ: square波×2音 で厨房でも届く音圧 */
    function beepOnce() {
      if (!_alarmCtx) return;
      var now = _alarmCtx.currentTime;

      /* 低音ビープ（880Hz）*/
      [880, 1320].forEach(function(freq, i) {
        var osc  = _alarmCtx.createOscillator();
        var gain = _alarmCtx.createGain();
        osc.connect(gain);
        gain.connect(_alarmCtx.destination);
        osc.type = 'square';                    /* square波は倍音豊かで遠くまで通る */
        osc.frequency.value = freq;
        var t0 = now + i * 0.22;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(1.0, t0 + 0.02); /* 急速立ち上がり */
        gain.gain.setValueAtTime(1.0, t0 + 0.18);
        gain.gain.linearRampToValueAtTime(0,   t0 + 0.22);
        osc.start(t0);
        osc.stop(t0 + 0.23);
      });
    }

    beepOnce();
    /* 800ms ごとに繰り返す → 止めるまで鳴り続ける */
    _alarmLoopInterval = setInterval(beepOnce, 800);

  } catch(e) {
    console.warn('[Uni] Audio error:', e);
  }
}

function stopAlarmSound() {
  if (_alarmLoopInterval) { clearInterval(_alarmLoopInterval); _alarmLoopInterval = null; }
  if (_alarmCtx) {
    try { _alarmCtx.close(); } catch(e) {}
    _alarmCtx = null;
  }
}

/* ============================================================
   Supabase からメニュー一覧を取得
   ============================================================ */
async function fetchAllMenus() {
  var rows = await sbFetch('menus', 'select=*&order=id');
  var today = getTodayISO();
  MENUS = rows.map(function(m) {
    return Object.assign({}, m, {
      is_today: !!(m.serve_dates && m.serve_dates.indexOf(today) !== -1),
      ingredients: [],
      steps: [],
      _loaded: false
    });
  });
}

/* ============================================================
   メニューの工程・材料を遅延取得
   ============================================================ */
async function loadMenuDetail(menu) {
  if (menu._loaded) return;
  var id = menu.id;

  var ings = await sbFetch('ingredients',
    'select=*&menu_id=eq.' + encodeURIComponent(id) + '&order=sort_order');
  var rawSteps = await sbFetch('steps',
    'select=*&menu_id=eq.' + encodeURIComponent(id) + '&order=step_number');

  var stepIngs = [];
  if (rawSteps.length) {
    var stepIds = rawSteps.map(function(s) { return s.id; }).join(',');
    stepIngs = await sbFetch('step_ingredients',
      'select=*&step_id=in.(' + stepIds + ')');
  }

  menu.ingredients = ings.map(function(ing) {
    return { id: ing.id, name: ing.name, name_en: ing.name_en || '',
             amount: ing.amount || 0, unit: ing.unit || '' };
  });

  menu.steps = rawSteps.map(function(s) {
    var steamCon = null;
    if (s.sc_mode) {
      steamCon = { mode: s.sc_mode, mode_label: s.sc_mode_label || s.sc_mode,
                   temperature: s.sc_temperature, timer_minutes: s.sc_timer_minutes };
    }
    var myIngs = stepIngs
      .filter(function(si) { return si.step_id === s.id; })
      .map(function(si) {
        return { name: si.name, name_en: si.name_en || '',
                 amount: si.amount || 0, unit: si.unit || '' };
      });
    return {
      id: s.id, step_number: s.step_number, step_type: s.step_type || 'default',
      photo: s.photo_url || null, description: s.description || '',
      description_en: s.description_en || '', ingredients: myIngs,
      steam_con: steamCon,
      timer_minutes: s.timer_minutes || (steamCon ? steamCon.timer_minutes : null)
    };
  });

  menu._loaded = true;
}

/* ============================================================
   初期化
   ============================================================ */
window.addEventListener('DOMContentLoaded', async function() {
  loadSupabaseConfig();

  var now = new Date();
  document.getElementById('home-date').textContent = formatDateJa(now);
  var hh  = String(now.getHours()).padStart(2, '0');
  var min = String(now.getMinutes()).padStart(2, '0');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    document.getElementById('home-sync-info').textContent =
      '⚠️ 接続設定が必要です / Setup required';
    document.getElementById('today-count').textContent = '—';
    setTimeout(function() {
      document.getElementById('loading').classList.add('hidden');
      showScreen('home', false);
    }, 800);
    renderMenuGrid([], 'search-menu-grid');
    updateOnlineStatus();
    return;
  }

  try {
    await fetchAllMenus();
    var todayCount = MENUS.filter(function(m) { return m.is_today; }).length;
    document.getElementById('today-count').textContent = todayCount;
    document.getElementById('home-sync-info').textContent =
      '最終同期: ' + hh + ':' + min + ' / Last sync: ' + hh + ':' + min;
    renderMenuGrid(MENUS, 'search-menu-grid');
    document.getElementById('search-info').textContent =
      '全 ' + MENUS.length + ' 件 / ' + MENUS.length + ' items';
  } catch (e) {
    console.error('[Uni] Fetch error:', e);
    document.getElementById('home-sync-info').textContent = '⚠️ データ取得失敗 / Fetch failed';
    document.getElementById('today-count').textContent = '!';
  }

  updateOnlineStatus();
  window.addEventListener('online',  updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  setTimeout(function() {
    document.getElementById('loading').classList.add('hidden');
    showScreen('home', false);
  }, 1000);
});

/* ============================================================
   オンライン状態
   ============================================================ */
function updateOnlineStatus() {
  var isOnline = navigator.onLine;
  var badge = document.getElementById('sync-badge');
  var label = document.getElementById('sync-label');
  badge.className = 'sync-badge ' + (isOnline ? 'online' : 'offline');
  label.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
}

/* ============================================================
   画面遷移
   ============================================================ */
function showScreen(id, addHistory) {
  if (typeof addHistory === 'undefined') addHistory = true;

  var current = document.querySelector('.screen.active');
  if (current) {
    current.classList.add('exit-left');
    current.classList.remove('active');
    var el = current;
    setTimeout(function() { el.classList.remove('exit-left'); }, 300);
  }

  if (addHistory && state.currentScreen && state.currentScreen !== id) {
    state.screenHistory.push(state.currentScreen);
  }
  state.currentScreen = id;

  var next = document.getElementById('screen-' + id);
  next.classList.add('active');

  var scrollEl = next.querySelector('.scroll-body, .timer-body, .complete-body, .home-body, .steps-list');
  if (scrollEl) scrollEl.scrollTop = 0;
}

function goBack() {
  var prev = state.screenHistory.pop();
  if (!prev) return;
  var current = document.querySelector('.screen.active');
  if (current) current.classList.remove('active');
  state.currentScreen = prev;
  document.getElementById('screen-' + prev).classList.add('active');
}

function goHome() {
  clearTimerInterval();
  stopAlarmSound();
  document.getElementById('alarm-overlay').classList.remove('active');
  state.screenHistory = [];
  var current = document.querySelector('.screen.active');
  if (current) current.classList.remove('active');
  state.currentScreen = 'home';
  document.getElementById('screen-home').classList.add('active');
}

/* 調理中・タイマー中のホームボタン確認ダイアログ */
function confirmGoHome() {
  var ok = window.confirm(
    'ホームに戻りますか？\n調理の進捗はリセットされます。\n\n' +
    'Return to home?\nCooking progress will be reset.'
  );
  if (ok) goHome();
}

/* ============================================================
   食事時間帯セレクター
   ============================================================ */
function selectMealTime(meal, btn) {
  state.selectedMealTime = meal;
  document.querySelectorAll('.meal-time-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  btn.classList.add('active');
  var count = MENUS.filter(function(m) {
    return m.is_today && m.meal_times && m.meal_times.indexOf(meal) !== -1;
  }).length;
  document.getElementById('today-count').textContent = count;
}

function filterByMealTime(meal, btn) {
  state.selectedMealTime = meal;
  document.querySelectorAll('.header-meal-tab').forEach(function(b) {
    b.classList.toggle('active', b === btn);
  });
  var filtered = MENUS.filter(function(m) {
    return m.is_today && m.meal_times && m.meal_times.indexOf(meal) !== -1;
  });
  renderMenuGrid(filtered, 'today-menu-grid');
  document.getElementById('today-menu-count').textContent = filtered.length + '件';
  var info = MEAL_TIME_LABELS[meal];
  if (info) {
    document.getElementById('today-header-title').textContent = '今日の' + info.ja + ' ' + info.icon;
    document.getElementById('today-header-sub').textContent = "TODAY'S " + info.en;
  }
}

/* ============================================================
   今日のメニュー一覧
   ============================================================ */
function showTodayMenu() {
  var menus = state.selectedMealTime
    ? MENUS.filter(function(m) {
        return m.is_today && m.meal_times && m.meal_times.indexOf(state.selectedMealTime) !== -1;
      })
    : MENUS.filter(function(m) { return m.is_today; });
  renderMenuGrid(menus, 'today-menu-grid');
  document.getElementById('today-menu-count').textContent = menus.length + '件';
  document.querySelectorAll('.header-meal-tab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.meal === state.selectedMealTime);
  });
  showScreen('today');
}

/* ============================================================
   検索
   ============================================================ */
function showSearch() {
  showScreen('search');
  setTimeout(function() {
    var inp = document.getElementById('search-input');
    if (inp) inp.focus();
  }, 350);
}

function doSearch() {
  var q = document.getElementById('search-input').value.trim().toLowerCase();
  document.getElementById('search-clear-btn').style.display = q ? 'block' : 'none';
  var results = MENUS.filter(function(m) {
    var cuisineOk  = (state.filterCuisine  === 'all' || m.food_category === state.filterCuisine);
    var categoryOk = (state.filterCategory === 'all' || m.category      === state.filterCategory);
    var textOk = !q || (
      (m.id            || '').toLowerCase().indexOf(q) !== -1 ||
      (m.name          || '').toLowerCase().indexOf(q) !== -1 ||
      (m.name_en       || '').toLowerCase().indexOf(q) !== -1 ||
      (m.category      || '').toLowerCase().indexOf(q) !== -1 ||
      (m.food_category || '').toLowerCase().indexOf(q) !== -1
    );
    return cuisineOk && categoryOk && textOk;
  });
  renderMenuGrid(results, 'search-menu-grid');
  document.getElementById('search-info').textContent = q
    ? '"' + q + '" : ' + results.length + ' 件'
    : results.length + ' 件表示中';
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear-btn').style.display = 'none';
  doSearch();
}

function setFilter(type, value, btn) {
  if (type === 'cuisine') {
    state.filterCuisine = value;
    document.querySelectorAll('[data-filter-type="cuisine"]').forEach(function(c) {
      c.classList.toggle('active', c === btn);
    });
  } else {
    state.filterCategory = value;
    document.querySelectorAll('[data-filter-type="category"]').forEach(function(c) {
      c.classList.toggle('active', c === btn);
    });
  }
  doSearch();
}

/* ============================================================
   メニューグリッド描画
   ============================================================ */
function renderMenuGrid(menus, gridId) {
  var grid = document.getElementById(gridId);
  if (!menus || !menus.length) {
    grid.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-state-icon">🍽️</div>' +
        '<div class="empty-state-text">メニューが見つかりません</div>' +
        '<div class="empty-state-sub">No menus found</div>' +
      '</div>';
    return;
  }
  grid.innerHTML = menus.map(function(m) {
    var mediaHtml = m.finish_photo_url
      ? '<img src="' + escHtml(m.finish_photo_url) + '" alt="' + escHtml(m.name) + '" loading="lazy">'
      : escHtml(m.emoji || '🍽️');
    var mealTags = (m.meal_times || []).map(function(mt) {
      var info = MEAL_TIME_LABELS[mt];
      return info ? '<span class="tag tag-meal-' + mt + '">' + info.icon + ' ' + info.ja + '</span>' : '';
    }).join('');
    return (
      '<div class="menu-card" onclick="selectMenu(\'' + m.id + '\')">' +
        '<div class="menu-card-media">' + mediaHtml + '</div>' +
        '<div class="menu-card-body">' +
          '<div class="menu-card-id">' + escHtml(m.id) + '</div>' +
          '<div class="menu-card-name">' + escHtml(m.name) + '</div>' +
          '<div class="menu-card-tags">' +
            '<span class="tag tag-cuisine">'  + escHtml(m.food_category || '') + '</span>' +
            '<span class="tag tag-category">' + escHtml(m.category      || '') + '</span>' +
            mealTags +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

/* ============================================================
   メニュー選択 → 詳細
   ============================================================ */
async function selectMenu(id) {
  var menu = MENUS.find(function(m) { return m.id === id; });
  if (!menu) return;

  var loadEl = document.getElementById('loading');
  if (loadEl) loadEl.classList.remove('hidden');

  try {
    await loadMenuDetail(menu);
  } catch (e) {
    console.error('[Uni] Menu detail fetch error:', e);
    if (loadEl) loadEl.classList.add('hidden');
    alert('メニュー詳細の取得に失敗しました。\nFailed to load menu details.');
    return;
  }

  if (loadEl) loadEl.classList.add('hidden');
  state.selectedMenu    = menu;
  state.currentServings = menu.base_servings || 10;
  renderDetailScreen();
  showScreen('detail');
}

/* ============================================================
   詳細画面描画
   ============================================================ */
function renderDetailScreen() {
  var m = state.selectedMenu;

  var heroMedia = document.getElementById('detail-hero-media');
  if (m.finish_photo_url) {
    heroMedia.innerHTML = '<img src="' + escHtml(m.finish_photo_url) + '" alt="' + escHtml(m.name) + '">';
  } else {
    heroMedia.textContent = m.emoji || '🍽️';
  }

  var mealBadge = document.getElementById('detail-meal-badge');
  if (m.meal_times && m.meal_times.length) {
    mealBadge.textContent = m.meal_times.map(function(mt) {
      var info = MEAL_TIME_LABELS[mt];
      return info ? info.icon + ' ' + info.ja : '';
    }).filter(Boolean).join(' / ');
    mealBadge.style.display = 'inline-flex';
  } else {
    mealBadge.style.display = 'none';
  }

  document.getElementById('detail-id').textContent   = m.id;
  document.getElementById('detail-name').textContent = m.name;
  document.getElementById('detail-tags').innerHTML =
    '<span class="tag tag-cuisine">'  + escHtml(m.food_category || '') + '</span>' +
    '<span class="tag tag-category">' + escHtml(m.category      || '') + '</span>';
  document.getElementById('detail-steps-count').textContent =
    (m.steps && m.steps.length) ? m.steps.length : '—';
  renderDetailIngredients();
}

function renderDetailIngredients() {
  var m     = state.selectedMenu;
  var ratio = state.currentServings / (m.base_servings || 10);
  document.getElementById('serving-num').textContent = state.currentServings;
  if (!m.ingredients || !m.ingredients.length) {
    document.getElementById('detail-ing-list').innerHTML =
      '<div style="color:#999;font-size:13px">材料データがありません</div>';
    return;
  }
  document.getElementById('detail-ing-list').innerHTML = m.ingredients.map(function(ing) {
    var amt  = (ing.amount || 0) * ratio;
    var disp = Number.isInteger(amt) ? amt : amt.toFixed(1);
    return (
      '<div class="ing-row">' +
        '<span class="ing-name">'   + escHtml(ing.name)           + '</span>' +
        '<span class="ing-amount">' + disp + ' ' + escHtml(ing.unit) + '</span>' +
      '</div>'
    );
  }).join('');
}

function changeServings(delta) {
  state.currentServings = Math.max(1, state.currentServings + delta);
  renderDetailIngredients();
}

/* ============================================================
   工程全体像画面（新規追加）
   ============================================================ */
function showStepsOverview() {
  var m = state.selectedMenu;
  document.getElementById('overview-menu-name').textContent = m.name;

  var list = document.getElementById('steps-overview-list');
  if (!m.steps || !m.steps.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#6E8C75">工程データがありません</div>';
  } else {
    list.innerHTML = m.steps.map(function(step) {
      var icon = getStepIcon(step);
      var tags = '';
      if (step.timer_minutes) {
        tags += '<span class="steps-list-tag timer">⏱️ ' + step.timer_minutes + '分</span>';
      }
      if (step.steam_con) {
        tags += '<span class="steps-list-tag steamcon">🌡️ ' +
          escHtml(step.steam_con.mode_label) + ' ' +
          (step.steam_con.temperature || '') + '℃</span>';
      }
      return (
        '<div class="steps-list-item">' +
          '<div class="steps-list-num">' + step.step_number + '</div>' +
          '<div class="steps-list-icon">' + icon + '</div>' +
          '<div class="steps-list-body">' +
            '<div class="steps-list-desc">'    + escHtml(step.description)    + '</div>' +
            (step.description_en
              ? '<div class="steps-list-desc-en">' + escHtml(step.description_en) + '</div>'
              : '') +
            (tags ? '<div class="steps-list-meta">' + tags + '</div>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
  }
  showScreen('steps-overview');
}

/* ============================================================
   調理開始（工程一覧画面から）
   ============================================================ */
function startCooking() {
  state.currentStepIndex = 0;
  showScreen('step');
  renderStep();
}

/* ============================================================
   工程描画
   ============================================================ */
function renderStep() {
  var m     = state.selectedMenu;
  var steps = m.steps;
  var idx   = state.currentStepIndex;
  var step  = steps[idx];
  var total = steps.length;
  var num   = idx + 1;
  var pct   = Math.round((num / total) * 100);

  document.getElementById('step-menu-name').textContent     = m.name;
  document.getElementById('step-progress-fill').style.width = pct + '%';
  document.getElementById('step-progress-text').textContent = 'STEP ' + num + ' / ' + total;
  document.getElementById('step-current-num').textContent   = num;
  document.getElementById('step-total-num').textContent     = total;
  document.getElementById('step-type-icon').textContent     = getStepIcon(step);

  var photoBox = document.getElementById('step-photo-box');
  if (step.photo) {
    photoBox.innerHTML = '<img src="' + escHtml(step.photo) + '" alt="Step ' + num + '">';
  } else {
    photoBox.innerHTML =
      '<div class="step-photo-empty">' +
        '<span>📷</span>' +
        '<span class="step-photo-empty-text">No Photo</span>' +
      '</div>';
  }

  document.getElementById('step-desc-main').textContent = step.description;
  document.getElementById('step-desc-en').textContent   = step.description_en;

  var ratio      = state.currentServings / (m.base_servings || 10);
  var ingSection = document.getElementById('step-ing-section');
  if (step.ingredients && step.ingredients.length > 0) {
    ingSection.style.display = 'block';
    document.getElementById('step-ing-grid').innerHTML = step.ingredients.map(function(ing) {
      var amt  = (ing.amount || 0) * ratio;
      var disp = Number.isInteger(amt) ? amt : amt.toFixed(1);
      return (
        '<div class="step-ing-card">' +
          '<div class="step-ing-name-en">'    + escHtml(ing.name_en || '') + '</div>' +
          '<div class="step-ing-amount-row">' +
            '<span class="step-ing-amount">'  + disp                       + '</span>' +
            '<span class="step-ing-unit"> '   + escHtml(ing.unit)          + '</span>' +
          '</div>' +
          '<div class="step-ing-name-ja">'    + escHtml(ing.name)          + '</div>' +
        '</div>'
      );
    }).join('');
  } else {
    ingSection.style.display = 'none';
  }

  var scPanel = document.getElementById('step-steamcon');
  if (step.steam_con) {
    scPanel.style.display = 'block';
    var sc = step.steam_con;
    var modeIcons = { steam: '💨', combi: '🌀', hot_air: '🔥' };
    document.getElementById('sc-temp').textContent      = sc.temperature;
    document.getElementById('sc-mode-icon').textContent = modeIcons[sc.mode] || '⚙️';
    document.getElementById('sc-mode-val').textContent  = sc.mode_label;
    document.getElementById('sc-timer-val').textContent = sc.timer_minutes;
  } else {
    scPanel.style.display = 'none';
  }

  var hintRow = document.getElementById('timer-hint-row');
  if (step.timer_minutes) {
    hintRow.style.display = 'flex';
    document.getElementById('timer-hint-val').textContent =
      String(Math.floor(step.timer_minutes)).padStart(2, '0') + ':00';
  } else {
    hintRow.style.display = 'none';
  }

  var isLast = (idx === total - 1);
  var btn    = document.getElementById('complete-btn');
  document.getElementById('complete-btn-main').textContent  = isLast ? '調理完了！'       : '完了して次へ';
  document.getElementById('complete-btn-sub').textContent   = isLast ? 'COOKING COMPLETE' : 'DONE -> NEXT STEP';
  document.getElementById('complete-btn-arrow').textContent = isLast ? '✓'               : '→';
  if (isLast) btn.classList.add('finish-state');
  else        btn.classList.remove('finish-state');

  /* 以降の工程プレビュー */
  renderUpcomingSteps(steps, idx);
}

/* 以降の工程をコンパクト表示 */
function renderUpcomingSteps(steps, currentIdx) {
  var container = document.getElementById('upcoming-steps-section');
  if (!container) return;

  var remaining = steps.slice(currentIdx + 1); /* 次の工程以降 */
  if (!remaining.length) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  /* 最大5工程まで表示（それ以上は「...他N工程」） */
  var SHOW_MAX = 5;
  var shown    = remaining.slice(0, SHOW_MAX);
  var extra    = remaining.length - shown.length;

  document.getElementById('upcoming-steps-list').innerHTML =
    shown.map(function(step, i) {
      /* 距離が遠いほど薄くなる (opacity: 0.85 → 0.55) */
      var opacity = Math.max(0.45, 0.88 - i * 0.10).toFixed(2);
      var scale   = Math.max(0.88, 1.0  - i * 0.025).toFixed(3);
      var icon    = getStepIcon(step);
      var timerBadge = step.timer_minutes
        ? '<span class="upcoming-tag">⏱️ ' + step.timer_minutes + '分</span>'
        : '';
      var scBadge = step.steam_con
        ? '<span class="upcoming-tag">🌡️ ' + (step.steam_con.temperature || '') + '℃</span>'
        : '';
      return (
        '<div class="upcoming-step-item" style="opacity:' + opacity + ';transform:scale(' + scale + ');">' +
          '<div class="upcoming-step-num">STEP ' + step.step_number + '</div>' +
          '<div class="upcoming-step-icon">' + icon + '</div>' +
          '<div class="upcoming-step-body">' +
            '<div class="upcoming-step-desc">' + escHtml(step.description) + '</div>' +
            (timerBadge || scBadge
              ? '<div class="upcoming-step-tags">' + timerBadge + scBadge + '</div>'
              : '') +
          '</div>' +
        '</div>'
      );
    }).join('') +
    (extra > 0
      ? '<div class="upcoming-step-more">… 他 ' + extra + ' 工程</div>'
      : '');

/* ============================================================
   完了ボタン
   ============================================================ */
function completeStep() {
  var overlay = document.getElementById('step-flash-overlay');
  overlay.classList.remove('flash');
  void overlay.offsetWidth;
  overlay.classList.add('flash');
  setTimeout(function() { overlay.classList.remove('flash'); }, 380);

  var step = state.selectedMenu.steps[state.currentStepIndex];
  if (step.timer_minutes) {
    launchTimer(step.timer_minutes, step.description_en, state.currentStepIndex + 1);
  } else {
    advanceStep();
  }
}

function advanceStep() {
  state.currentStepIndex++;
  if (state.currentStepIndex >= state.selectedMenu.steps.length) {
    showCookingComplete();
  } else {
    renderStep();
  }
}

/* ============================================================
   タイマー
   ============================================================ */
function launchTimer(minutes, descEn, stepNum) {
  state.timerTotal     = minutes * 60;
  state.timerRemaining = state.timerTotal;

  clearTimerInterval();
  document.getElementById('alarm-overlay').classList.remove('active');
  document.getElementById('timer-step-label').textContent   = 'STEP ' + stepNum;
  document.getElementById('timer-desc-text').textContent    = descEn || 'Please wait for the timer.';
  document.getElementById('timer-display').textContent      = formatTime(state.timerRemaining);
  document.getElementById('timer-display').className        = 'timer-time';
  document.getElementById('timer-status-text').textContent  = '計測中 / RUNNING';

  var ringFill = document.getElementById('timer-ring-fill');
  ringFill.style.strokeDashoffset = '0';
  ringFill.classList.remove('done');

  var nextBtn = document.getElementById('timer-next-btn');
  nextBtn.disabled  = true;
  nextBtn.className = 'timer-next-btn';
  document.getElementById('timer-next-icon').textContent = '⏳';
  document.getElementById('timer-next-text').textContent = 'タイマー計測中... / Counting...';

  showScreen('timer');

  state.timerInterval = setInterval(function() {
    state.timerRemaining--;
    updateTimerDisplay();
    if (state.timerRemaining <= 0) {
      clearTimerInterval();
      onTimerFinished();
    }
  }, 1000);
}

function updateTimerDisplay() {
  var rem   = state.timerRemaining;
  var total = state.timerTotal;
  document.getElementById('timer-display').textContent = formatTime(rem);
  var offset = RING_CIRC * (1 - rem / total);
  document.getElementById('timer-ring-fill').style.strokeDashoffset = offset;
  var dispEl = document.getElementById('timer-display');
  if (rem <= 10 && rem > 0) dispEl.className = 'timer-time urgent';
  else if (rem > 0)          dispEl.className = 'timer-time';
}

function onTimerFinished() {
  document.getElementById('timer-display').textContent     = '00:00';
  document.getElementById('timer-display').className       = 'timer-time done';
  document.getElementById('timer-status-text').textContent = '完了！ / DONE!';

  var ringFill = document.getElementById('timer-ring-fill');
  ringFill.style.strokeDashoffset = String(RING_CIRC);
  ringFill.classList.add('done');

  document.getElementById('alarm-overlay').classList.add('active');

  var nextBtn = document.getElementById('timer-next-btn');
  nextBtn.disabled  = false;
  nextBtn.className = 'timer-next-btn ready';
  document.getElementById('timer-next-icon').textContent = '✓';
  document.getElementById('timer-next-text').textContent = '次の工程へ進む / NEXT STEP';

  /* 🔔 アラーム音 */
  playAlarmSound();
  /* 📳 バイブレーション */
  if (navigator.vibrate) navigator.vibrate([400, 100, 400, 100, 600]);
}

function timerComplete() {
  clearTimerInterval();
  stopAlarmSound();
  document.getElementById('alarm-overlay').classList.remove('active');
  document.getElementById('screen-timer').classList.remove('active');
  state.currentScreen = 'step';
  document.getElementById('screen-step').classList.add('active');
  advanceStep();
}

function tryExitTimer() {
  var ok = window.confirm(
    'タイマーを中断しますか？\nタイマーがリセットされます。\n\n' +
    'Abort the timer?\nThe timer will be reset.'
  );
  if (ok) {
    clearTimerInterval();
    stopAlarmSound();
    document.getElementById('alarm-overlay').classList.remove('active');
    goBack();
  }
}

function clearTimerInterval() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

function formatTime(seconds) {
  var s = Math.max(0, seconds);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ============================================================
   調理途中の中断確認
   ============================================================ */
function confirmExitCooking() {
  var ok = window.confirm('調理を中断しますか？\n\nAbort cooking?');
  if (ok) {
    clearTimerInterval();
    document.getElementById('alarm-overlay').classList.remove('active');
    goBack();
  }
}

/* ============================================================
   調理完了
   ============================================================ */
function showCookingComplete() {
  document.getElementById('complete-menu-name').textContent = state.selectedMenu.name;
  state.screenHistory = [];
  var current = document.querySelector('.screen.active');
  if (current) current.classList.remove('active');
  state.currentScreen = 'complete';
  document.getElementById('screen-complete').classList.add('active');
  if (navigator.vibrate) navigator.vibrate([100, 60, 100, 60, 300]);
}

/* ============================================================
   ユーティリティ
   ============================================================ */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}
