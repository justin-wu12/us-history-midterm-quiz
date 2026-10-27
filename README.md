# 美國史 Kahoot 刷題

GEAE 2348《History and Development of the United States》期中考 Kahoot 題庫練習站。

- 題庫共 **120 題**：Pre-Test 30 題 + Lecture 2–7 各 15 題（照講義原文），每題附**中文詳解**、易混淆選項與記憶法。
- **隨機抽考**：選範圍（單元）、題數（10／20／30／50／全部）。選完立刻顯示對錯與詳解。
- **錯題重練、弱點加強**：依你最近的作答紀錄抽題。
- **Kahoot 計時**（選用）：每題 20 秒，時間到算答錯。
- **一輪結束後的分析**：各單元／主題／題型的答對率、最弱的 3 個主題（附重點複習）、常錯題型的練習建議、答錯題目與詳解。
- **累積弱點分析**：以每題「最近一次」的結果計算目前掌握度。
- **題庫詳解**：全部題目可依單元、主題、關鍵字搜尋，也可只看「最近答錯」或「Identification 相關」的題目。
- **時間軸**：題目考過的年份與事件，按時間排序，可跳到對應題目。

練習紀錄只存在你自己的瀏覽器（localStorage），不會上傳。換瀏覽器或清除網站資料就會歸零。

## 使用

直接用瀏覽器開 `index.html` 即可（不需要伺服器、不需要網路）。

## 檔案結構

```
index.html          頁面骨架
css/style.css       樣式（含深色模式）
js/app.js           抽題、作答、分析、分頁
js/meta.js          單元、主題（含重點複習）、題型、時間軸
data/q-*.js         題庫（每個單元一個檔案）
```

## 修改題庫

每題的格式如下（`a` 是正確選項的索引，0 = A … 3 = D）：

```js
{id:'L3-05', u:'L3', t:'revolution-road', k:'date',
 q:`The Boston Tea Party occurred in:`,
 o:[`1770`,`1773`,`1775`,`1776`], a:1,
 e:`詳解…`, w:`易混淆選項…`, m:`記憶法（可省略）`, ident:`期中 Identification 項目（可省略）`}
```

`t`（主題）必須是 `js/meta.js` 裡 `TOPICS` 的 key，`k`（題型）必須是 `TYPES` 的 key：`date`、`person`、`doc`、`event`、`thing`、`concept`。

## 部署到 GitHub Pages

Settings → Pages → Source 選 `main` 分支、`/ (root)`。
