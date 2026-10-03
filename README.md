# LifeTrace Desktop

LifeTrace 应用端，包括 Tauri 桌面程序、React UI、本地 SQLite、本地照片/私密相册能力、局域网服务以及浏览器版本。

## 安装

```powershell
npm ci
```

## 开发

```powershell
npm run dev
```

浏览器版本：

```powershell
npm run browser:dev
```

## 验证

```powershell
npm run lint
npm run test:unit
npm run web:build
npm run browser:build
npm run test:rust
```

## 构建 Windows 应用

```powershell
npm run build
```

应用端依赖仓库根目录的共享 Rust crates（`../../crates`）以及生成契约（`../../contracts`），但不依赖 `services/cloud` 的内部实现。与云端通信只通过公开 API/同步协议完成。


## Travel 地图

Desktop 的 Travel 模块是 local-first：Place、Visit、Trip 与照片地图关联保存在本机 SQLite；原始照片仍由照片模块管理。

### 在线 / 自托管底图

默认使用 MapLibre 示例 style。构建前可通过环境变量覆盖：

```powershell
$env:VITE_TRAVEL_MAP_STYLE_URL="https://maps.example.com/style.json"
npm run dev
```

`VITE_TRAVEL_MAP_STYLE_URL` 是前端构建/开发时配置。

### 离线 PMTiles

Travel 顶部的“离线地图”按钮可以选择本机 `.pmtiles` 文件。LifeTrace 会把文件复制到自己的数据目录：

```text
<travel data dir>/travel/offline-map.pmtiles
```

原始 PMTiles 文件不会被移动或删除。安装后地图会优先使用本机 PMTiles；移除离线地图后自动回到 `VITE_TRAVEL_MAP_STYLE_URL` 或默认在线 style。

当前支持：

- Vector MVT PMTiles（需要包含 `vector_layers` metadata，以便 LifeTrace 自动生成基础样式）
- Raster PNG / JPEG / WebP / AVIF PMTiles
- 本机 HTTP Range 读取；不会把整个 PMTiles 文件一次性加载到内存

如果离线包损坏或格式暂不支持，地图会显示原因并回退到在线底图，Travel 数据本身不受影响。

### 反向地理编码

双击地图创建 Place 或从 GPS 照片创建 Place 时，可使用 Nominatim-compatible 反向地理编码服务：

```powershell
$env:LIFETRACE_TRAVEL_GEOCODER_URL="https://nominatim.example.com"
npm run dev
```

设置为 `off` 或 `disabled` 可关闭。未配置时使用当前默认服务。请求有串行限流与坐标缓存。

### 道路路线

Trip 路线默认始终可以用站点直线离线显示。若要按真实道路计算，可配置 OSRM-compatible Route API：

```powershell
$env:LIFETRACE_TRAVEL_ROUTER_URL="https://router.example.com"
npm run dev
```

路线页中的“加载道路路线”按钮才会发出请求。未配置、断网或服务返回 NoRoute 时，会保留原有直线，不阻断 Travel 使用。

### 照片定位与历史 EXIF

新导入照片会读取 EXIF 拍摄时间和 GPS。历史照片由低优先级后台索引器渐进补齐，不再在打开 Travel 照片选择器时阻塞扫描。已有用户时间/GPS 不会被覆盖。
