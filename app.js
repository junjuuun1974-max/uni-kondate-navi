/**
 * app.js - Uni献立ナビ
 * iPad Kitchen Navigation Tool
 *
 * ============================================================
 * 将来拡張メモ:
 * 1. 店舗別配信: APP_META.store_id でAPIエンドポイントを切り替え
 * 2. 日付別配信: APP_META.delivery_date で当日分のみフィルタリング
 * 3. 当日メニューのみ同期: is_today フラグをAPIで管理 → IndexedDB保存
 * 4. 画像URL管理: finish_photo_url / step.photo を CDN URL で管理し
 *    Service Workerでキャッシュ (CloudFront / Cloudflare Images + WebP)
 * 5. IndexedDB移行: loadMenus() を IndexedDB から読み込む形に差し替える
 * ============================================================
 */

'use strict';

/* ============================================================
   アプリメタデータ
   ============================================================ */
var APP_META = {
  store_id:       'STORE-001',
  delivery_date:  getTodayISO(),
  synced_at:      null,
  schema_version: 1
};

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

/* ============================================================
   作業種別アイコンマップ
   非日本語話者が一目で作業内容を理解できるよう視覚的に表現
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
  default:   '👨‍🍳'
};

function getStepIcon(step) {
  if (step.step_type && STEP_TYPE_ICONS[step.step_type]) {
    return STEP_TYPE_ICONS[step.step_type];
  }
  if (step.steam_con) return STEP_TYPE_ICONS['steam_con'];
  var d = (step.description || '') + ' ' + (step.description_en || '');
  if (/切る|切り|刻む|カット|みじん|slice|cut|chop|dice|mince/i.test(d))   return STEP_TYPE_ICONS['cut'];
  if (/炒める|炒め|揚げ|saute|stir.?fry|fry/i.test(d))                     return STEP_TYPE_ICONS['fry'];
  if (/混ぜ|こね|捏ね|合わせ|mix|knead|combine|blend/i.test(d))             return STEP_TYPE_ICONS['mix'];
  if (/スチコン|コンベクション|オーブン|convection/i.test(d))                return STEP_TYPE_ICONS['steam_con'];
  if (/煮込む|煮る|simmer/i.test(d))                                         return STEP_TYPE_ICONS['simmer'];
  if (/茹でる|下茹で|ゆで|boil|parboil/i.test(d))                           return STEP_TYPE_ICONS['boil'];
  if (/焼く|焼き|グリル|bake|grill|roast/i.test(d))                         return STEP_TYPE_ICONS['bake'];
  if (/蒸す|蒸し|steam/i.test(d))                                            return STEP_TYPE_ICONS['steam'];
  if (/盛り付け|盛る|皿|plate|garnish|serve/i.test(d))                      return STEP_TYPE_ICONS['plate'];
  if (/塩|醤油|みそ|みりん|砂糖|調味|味付け|season/i.test(d))               return STEP_TYPE_ICONS['season'];
  if (/冷ます|冷却|cool/i.test(d))                                           return STEP_TYPE_ICONS['cool'];
  if (/洗う|水洗い|wash/i.test(d))                                           return STEP_TYPE_ICONS['wash'];
  return STEP_TYPE_ICONS['default'];
}

/* ============================================================
   サンプルデータ
   FUTURE: IndexedDB から読み込み（API同期後に保存されたデータ）
   ============================================================ */
var MENUS = [
  {
    id: 'M-00001', name: '肉じゃが', name_en: 'Nikujaga (Meat & Potato Stew)',
    category: '煮物', sub_category: '肉料理', food_category: '和食',
    base_servings: 10, emoji: '🥩', is_today: true, finish_photo_url: null,
    ingredients: [
      { id: 'I001', name: '牛肉（薄切り）', name_en: 'Beef slices',       amount: 500, unit: 'g' },
      { id: 'I002', name: 'じゃがいも',     name_en: 'Potato',            amount: 800, unit: 'g' },
      { id: 'I003', name: '玉ねぎ',         name_en: 'Onion',             amount: 300, unit: 'g' },
      { id: 'I004', name: 'にんじん',       name_en: 'Carrot',            amount: 200, unit: 'g' },
      { id: 'I005', name: 'しらたき',       name_en: 'Shirataki noodles', amount: 200, unit: 'g' },
      { id: 'I006', name: 'だし汁',         name_en: 'Dashi stock',       amount: 600, unit: 'ml' },
      { id: 'I007', name: '砂糖',           name_en: 'Sugar',             amount:  40, unit: 'g' },
      { id: 'I008', name: 'みりん',         name_en: 'Mirin',             amount:  60, unit: 'ml' },
      { id: 'I009', name: '醤油',           name_en: 'Soy sauce',         amount:  80, unit: 'ml' }
    ],
    steps: [
      {
        id: 'S001', step_number: 1, step_type: 'cut', photo: null,
        description: '牛肉・じゃがいも・玉ねぎ・にんじんを一口大に切る。しらたきは下茹でする。',
        description_en: 'Cut beef, potatoes, onions, and carrots into bite-sized pieces. Parboil shirataki noodles.',
        ingredients: [
          { name: '牛肉（薄切り）', name_en: 'Beef',    amount: 500, unit: 'g' },
          { name: 'じゃがいも',     name_en: 'Potato',  amount: 800, unit: 'g' },
          { name: '玉ねぎ',         name_en: 'Onion',   amount: 300, unit: 'g' },
          { name: 'にんじん',       name_en: 'Carrot',  amount: 200, unit: 'g' },
          { name: 'しらたき',       name_en: 'Shirat.',  amount: 200, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S002', step_number: 2, step_type: 'fry', photo: null,
        description: '鍋を熱し、牛肉を炒める。色が変わったら玉ねぎ・にんじんを加えてさらに炒める。',
        description_en: 'Heat pot, stir-fry beef until color changes. Add onions and carrots, continue sauteing.',
        ingredients: [
          { name: '牛肉（薄切り）', name_en: 'Beef',  amount: 500, unit: 'g' },
          { name: '玉ねぎ',         name_en: 'Onion', amount: 300, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S003', step_number: 3, step_type: 'simmer', photo: null,
        description: 'だし汁・砂糖・みりんを加え、沸騰したらじゃがいも・しらたきを加える。',
        description_en: 'Add dashi stock, sugar, and mirin. When boiling, add potatoes and shirataki.',
        ingredients: [
          { name: 'だし汁',   name_en: 'Dashi',  amount: 600, unit: 'ml' },
          { name: '砂糖',     name_en: 'Sugar',  amount:  40, unit: 'g' },
          { name: 'みりん',   name_en: 'Mirin',  amount:  60, unit: 'ml' },
          { name: 'じゃがいも', name_en: 'Potato', amount: 800, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S004', step_number: 4, step_type: 'steam_con', photo: null,
        description: 'スチコンで加熱する（スチームモード・100℃・20分）。',
        description_en: 'Cook in steam convection oven (Steam mode, 100C, 20 min).',
        ingredients: [],
        steam_con: { mode: 'steam', mode_label: 'スチーム', temperature: 100, timer_minutes: 20, steam: 100, hot_air: 0 },
        timer_minutes: 20
      },
      {
        id: 'S005', step_number: 5, step_type: 'season', photo: null,
        description: '醤油を加えてさらに5分煮る。じゃがいもに火が通ったら完成。',
        description_en: 'Add soy sauce and simmer 5 more minutes. Done when potatoes are tender.',
        ingredients: [
          { name: '醤油', name_en: 'Soy sauce', amount: 80, unit: 'ml' }
        ],
        steam_con: null, timer_minutes: 5
      }
    ]
  },
  {
    id: 'M-00042', name: 'クリームシチュー', name_en: 'Cream Stew',
    category: '煮物', sub_category: '洋風', food_category: '洋食',
    base_servings: 10, emoji: '🍲', is_today: true, finish_photo_url: null,
    ingredients: [
      { id: 'I101', name: '鶏もも肉',     name_en: 'Chicken thigh', amount: 600, unit: 'g' },
      { id: 'I102', name: 'じゃがいも',   name_en: 'Potato',        amount: 700, unit: 'g' },
      { id: 'I103', name: 'にんじん',     name_en: 'Carrot',        amount: 200, unit: 'g' },
      { id: 'I104', name: '玉ねぎ',       name_en: 'Onion',         amount: 300, unit: 'g' },
      { id: 'I105', name: 'ブロッコリー', name_en: 'Broccoli',      amount: 300, unit: 'g' },
      { id: 'I106', name: '牛乳',         name_en: 'Milk',          amount: 800, unit: 'ml' },
      { id: 'I107', name: '生クリーム',   name_en: 'Heavy cream',   amount: 200, unit: 'ml' },
      { id: 'I108', name: '小麦粉',       name_en: 'Flour',         amount:  60, unit: 'g' },
      { id: 'I109', name: 'バター',       name_en: 'Butter',        amount:  50, unit: 'g' }
    ],
    steps: [
      {
        id: 'S101', step_number: 1, step_type: 'cut', photo: null,
        description: '鶏肉・野菜を一口大に切る。ブロッコリーは小房に分けておく。',
        description_en: 'Cut chicken and vegetables into bite-sized pieces. Separate broccoli into small florets.',
        ingredients: [
          { name: '鶏もも肉', name_en: 'Chicken', amount: 600, unit: 'g' },
          { name: '野菜類',   name_en: 'Veg',     amount: 1200, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S102', step_number: 2, step_type: 'mix', photo: null,
        description: 'バターを溶かし、小麦粉を加えてよく炒める（ルー作り）。牛乳を少しずつ加えてのばす。',
        description_en: 'Melt butter, add flour and stir to make roux. Gradually add milk and mix until smooth.',
        ingredients: [
          { name: 'バター',   name_en: 'Butter', amount:  50, unit: 'g' },
          { name: '小麦粉',   name_en: 'Flour',  amount:  60, unit: 'g' },
          { name: '牛乳',     name_en: 'Milk',   amount: 800, unit: 'ml' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S103', step_number: 3, step_type: 'steam_con', photo: null,
        description: '鶏肉・野菜とルーを合わせてスチコンで加熱する（コンビ160℃・25分）。',
        description_en: 'Combine chicken, vegetables and roux. Cook in steam oven (Combi, 160C, 25 min).',
        ingredients: [],
        steam_con: { mode: 'combi', mode_label: 'コンビ', temperature: 160, timer_minutes: 25, steam: 30, hot_air: 70 },
        timer_minutes: 25
      },
      {
        id: 'S104', step_number: 4, step_type: 'season', photo: null,
        description: '生クリームを加えてひと煮立ちさせ、塩・こしょうで味を整える。',
        description_en: 'Add heavy cream and bring to a brief boil. Season with salt and pepper.',
        ingredients: [
          { name: '生クリーム', name_en: 'Cream', amount: 200, unit: 'ml' }
        ],
        steam_con: null, timer_minutes: null
      }
    ]
  },
  {
    id: 'M-00107', name: '麻婆豆腐', name_en: 'Mapo Tofu',
    category: '炒め物', sub_category: '豆腐料理', food_category: '中華',
    base_servings: 10, emoji: '🌶️', is_today: true, finish_photo_url: null,
    ingredients: [
      { id: 'I201', name: '木綿豆腐',     name_en: 'Firm tofu',     amount: 1000, unit: 'g' },
      { id: 'I202', name: '豚ひき肉',     name_en: 'Ground pork',   amount:  300, unit: 'g' },
      { id: 'I203', name: '長ねぎ',       name_en: 'Green onion',   amount:  150, unit: 'g' },
      { id: 'I204', name: 'にんにく',     name_en: 'Garlic',        amount:   20, unit: 'g' },
      { id: 'I205', name: '豆板醤',       name_en: 'Doubanjiang',   amount:   30, unit: 'g' },
      { id: 'I206', name: '甜麺醤',       name_en: 'Tianmianjiang', amount:   20, unit: 'g' },
      { id: 'I207', name: '鶏がらスープ', name_en: 'Chicken stock', amount:  400, unit: 'ml' },
      { id: 'I208', name: '片栗粉',       name_en: 'Potato starch', amount:   20, unit: 'g' },
      { id: 'I209', name: 'ごま油',       name_en: 'Sesame oil',    amount:   15, unit: 'ml' }
    ],
    steps: [
      {
        id: 'S201', step_number: 1, step_type: 'prep', photo: null,
        description: '豆腐を2cm角に切り、熱湯で下茹で（2分）。にんにく・長ねぎはみじん切り。',
        description_en: 'Cut tofu into 2cm cubes and parboil 2 min. Mince garlic and green onion.',
        ingredients: [
          { name: '木綿豆腐', name_en: 'Tofu',  amount: 1000, unit: 'g' },
          { name: 'にんにく', name_en: 'Garlic', amount:   20, unit: 'g' }
        ],
        steam_con: null, timer_minutes: 2
      },
      {
        id: 'S202', step_number: 2, step_type: 'fry', photo: null,
        description: '油を熱し豆板醤・甜麺醤・にんにくを炒める。香りが出たら豚ひき肉を加えて炒める。',
        description_en: 'Heat oil, stir-fry doubanjiang, tianmianjiang and garlic. Add ground pork and stir-fry.',
        ingredients: [
          { name: '豚ひき肉', name_en: 'Pork',    amount: 300, unit: 'g' },
          { name: '豆板醤',   name_en: 'Doubanjg', amount:  30, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S203', step_number: 3, step_type: 'season', photo: null,
        description: '鶏がらスープを加え、豆腐を入れて煮る。片栗粉でとろみをつけ、ごま油を回しかける。',
        description_en: 'Add chicken stock and tofu, simmer. Thicken with starch, drizzle sesame oil.',
        ingredients: [
          { name: '鶏がらスープ', name_en: 'Stock',       amount: 400, unit: 'ml' },
          { name: '片栗粉',       name_en: 'Starch',      amount:  20, unit: 'g' },
          { name: 'ごま油',       name_en: 'Sesame oil',  amount:  15, unit: 'ml' }
        ],
        steam_con: null, timer_minutes: null
      }
    ]
  },
  {
    id: 'M-00215', name: '鮭の塩焼き', name_en: 'Grilled Salted Salmon',
    category: '焼き物', sub_category: '魚料理', food_category: '和食',
    base_servings: 10, emoji: '🐟', is_today: false, finish_photo_url: null,
    ingredients: [
      { id: 'I301', name: '鮭切り身', name_en: 'Salmon fillet', amount: 1000, unit: 'g' },
      { id: 'I302', name: '塩',       name_en: 'Salt',          amount:   15, unit: 'g' },
      { id: 'I303', name: 'レモン',   name_en: 'Lemon',         amount:    2, unit: '個' }
    ],
    steps: [
      {
        id: 'S301', step_number: 1, step_type: 'season', photo: null,
        description: '鮭の両面に塩を振り、15分置いて水分をペーパーで拭き取る。',
        description_en: 'Season salmon with salt on both sides. Rest 15 min, then pat dry with paper.',
        ingredients: [
          { name: '鮭切り身', name_en: 'Salmon', amount: 1000, unit: 'g' },
          { name: '塩',       name_en: 'Salt',   amount:   15, unit: 'g' }
        ],
        steam_con: null, timer_minutes: 15
      },
      {
        id: 'S302', step_number: 2, step_type: 'steam_con', photo: null,
        description: 'スチコンで焼く（ホットエアー220℃・12分）。皮目をパリッと仕上げる。',
        description_en: 'Cook in steam oven (Hot Air, 220C, 12 min) for crispy skin.',
        ingredients: [],
        steam_con: { mode: 'hot_air', mode_label: 'ホットエアー', temperature: 220, timer_minutes: 12, steam: 0, hot_air: 100 },
        timer_minutes: 12
      },
      {
        id: 'S303', step_number: 3, step_type: 'plate', photo: null,
        description: '器に盛り付け、レモンを添えて完成。',
        description_en: 'Plate salmon and garnish with lemon wedges.',
        ingredients: [
          { name: 'レモン', name_en: 'Lemon', amount: 2, unit: '個' }
        ],
        steam_con: null, timer_minutes: null
      }
    ]
  },
  {
    id: 'M-00303', name: '豚汁', name_en: 'Tonjiru (Pork Miso Soup)',
    category: '汁物', sub_category: '味噌汁', food_category: '和食',
    base_servings: 10, emoji: '🍜', is_today: false, finish_photo_url: null,
    ingredients: [
      { id: 'I401', name: '豚バラ肉', name_en: 'Pork belly',   amount:  300, unit: 'g' },
      { id: 'I402', name: '大根',     name_en: 'Daikon',        amount:  400, unit: 'g' },
      { id: 'I403', name: 'にんじん', name_en: 'Carrot',        amount:  150, unit: 'g' },
      { id: 'I404', name: 'ごぼう',   name_en: 'Burdock',       amount:  100, unit: 'g' },
      { id: 'I405', name: 'こんにゃく', name_en: 'Konnyaku',   amount:  150, unit: 'g' },
      { id: 'I406', name: 'みそ',     name_en: 'Miso paste',    amount:  120, unit: 'g' },
      { id: 'I407', name: 'だし汁',   name_en: 'Dashi stock',   amount: 1500, unit: 'ml' }
    ],
    steps: [
      {
        id: 'S401', step_number: 1, step_type: 'cut', photo: null,
        description: '豚肉・大根・にんじん・ごぼうを一口大に切る。こんにゃくは手でちぎって下茹でする。',
        description_en: 'Cut pork and vegetables into pieces. Tear konnyaku by hand and parboil.',
        ingredients: [
          { name: '豚バラ肉', name_en: 'Pork',     amount: 300, unit: 'g' },
          { name: '野菜類',   name_en: 'Veg',      amount: 800, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S402', step_number: 2, step_type: 'simmer', photo: null,
        description: '油で豚肉を炒め、野菜を加えてさらに炒める。だし汁を加えて15分煮る。',
        description_en: 'Stir-fry pork, add vegetables, pour dashi and simmer 15 min.',
        ingredients: [
          { name: 'だし汁', name_en: 'Dashi', amount: 1500, unit: 'ml' }
        ],
        steam_con: null, timer_minutes: 15
      },
      {
        id: 'S403', step_number: 3, step_type: 'season', photo: null,
        description: '野菜が柔らかくなったら火を止めてみそを溶き入れる。',
        description_en: 'When vegetables are tender, remove from heat and dissolve miso.',
        ingredients: [
          { name: 'みそ', name_en: 'Miso', amount: 120, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      }
    ]
  },
  {
    id: 'M-00412', name: 'ハンバーグ', name_en: 'Hamburg Steak',
    category: '焼き物', sub_category: '肉料理', food_category: '洋食',
    base_servings: 10, emoji: '🍔', is_today: true, finish_photo_url: null,
    ingredients: [
      { id: 'I501', name: '合い挽き肉',   name_en: 'Mixed ground meat', amount: 800, unit: 'g' },
      { id: 'I502', name: '玉ねぎ',       name_en: 'Onion (minced)',    amount: 300, unit: 'g' },
      { id: 'I503', name: 'パン粉',       name_en: 'Breadcrumbs',      amount:  80, unit: 'g' },
      { id: 'I504', name: '牛乳',         name_en: 'Milk',             amount: 100, unit: 'ml' },
      { id: 'I505', name: '卵',           name_en: 'Eggs',             amount:   2, unit: '個' },
      { id: 'I506', name: 'ナツメグ',     name_en: 'Nutmeg',           amount:   2, unit: 'g' }
    ],
    steps: [
      {
        id: 'S501', step_number: 1, step_type: 'fry', photo: null,
        description: '玉ねぎをみじん切りにして炒め、冷ます。パン粉を牛乳に浸しておく。',
        description_en: 'Mince onion and saute until soft, then cool. Soak breadcrumbs in milk.',
        ingredients: [
          { name: '玉ねぎ', name_en: 'Onion',       amount: 300, unit: 'g' },
          { name: 'パン粉', name_en: 'Breadcrumbs', amount:  80, unit: 'g' },
          { name: '牛乳',   name_en: 'Milk',        amount: 100, unit: 'ml' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S502', step_number: 2, step_type: 'mix', photo: null,
        description: 'ひき肉・玉ねぎ・パン粉・卵・ナツメグをよく捏ねて10等分に成形する。',
        description_en: 'Mix all ingredients thoroughly and shape into 10 patties.',
        ingredients: [
          { name: '合い挽き肉', name_en: 'Meat',    amount: 800, unit: 'g' },
          { name: '卵',         name_en: 'Eggs',    amount:   2, unit: '個' },
          { name: 'ナツメグ',   name_en: 'Nutmeg',  amount:   2, unit: 'g' }
        ],
        steam_con: null, timer_minutes: null
      },
      {
        id: 'S503', step_number: 3, step_type: 'steam_con', photo: null,
        description: 'フライパンで表面を焼いてから、スチコンで中まで火を通す（コンビ180℃・15分）。',
        description_en: 'Sear patties in pan, then finish in steam oven (Combi, 180C, 15 min).',
        ingredients: [],
        steam_con: { mode: 'combi', mode_label: 'コンビ', temperature: 180, timer_minutes: 15, steam: 30, hot_air: 70 },
        timer_minutes: 15
      }
    ]
  }
];

/* ============================================================
   アプリ状態
   ============================================================ */
var state = {
  currentScreen:    'home',
  screenHistory:    [],
  selectedMenu:     null,
  currentServings:  10,
  currentStepIndex: 0,
  filterCuisine:    'all',
  filterCategory:   'all',
  timerInterval:    null,
  timerRemaining:   0,
  timerTotal:       0
};

var RING_CIRC = 2 * Math.PI * 110; /* 691.15 */

/* ============================================================
   PWA: Service Worker 登録
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('./sw.js')
      .then(function(reg) { console.log('[SW] Registered:', reg.scope); })
      .catch(function(err) { console.warn('[SW] Registration failed:', err); });
  });
}

/* ============================================================
   初期化
   ============================================================ */
window.addEventListener('DOMContentLoaded', function() {
  /* 日付表示 */
  var now = new Date();
  var mm = now.getMonth() + 1;
  var dd = String(now.getDate()).padStart(2, '0');
  document.getElementById('home-date').textContent = mm + '.' + dd;

  /* 今日のメニュー件数 */
  var todayCount = MENUS.filter(function(m) { return m.is_today; }).length;
  document.getElementById('today-count').textContent = todayCount;

  /* 同期情報 */
  var hh = String(now.getHours()).padStart(2, '0');
  var min = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('home-sync-info').textContent =
    '最終同期: ' + hh + ':' + min + ' / Last sync: ' + hh + ':' + min;

  /* 検索画面の初期表示 */
  renderMenuGrid(MENUS, 'search-menu-grid');
  document.getElementById('search-info').textContent =
    '全 ' + MENUS.length + ' 件 / ' + MENUS.length + ' items';

  /* オンライン状態 */
  updateOnlineStatus();
  window.addEventListener('online',  updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  /* ローディング非表示 → ホーム表示 */
  setTimeout(function() {
    document.getElementById('loading').classList.add('hidden');
    showScreen('home', false);
  }, 900);
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
    var el = current; /* capture */
    setTimeout(function() { el.classList.remove('exit-left'); }, 320);
  }

  if (addHistory && state.currentScreen && state.currentScreen !== id) {
    state.screenHistory.push(state.currentScreen);
  }
  state.currentScreen = id;

  var next = document.getElementById('screen-' + id);
  next.classList.add('active');

  /* スクロール位置リセット */
  var scrollEl = next.querySelector('.scroll-body, .step-scroll, .timer-body, .complete-body');
  if (scrollEl) scrollEl.scrollTop = 0;
}

function goBack() {
  var prev = state.screenHistory.pop();
  if (!prev) return;
  var current = document.querySelector('.screen.active');
  if (current) {
    current.classList.remove('active');
  }
  state.currentScreen = prev;
  document.getElementById('screen-' + prev).classList.add('active');
}

function goHome() {
  state.screenHistory = [];
  var current = document.querySelector('.screen.active');
  if (current) current.classList.remove('active');
  state.currentScreen = 'home';
  document.getElementById('screen-home').classList.add('active');
}

/* ============================================================
   ホーム → 今日のメニュー
   ============================================================ */
function showTodayMenu() {
  var todayMenus = MENUS.filter(function(m) { return m.is_today; });
  renderMenuGrid(todayMenus, 'today-menu-grid');
  document.getElementById('today-menu-count').textContent = todayMenus.length + '件';
  showScreen('today');
}

/* ============================================================
   ホーム → 検索
   ============================================================ */
function showSearch() {
  showScreen('search');
  setTimeout(function() {
    var inp = document.getElementById('search-input');
    if (inp) inp.focus();
  }, 350);
}

/* ============================================================
   メニューグリッド描画
   ============================================================ */
function renderMenuGrid(menus, gridId) {
  var grid = document.getElementById(gridId);
  if (!menus.length) {
    grid.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-state-icon">🔍</div>' +
        '<div class="empty-state-text">メニューが見つかりません</div>' +
        '<div class="empty-state-sub">No menus found</div>' +
      '</div>';
    return;
  }

  grid.innerHTML = menus.map(function(m) {
    /* 仕上がり写真: URLあれば<img>、なければ絵文字 */
    var mediaHtml = m.finish_photo_url
      ? '<img src="' + escHtml(m.finish_photo_url) + '" alt="' + escHtml(m.name) + '" loading="lazy">'
      : escHtml(m.emoji || '🍽️');

    return (
      '<div class="menu-card" onclick="selectMenu(\'' + m.id + '\')">' +
        '<div class="menu-card-media">' + mediaHtml + '</div>' +
        '<div class="menu-card-body">' +
          '<div class="menu-card-id">' + escHtml(m.id) + '</div>' +
          '<div class="menu-card-name">' + escHtml(m.name) + '</div>' +
          '<div class="menu-card-tags">' +
            '<span class="tag tag-cuisine">' + escHtml(m.food_category) + '</span>' +
            '<span class="tag tag-category">' + escHtml(m.category) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

/* ============================================================
   検索
   ============================================================ */
function doSearch() {
  var q = document.getElementById('search-input').value.trim().toLowerCase();
  var clearBtn = document.getElementById('search-clear-btn');
  clearBtn.style.display = q ? 'block' : 'none';

  var results = MENUS.filter(function(m) {
    var cuisineOk = (state.filterCuisine === 'all' || m.food_category === state.filterCuisine);
    var categoryOk = (state.filterCategory === 'all' || m.category === state.filterCategory);
    var textOk = !q || (
      m.id.toLowerCase().indexOf(q) !== -1 ||
      m.name.toLowerCase().indexOf(q) !== -1 ||
      m.name_en.toLowerCase().indexOf(q) !== -1 ||
      m.category.toLowerCase().indexOf(q) !== -1 ||
      m.food_category.toLowerCase().indexOf(q) !== -1
    );
    return cuisineOk && categoryOk && textOk;
  });

  renderMenuGrid(results, 'search-menu-grid');

  var info = document.getElementById('search-info');
  if (q) {
    info.textContent = '"' + q + '" の検索結果: ' + results.length + ' 件 / Found: ' + results.length;
  } else {
    info.textContent = results.length + ' 件表示中 / Showing ' + results.length + ' items';
  }
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear-btn').style.display = 'none';
  doSearch();
}

/**
 * 2軸フィルター切り替え
 * type: 'cuisine' | 'category'
 */
function setFilter(type, value, btn) {
  if (type === 'cuisine') {
    state.filterCuisine = value;
    /* 同行のチップを切り替え */
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
   メニュー選択 → 詳細画面
   ============================================================ */
function selectMenu(id) {
  var menu = MENUS.find(function(m) { return m.id === id; });
  if (!menu) return;

  state.selectedMenu    = menu;
  state.currentServings = menu.base_servings;

  renderDetailScreen();
  showScreen('detail');
}

function renderDetailScreen() {
  var m = state.selectedMenu;

  document.getElementById('detail-header-name').textContent = m.name;
  document.getElementById('detail-id').textContent          = m.id;
  document.getElementById('detail-name').textContent        = m.name;

  /* タグ */
  document.getElementById('detail-tags').innerHTML =
    '<span class="tag tag-cuisine">' + escHtml(m.food_category) + '</span>' +
    '<span class="tag tag-category">' + escHtml(m.category) + '</span>';

  /* 仕上がり写真: URLあれば<img>、なければ絵文字 */
  var heroMedia = document.getElementById('detail-hero-media');
  if (m.finish_photo_url) {
    heroMedia.innerHTML = '<img src="' + escHtml(m.finish_photo_url) + '" alt="' + escHtml(m.name) + '">';
  } else {
    heroMedia.textContent = m.emoji || '🍽️';
  }

  document.getElementById('detail-steps-count').textContent = m.steps.length;

  renderDetailIngredients();
}

function renderDetailIngredients() {
  var m     = state.selectedMenu;
  var ratio = state.currentServings / m.base_servings;

  document.getElementById('serving-num').textContent = state.currentServings;

  document.getElementById('detail-ing-list').innerHTML = m.ingredients.map(function(ing) {
    var amt  = ing.amount * ratio;
    var disp = Number.isInteger(amt) ? amt : amt.toFixed(1);
    return (
      '<div class="ing-row">' +
        '<span class="ing-name">' + escHtml(ing.name) + '</span>' +
        '<span class="ing-amount">' + disp + ' ' + escHtml(ing.unit) + '</span>' +
      '</div>'
    );
  }).join('');
}

/* 食数変更
   【実装方針 B】: 試作として食数変更UIを残す。
   本番では currentUser.role === 'staff' の場合この関数を無効化し、
   changeServings() 呼び出し元ボタンを非表示にする。
*/
function changeServings(delta) {
  state.currentServings = Math.max(1, state.currentServings + delta);
  renderDetailIngredients();
}

/* ============================================================
   調理開始
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

  /* メニュー名 */
  document.getElementById('step-menu-name').textContent = m.name;

  /* 進捗 */
  document.getElementById('step-progress-fill').style.width = pct + '%';
  document.getElementById('step-progress-text').textContent  = 'STEP ' + num + ' / ' + total;
  document.getElementById('step-progress-pct').textContent   = pct + '%';
  document.getElementById('step-current-num').textContent    = num;
  document.getElementById('step-total-num').textContent      = total;

  /* 作業種別アイコン (非日本語話者向け視覚表現) */
  document.getElementById('step-type-icon').textContent = getStepIcon(step);

  /* 工程写真: URLあれば<img>、なければ空状態 */
  var photoWrap = document.getElementById('step-photo-wrap');
  if (step.photo) {
    photoWrap.innerHTML = '<img src="' + escHtml(step.photo) + '" alt="Step ' + num + '">';
  } else {
    photoWrap.innerHTML =
      '<div class="step-photo-empty">' +
        '<span class="step-photo-empty-icon">📷</span>' +
        '<span class="step-photo-empty-text">工程写真なし / No Photo</span>' +
      '</div>';
  }

  /* 工程説明 */
  document.getElementById('step-desc-main').textContent = step.description;
  document.getElementById('step-desc-en').textContent   = step.description_en;

  /* 使用材料 */
  var ratio      = state.currentServings / m.base_servings;
  var ingSection = document.getElementById('step-ing-section');
  if (step.ingredients && step.ingredients.length > 0) {
    ingSection.style.display = 'block';
    document.getElementById('step-ing-grid').innerHTML = step.ingredients.map(function(ing) {
      var amt  = ing.amount * ratio;
      var disp = Number.isInteger(amt) ? amt : amt.toFixed(1);
      return (
        '<div class="step-ing-card">' +
          '<div class="step-ing-name-en">' + escHtml(ing.name_en) + '</div>' +
          '<div class="step-ing-amount-row">' +
            '<span class="step-ing-amount">' + disp + '</span>' +
            '<span class="step-ing-unit"> ' + escHtml(ing.unit) + '</span>' +
          '</div>' +
          '<div class="step-ing-name-ja">' + escHtml(ing.name) + '</div>' +
        '</div>'
      );
    }).join('');
  } else {
    ingSection.style.display = 'none';
  }

  /* スチコン設定 */
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

  /* タイマー予告 */
  var hintRow = document.getElementById('timer-hint-row');
  if (step.timer_minutes) {
    hintRow.style.display = 'flex';
    var mm = String(Math.floor(step.timer_minutes)).padStart(2, '0');
    document.getElementById('timer-hint-val').textContent = mm + ':00';
  } else {
    hintRow.style.display = 'none';
  }

  /* 完了ボタンラベル: 最終工程は「調理完了」に変更 */
  var isLast    = idx === total - 1;
  var btnMain   = document.getElementById('complete-btn-main');
  var btnSub    = document.getElementById('complete-btn-sub');
  var btnArrow  = document.getElementById('complete-btn-arrow');
  var btn       = document.getElementById('complete-btn');

  if (isLast) {
    btnMain.textContent  = '調理完了！';
    btnSub.textContent   = 'COOKING COMPLETE';
    btnArrow.textContent = '✓';
    btn.classList.add('finish-state');
  } else {
    btnMain.textContent  = '完了して次へ';
    btnSub.textContent   = 'DONE -> NEXT STEP';
    btnArrow.textContent = '→';
    btn.classList.remove('finish-state');
  }

  /* スクロール先頭 */
  document.getElementById('step-scroll').scrollTop = 0;
}

/* ============================================================
   完了ボタン押下
   ============================================================ */
function completeStep() {
  /* 完了フラッシュ */
  var overlay = document.getElementById('step-flash-overlay');
  overlay.classList.remove('flash');
  void overlay.offsetWidth; /* reflow */
  overlay.classList.add('flash');
  setTimeout(function() { overlay.classList.remove('flash'); }, 400);

  var step = state.selectedMenu.steps[state.currentStepIndex];

  if (step.timer_minutes) {
    /* タイマーあり → タイマー画面へ */
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

  /* リセット */
  clearTimerInterval();
  document.getElementById('alarm-overlay').classList.remove('active');

  /* UI初期化 */
  document.getElementById('timer-step-label').textContent = 'STEP ' + stepNum;
  document.getElementById('timer-desc-text').textContent  = descEn || 'Please wait for the timer to finish.';
  document.getElementById('timer-display').textContent    = formatTime(state.timerRemaining);
  document.getElementById('timer-display').className      = 'timer-time';
  document.getElementById('timer-status-text').textContent = '計測中 / RUNNING';

  var ringFill = document.getElementById('timer-ring-fill');
  ringFill.style.strokeDashoffset = '0';
  ringFill.classList.remove('done');

  var nextBtn = document.getElementById('timer-next-btn');
  nextBtn.disabled = true;
  nextBtn.className = 'timer-next-btn';
  document.getElementById('timer-next-icon').textContent = '⏳';
  document.getElementById('timer-next-text').textContent = 'タイマー計測中... / Counting...';

  showScreen('timer');

  /* カウントダウン開始 */
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
  var rem  = state.timerRemaining;
  var total = state.timerTotal;

  document.getElementById('timer-display').textContent = formatTime(rem);

  /* リング */
  var pct    = rem / total;
  var offset = RING_CIRC * (1 - pct);
  document.getElementById('timer-ring-fill').style.strokeDashoffset = offset;

  /* 残り10秒: 赤・点滅 */
  var dispEl = document.getElementById('timer-display');
  if (rem <= 10 && rem > 0) {
    dispEl.className = 'timer-time urgent';
  } else {
    dispEl.className = 'timer-time';
  }
}

function onTimerFinished() {
  /* 表示更新: 緑・完了状態 */
  document.getElementById('timer-display').textContent    = '00:00';
  document.getElementById('timer-display').className      = 'timer-time done';
  document.getElementById('timer-status-text').textContent = '完了！ / DONE!';

  var ringFill = document.getElementById('timer-ring-fill');
  ringFill.style.strokeDashoffset = RING_CIRC + '';
  ringFill.classList.add('done');

  /* アラームオーバーレイ */
  document.getElementById('alarm-overlay').classList.add('active');

  /* 次へボタンをアクティブ化 */
  var nextBtn = document.getElementById('timer-next-btn');
  nextBtn.disabled = false;
  nextBtn.className = 'timer-next-btn ready';
  document.getElementById('timer-next-icon').textContent = '✓';
  document.getElementById('timer-next-text').textContent = '次の工程へ進む / NEXT STEP';

  /* バイブレーション */
  if (navigator.vibrate) {
    navigator.vibrate([400, 100, 400, 100, 600]);
  }
}

/* タイマー完了 → 次工程へ */
function timerComplete() {
  clearTimerInterval();
  document.getElementById('alarm-overlay').classList.remove('active');

  /* タイマー画面を閉じてステップ画面に戻る */
  var timerScreen = document.getElementById('screen-timer');
  timerScreen.classList.remove('active');

  state.currentScreen = 'step';
  var stepScreen = document.getElementById('screen-step');
  stepScreen.classList.add('active');

  /* 次工程へ進む */
  advanceStep();
}

/**
 * タイマー中断確認
 * 誤操作防止のため必ず確認ダイアログを表示
 */
function tryExitTimer() {
  var ok = window.confirm(
    'タイマーを中断しますか？\n工程のタイマーがリセットされます。\n\n' +
    'Abort the timer?\nThe timer for this step will be reset.'
  );
  if (ok) {
    clearTimerInterval();
    document.getElementById('alarm-overlay').classList.remove('active');
    goBack();
  }
}

function clearTimerInterval() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function formatTime(seconds) {
  var s = Math.max(0, seconds);
  var m = Math.floor(s / 60);
  var sec = s % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

/* ============================================================
   調理途中の中断確認
   ============================================================ */
function confirmExitCooking() {
  var ok = window.confirm(
    '調理を中断しますか？\n工程の進捗はリセットされます。\n\n' +
    'Abort cooking?\nStep progress will be reset.'
  );
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
  document.getElementById('complete-menu-name').textContent =
    state.selectedMenu.name;

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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
