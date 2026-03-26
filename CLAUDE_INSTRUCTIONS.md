# UNI献立ナビ - Claude指示書

## プロジェクト概要
介護施設の厨房スタッフがiPad/iPhoneで調理手順をステップごとに確認するPWAアプリ。
管理者3名がadmin.htmlからメニューや手順を管理する。

## URL
- ユーザー画面：https://junjuuun1974-max.github.io/uni-kondate-navi/
- 管理画面：https://junjuuun1974-max.github.io/uni-kondate-navi/admin.html
- GitHubリポジトリ：https://github.com/junjuuun1974-max/uni-kondate-navi

## ファイル構成
- index.html：ユーザー向けトップ画面
- admin.html：管理者用パネル（パスワード保護）
- sw.js：Service Worker（キャッシュ管理）

## 管理画面について
- パスワード：uni2026
- モバイル対応はCSSだけでは不十分なため、JavaScriptで制御している
  - #mobile-topbar 要素をJSで動的に表示
  - サイドバーはメディアクエリで非表示
- メニューテーブルはモバイルでカード表示（data-label属性を使用）

## ホーム画面の機能
- 日付ピッカーで日付を選択できる
- 食事時間帯を複数選択できる（toggleMealTime / state.selectedMealTimes配列）

## 手順写真について
- ファイル選択・カメラ撮影・URL入力の3種類に対応
- 表示はobject-fit:contain＋黒背景で全体が見えるように表示

## Service Worker（sw.js）について
- キャッシュバージョンは現在 v8
- 画面が更新されない場合は CACHE_VERSION を1つ増やして保存する
- 変更が反映されない原因のほとんどはキャッシュ問題

## データ形式
- 日付：YYYY-MM-DD（例：2026-03-26）
- バックエンド：Supabase

## キャッシュクリアの方法
- PC：Ctrl+Shift+R
- iPhone/iPad：設定 → Safari → 履歴とWebサイトデータを消去
- 必要に応じてブラウザコンソールでlocalStorageもリセット

## Claudeへのお願いの基本ルール
1. 手順は必ず番号付きで書く
2. GitHubへのアップロードはWebブラウザのみ（ターミナル不使用）
3. ファイル変更後は必ずキャッシュクリアを案内する
4. コードを変更した場合はファイル全体を提示する

## よく使う指示の例
- 「〇〇の機能を追加したい。どこを変えればいいですか？」
- 「変更後のindex.htmlのコード全体を見せてください」
- 「sw.jsのキャッシュバージョンを更新してください」
- 「画面が更新されない場合はどうすればいいですか？」
