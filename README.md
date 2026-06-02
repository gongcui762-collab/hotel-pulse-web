# Hotel Pulse · Netlify Web

出境酒店价格脉搏系统的纯静态 dashboard，部署在 Netlify。

## 数据来源

本仓库的 `data/` 目录由后端仓库（rate_pulse）的 `scripts/export_static_data.py` 自动生成。
**不要手动编辑 `data/` 下的文件**——会被下次导出覆盖。

更新流程：

```
[后端 Mac]  scheduler 跑批 → SQLite
            ↓
            python -m scripts.export_static_data
            ↓
            写到 ../hotel-pulse-web/data/
            ↓
            git add data && git commit && git push
            ↓
[GitHub]    收到 push
            ↓
[Netlify]   webhook 触发，自动重新发布
            ↓
[公网]      hotel-pulse.netlify.app 即时更新
```

## 本地预览

无 build 步骤、无依赖。任意静态服务器都能跑：

```bash
# 方式 1：Python（最方便）
cd hotel-pulse-web
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000

# 方式 2：Node
npx serve

# 方式 3：直接 file:// 打开 index.html
# ⚠️ 不行 —— ES Module + fetch JSON 需要 HTTP 协议，file:// 会被浏览器 CORS 拦
```

## 文件结构

```
.
├── index.html              主页（KPI bar + tab nav + 5 tab 容器）
├── css/
│   └── style.css           复刻 Streamlit 暗黑主题
├── js/
│   ├── main.js             启动入口 / 数据加载 / tab 切换 / 全局工具
│   └── tabs/
│       ├── heatmap.js      🗺 热度地图（Plotly heatmap）
│       ├── holidays.js     🎉 节假日窗口热度对比
│       ├── drilldown.js    🔍 单点钻取（事实先行）
│       ├── hotels.js       🏨 100 家酒店清单
│       └── data-health.js  ⚙ FlyAI 健康度 + 数据完整度
├── data/                   ← 自动生成，勿动
│   ├── meta.json
│   ├── snapshots/
│   │   ├── index.json
│   │   └── <YYYY-MM-DD>.json
│   └── _generated_at.json
└── netlify.toml            Netlify 部署配置
```

## 字段约定（前后端契约）

数据 JSON 字段名故意短，节省 bytes：

| 短名 | 含义 |
|---|---|
| `hid`   | hotel_id |
| `ci`    | checkin_date |
| `lvl`   | price_level (A 维) |
| `so`    | sold_out_ratio (B 维) / is_sold_out |
| `out`   | is_outlier |
| `delta` | (price - p50) / p50 |

完整字段定义见 `scripts/export_static_data.py`。

## 视觉规范

- **底色**: `#0e1117`（与 Streamlit 暗黑一致）
- **强调色**: `#ff6b35`（橙色，KPI / 节假日 / active tab）
- **热度档位色**:
  - 🔵 < 35：`#4a9eff`
  - 🟢 35-65：`#4caf50`
  - 🟡 65-85：`#ffc107`
  - 🔴 ≥ 85：`#d32f2f`

## TODO（v1 之后）

- [ ] 移动端纵向布局优化
- [ ] 热度地图导出 PNG
- [ ] 单点钻取加 7 天价格趋势小图
- [ ] 简单密码门（querystring secret）

## License

Internal use only.
