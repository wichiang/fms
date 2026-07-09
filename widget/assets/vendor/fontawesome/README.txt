此目錄已改為內建自架的 Font Awesome Free SVG 相容層。

用途：
- 供前端 Widget 與前端後台使用本機圖示資源
- 避免正式環境依賴外部 CDN
- 避免 webfont / QUIC / 防火牆 / 連外限制造成圖示失效

實作方式：
- 使用 Font Awesome Free 官方 SVG 素材
- 以 CSS mask data URI 方式建立相容層
- 不依賴外部 CDN，也不依賴 webfont 載入

目前已補齊本產品實際使用到的 icon 類別。
若後續新增新的 fa-* icon，請同步更新本目錄 css。
