# LifeTrace Desktop 足迹地图功能设计方案（Map of Us 参考版）

> 状态：Draft  
> 目标项目：`LifeTraceManage/LifeTrace-desktop`  
> 参考项目：Map of Us  
> 当前阶段：需求与架构设计

## 1. 背景

LifeTrace Desktop 已经具备：

- Tauri 2 桌面运行环境
- React 19 前端
- Rust + Axum 本地服务
- SQLite 本地数据库
- 照片同步与照片库
- 图片缩略图 / 媒体访问能力
- 后台 EXIF 索引
- 照片拍摄时间解析
- EXIF GPS 经纬度解析
- 本地文件存储
- 云端账号与同步基础设施
- 笔记、照片、日历、分析等已有模块

因此，不应该把 Map of Us 整个项目嵌入 LifeTrace，也不应该重新开发一套照片存储、EXIF、登录或本地数据系统。

本功能应在 LifeTrace 已有基础设施上新增一个：

**“足迹地图 / Footprints”空间化人生记录模块。**

核心关系：

```text
地图
 ↓
省 / 市 / 地点
 ↓
一次或多次到访记录
 ↓
照片 + 日期 + 文字 + 笔记
```

地图只是这些人生记录的可视化入口。

---

## 2. Map of Us 值得参考的部分

Map of Us 的主要设计包括：

```text
中国地图
 ├─ 已访问省份点亮
 ├─ 点击省份
 │    └─ 进入省份详情
 │          └─ 城市
 │               └─ Memory
 │                    ├─ 日期
 │                    ├─ 描述
 │                    └─ 多张照片
 │
 ├─ 回忆归档
 ├─ 最近回忆
 └─ 地图统计
```

其产品理念非常适合 LifeTrace：

> 地点不是一个 Pin，而是一组人生记忆的容器。

但 LifeTrace 不应该直接复制 Map of Us。

---

## 3. LifeTrace 中的产品定位

建议新功能名称：

**足迹**

英文内部名称：

```text
Footprints
```

不建议继续使用：

```text
Travel
```

原因是之前的 Travel 模块包含较多地图、PMTiles、LocationPicker、TravelRecord 等历史设计包袱。

重新实现时建议形成新的独立领域：

```text
Footprint
```

而不是恢复旧 Travel 模块。

导航建议放在：

```text
记录

笔记
照片
足迹
邮件
```

最终结构：

```text
记录
├── 笔记
├── 照片
├── 足迹
└── 邮件
```

---

## 4. 第一版核心体验

用户打开：

```text
记录 → 足迹
```

首先看到一张中国地图。

示意：

```text
┌────────────────────────────────────────────────────┐
│ 足迹                            23 城 · 9 省 · 386 张照片 │
├────────────────────────────────────────────────────┤
│                                                    │
│                    中国地图                         │
│                                                    │
│        四川       湖北                              │
│          ████      ███                              │
│                                                    │
│                  广东 ████                          │
│                                                    │
│          已去过省份高亮                             │
│                                                    │
├────────────────────────────────────────────────────┤
│ 最近足迹                                            │
│ 成都 2026.05       上海 2026.02       深圳 2025.12 │
└────────────────────────────────────────────────────┘
```

点击四川：

```text
四川省

去过 4 个城市
12 次记录
143 张照片

成都
2024.05 / 2025.02 / 2026.05
58 张照片

乐山
2025.05
18 张照片

阿坝
2024.10
42 张照片
```

点击成都：

```text
成都

━━━━━━━━━━━━━━━━━━

2026.05.01 - 2026.05.04

五一成都

[photo] [photo] [photo] [photo]

吃了很多东西。
第一次去了青城山……

━━━━━━━━━━━━━━━━━━

2025.02.11

春节成都

[photo] [photo]

……
```

这就是第一版最核心的产品闭环。

---

## 5. 地图首页

建议实现：

```text
FootprintMapView
```

页面组成：

```text
FootprintMapView
├── FootprintSummary
├── ChinaMap
├── ProvinceTooltip
├── MapControls
├── RecentFootprints
└── FootprintStats
```

### 5.1 中国地图

第一阶段直接使用：

```text
SVG + GeoJSON / TopoJSON
```

或者参考 Map of Us：

```text
D3 Geo + SVG
```

支持：

- 中国省级行政区
- Hover
- 点击
- 缩放
- 平移
- 自动适应窗口
- Dark Mode
- 已访问省份高亮
- 未访问省份弱化
- 不同访问频度显示不同视觉强度

### 5.2 地图交互规则

地图镜头操作和行政层级导航必须分离：

```text
滚轮 / +/-        → 只缩放当前地图
拖拽              → 只平移当前地图
单击省份          → 选中省份并更新右侧详情
双击省份          → 进入该省的市 / 地区级地图
查看省内地图      → 与双击省份等价的显式备用入口
返回全国          → 返回全国地图并清空旧省份 / 城市选择
点击城市          → 选中城市并筛选右侧足迹
重置              → 只重置当前层级的缩放和平移
```

禁止把缩放手势同时作为行政层级导航：

```text
滚轮放大到阈值自动进入省份
滚轮缩小到底自动返回全国
```

双击省份是明确的层级导航手势，不改变滚轮的镜头语义。桌面端同时使用两条兼容路径：
第二次 `click` 的 `event.detail >= 2` 立即进入下一级，同时保留原生 `dblclick` 作为兜底。
任意一条被当前 WebView 正确派发都可以完成下钻，避免单一路径在不同 Windows / WebView
环境下失效。单击选中省份时不得重置当前缩放和平移，只有真正切换全国 / 省内行政层级时
才重置镜头。

当前数据只到市 / 地区级，因此双击城市暂不继续下钻。地图层级由页面语义状态统一管理，
`ChinaMap` 只维护缩放、平移、hover 和拖拽等镜头状态；退出省内地图时必须同步清理旧选择和临时交互状态。

### 5.3 第一版不建议使用地图瓦片

Map of Us 的核心中国地图并不需要 Mapbox / 高德 / Google Maps。

LifeTrace 第一阶段也没有必要引入：

```text
Mapbox
MapLibre
Leaflet
PMTiles
```

因为：

```text
“我去过四川、成都、乐山”
```

这类功能 SVG 地图已经足够。

只有未来需要：

```text
具体 POI
街道
GPS 轨迹
大量地点 Marker
真实地图底图
```

时再进入地图瓦片体系。

---

## 6. 省份状态

每个省份需要计算：

```ts
ProvinceFootprintSummary {
  provinceCode
  provinceName

  visited
  cityCount
  visitCount
  photoCount

  firstVisitedAt
  lastVisitedAt
}
```

例如：

```json
{
  "provinceCode": "510000",
  "provinceName": "四川",
  "visited": true,
  "cityCount": 4,
  "visitCount": 9,
  "photoCount": 143,
  "firstVisitedAt": "2022-05-01",
  "lastVisitedAt": "2026-05-04"
}
```

地图不自己维护访问状态。

应该由数据库统计结果驱动：

```text
Footprint records
        ↓
Province aggregation
        ↓
Map highlight
```

---

## 7. 城市详情

点击省份后建议不要立即跳新页面。

桌面端更适合：

```text
地图 + 右侧详情面板
```

示意：

```text
┌────────────────────────────┬────────────────────┐
│                            │ 四川               │
│                            │                    │
│        中国地图            │ 去过 4 城          │
│                            │                    │
│                            │ 成都       58 照片 │
│                            │ 乐山       18 照片 │
│                            │ 阿坝       42 照片 │
│                            │ 绵阳       25 照片 │
│                            │                    │
└────────────────────────────┴────────────────────┘
```

组件：

```text
ProvinceDrawer
CityFootprintCard
CityStats
```

---

## 8. 地点模型

地图系统需要一个统一地点表。

建议：

```text
footprint_locations
```

字段：

```text
id

country_code
country_name

province_code
province_name

city_code
city_name

district_code
district_name

place_name

latitude
longitude

source

created_at
updated_at
```

其中：

```text
province / city
```

是行政区域。

而：

```text
place_name
latitude
longitude
```

允许以后保存：

```text
成都
宽窄巷子
成都东站
青城山
某酒店
某餐厅
```

第一版 UI 可以只开放：

```text
省 → 市
```

但数据库不要限制死。

---

## 9. 足迹记录

真正重要的数据不是地点，而是：

```text
我什么时候去了这个地方。
```

建议表：

```text
footprint_entries
```

字段：

```text
id

location_id

title
description

started_at
ended_at

visit_type

rating
favorite

created_at
updated_at
deleted_at
```

例如：

```json
{
  "locationId": "chengdu",
  "title": "五一成都",
  "description": "第一次去了青城山。",
  "startedAt": "2026-05-01",
  "endedAt": "2026-05-04"
}
```

同一个城市可以有多条记录：

```text
成都

2022 第一次去
2024 出差
2025 春节
2026 五一
```

而不是简单记录：

```text
visited = true
```

这是 LifeTrace 与普通“点亮地图”应用之间最重要的区别。

---

## 10. 照片绑定

这一部分应该尽可能复用 LifeTrace 当前照片系统。

当前 `photos` 数据已经包含：

```text
captured_at
latitude
longitude
exif_scanned_at
```

因此绝对不应该重新实现：

```text
TravelPhoto
TravelExif
TravelGPSParser
```

建议新增关系表：

```text
footprint_entry_photos
```

结构：

```text
entry_id
photo_id
sort_order
is_cover
created_at
```

关系：

```text
photos
   ↑
   │
footprint_entry_photos
   │
   ↓
footprint_entries
```

照片本身仍然只有一份。

足迹模块只维护引用。

---

## 11. EXIF 自动发现足迹

这是 LifeTrace 相比 Map of Us 更值得做的功能。

因为 LifeTrace 已经在后台解析：

```text
照片时间
GPS latitude
GPS longitude
```

所以用户进入足迹页面时，可以出现：

```text
发现新的地点
```

例如：

```text
发现 126 张具有定位信息的照片

成都
2026.05.01
35 张照片

重庆
2026.05.04
22 张照片

上海
2026.07.18
47 张照片

[生成足迹]
```

基本流程：

```text
Photos
 ↓
EXIF GPS
 ↓
坐标聚类
 ↓
行政区反向解析
 ↓
候选地点
 ↓
用户确认
 ↓
Footprint Entry
```

第一阶段可以只做：

```text
已有 GPS → 推荐地点
```

不要自动写数据，必须让用户确认。

---

## 12. 手动创建足迹

提供：

```text
+ 添加足迹
```

弹窗：

```text
添加足迹

地点
[ 四川 / 成都                  ]

日期
[2026-05-01] - [2026-05-04]

标题
[ 五一成都                    ]

描述
[                             ]

照片
[选择照片]

              取消    保存
```

第一版 Location Picker 可以非常简单：

```text
国家
省份
城市
```

不要重新开发过去复杂的 Travel LocationPicker。

---

## 13. 从照片创建足迹

照片模块增加一个动作：

```text
添加到足迹
```

例如选择 30 张照片：

```text
30 张照片

添加到足迹

○ 创建新足迹
○ 添加到已有足迹
```

如果照片存在 GPS：

```text
检测到多数照片拍摄于：
四川省 成都市

是否使用该地点？
```

这样：

```text
照片
```

与：

```text
足迹
```

真正形成联动。

---

## 14. 照片自动推荐

打开某条足迹：

```text
成都
2026.05.01 - 2026.05.04
```

系统可以根据：

```text
时间
+
GPS
```

查找尚未关联照片：

```text
可能属于这次足迹

发现 18 张照片

[全部添加]
```

优先匹配规则：

```text
时间在 visit 范围内
AND
GPS 位于城市行政区域附近
```

其次：

```text
只有时间匹配
```

后者不能自动添加，只能推荐。

---

## 15. 回忆时间线

除地图外建议增加第二种视图：

```text
地图 | 时间线
```

时间线：

```text
2026

05
成都
35 张照片

02
上海
62 张照片


2025

12
深圳
48 张照片

08
长沙
21 张照片
```

地图负责：

```text
Where
```

时间线负责：

```text
When
```

---

## 16. 回忆详情

`FootprintEntryDetail`：

```text
成都

2026.05.01 - 05.04

五一成都

━━━━━━━━━━━━

照片墙

□ □ □ □
□ □ □ □
□ □ □ □

━━━━━━━━━━━━

这次第一次去了青城山……

━━━━━━━━━━━━

关联笔记

《成都四日游记录》

━━━━━━━━━━━━

位置

四川 · 成都
```

---

## 17. 与笔记模块联动

LifeTrace 已经有笔记系统。

所以不应该让足迹 description 变成复杂富文本编辑器。

建议：

```text
description
```

只负责短描述。

长内容使用：

```text
关联笔记
```

例如：

```text
成都 · 2026 五一

关联笔记

- 成都四日游
- 青城山游记
- 成都餐厅记录
```

可以复用 LifeTrace 已有 Entity Relation 思路。

以后可以支持：

```text
Footprint → Note
Footprint → Calendar
Footprint → Photo
```

---

## 18. 搜索

足迹页面应该支持：

```text
搜索地点 / 标题
```

例如：

```text
成都
```

结果：

```text
地点
成都 · 四川
4 次到访

足迹
五一成都
春节成都

照片
58 张
```

---

## 19. 统计

地图顶部可以展示：

```text
9 省
23 城
36 次旅行
386 张照片
```

后续增加：

```text
最常去城市
第一次旅行
最近旅行
今年去了几个城市
新增地点
照片最多地点
```

这些也可以接入 LifeTrace Analytics。

---

## 20. 首页联动

LifeTrace 首页以后可以增加：

```text
最近足迹
```

例如：

```text
最近足迹

成都
2026.05.01
35 张照片

查看地图 →
```

但不建议作为第一阶段必须项。

---

## 21. AI 联动

后期可以让 LifeTrace AI 管家使用足迹数据。

例如：

```text
我去年去了哪些地方？
```

或者：

```text
帮我回顾一下成都旅行。
```

AI 获取：

```text
footprint
notes
photos metadata
```

后生成回顾。

但这是 P2/P4 能力，不进入第一阶段。

---

## 22. 数据库设计

建议新增三个核心表：

```text
footprint_locations
footprint_entries
footprint_entry_photos
```

可选第四张：

```text
footprint_entry_links
```

用于关联：

```text
note
calendar_event
other entity
```

关系：

```text
footprint_locations
        │
        │ 1:N
        ▼
footprint_entries
        │
        ├─────────────┐
        │             │
        ▼             ▼
entry_photos      entry_links
        │             │
        ▼             ▼
     photos          notes
```

---

## 23. 后端模块

Rust 建议新增：

```text
src-tauri/src/footprints.rs
```

数据库 repository：

```text
src-tauri/src/database/repositories/footprints.rs
```

数据库 migration：

```text
src-tauri/src/database/migrations/m0018_footprints.rs
```

Server：

```text
src-tauri/src/server/footprints.rs
```

而不是重新创建整个 Travel 技术栈。

---

## 24. 本地 API

建议：

```text
GET    /api/footprints/summary

GET    /api/footprints/locations
POST   /api/footprints/locations

GET    /api/footprints/entries
POST   /api/footprints/entries

GET    /api/footprints/entries/:id
PUT    /api/footprints/entries/:id
DELETE /api/footprints/entries/:id

POST   /api/footprints/entries/:id/photos
DELETE /api/footprints/entries/:id/photos/:photoId

GET    /api/footprints/provinces
GET    /api/footprints/provinces/:code

GET    /api/footprints/photo-suggestions
```

后续增加：

```text
GET /api/footprints/timeline
GET /api/footprints/stats
```

---

## 25. 前端目录

建议：

```text
src/components/feature/footprints/
```

初步结构：

```text
footprints/
├── Footprints.tsx
├── FootprintMapView.tsx
├── FootprintTimelineView.tsx
├── ChinaMap.tsx
├── ProvinceDrawer.tsx
├── CityCard.tsx
├── FootprintEntryCard.tsx
├── FootprintEntryDetail.tsx
├── FootprintEditor.tsx
├── FootprintPhotoPicker.tsx
├── PhotoSuggestions.tsx
├── FootprintSummary.tsx
├── types.ts
└── footprintViewModel.ts
```

Service：

```text
src/services/footprintApi.ts
```

如果确实需要局部 UI 状态：

```text
src/stores/useFootprintStore.ts
```

但不要把数据库数据完整复制到 Zustand。

Server data 应作为 source of truth。

---

## 26. 导航修改

当前 `PlatformView` 增加：

```ts
| "footprints"
```

导航：

```text
记录
├─ notes
├─ photos
├─ footprints
└─ mail
```

标题：

```text
footprints: "足迹"
```

图标建议使用现有 `lucide-react`：

```text
MapPinned
```

或：

```text
Map
```

不需要增加新的 UI 依赖。

---

## 27. 地图数据

需要加入：

```text
中国省级行政区 GeoJSON / TopoJSON
```

建议路径：

```text
src/assets/maps/china-provinces.json
```

同时维护：

```text
provinceCode
provinceName
```

映射。

后续如果实现城市地图，再考虑：

```text
china-cities
```

第一阶段不要一次性引入全国区县级数据。

第一阶段：

```text
省级 SVG
+
城市列表
```

即可。

---

## 28. 行政区数据

建议建立统一：

```ts
interface AdministrativeRegion {
  code: string;
  name: string;
  level: "country" | "province" | "city" | "district";
  parentCode?: string;
}
```

数据库保存：

```text
code
+
name snapshot
```

避免只存名称导致重名城市、行政区域调整或名称变化问题。

---

## 29. GPS → 城市

建议分阶段。

### Phase 1

不自动反向地理编码。

照片 GPS：

```text
latitude
longitude
```

只用于：

```text
照片地点推荐
```

用户最终选择城市。

### Phase 2

增加本地行政边界 Point-in-Polygon：

```text
GPS
 ↓
城市 polygon
 ↓
cityCode
```

优点：

```text
完全离线
无需高德 API
无需百度 API
无需 Google API
不存在 API Key
不存在隐私上传
```

这符合 LifeTrace 本地优先定位。

---

## 30. 离线地图

仓库目前仍然可以看到：

```text
travel_offline_map_import
travel_offline_map_remove
```

并使用：

```text
travel/offline-map.pmtiles
```

这属于上一版 Travel 设计残留。

对于本方案，建议第一阶段删除或不使用。

因为省级记忆地图：

```text
SVG
```

完全不需要 PMTiles。

如果未来实现：

```text
街道地图
POI
轨迹
GPS Marker
```

再重新设计通用：

```text
MapOfflinePackage
```

而不是恢复：

```text
TravelOfflineMap
```

---

## 31. 不需要从 Map of Us 搬过来的内容

以下功能不建议照搬：

```text
Map of Us 双密码系统
情侣 Logo
登录九宫格
纪念日系统
沿途天气
Supabase 存储
Next.js API
Electron 桌面封装
自己的图片存储
自己的备份系统
自己的身份认证
```

因为 LifeTrace 已经有：

```text
账户
云同步
Tauri
SQLite
照片系统
文件系统
备份 / 存储基础
```

参考 Map of Us 的：

```text
产品形态
交互
地图
Memory 模型
```

即可，不进行代码整体移植。

---

## 32. 功能阶段划分

### P0 — 地图基础

完成：

```text
导航入口
中国地图
省份 Hover
省份点击
已访问省份点亮
地图缩放 / 平移
Dark Mode
```

做到这一阶段后，就可以看到完整产品雏形。

### P1 — 足迹 CRUD

加入：

```text
地点
足迹记录
日期
描述
城市详情
新建
编辑
删除
```

完成：

```text
地图 → 省 → 城市 → 足迹
```

完整闭环。

### P1.5 — 照片

加入：

```text
绑定照片
照片墙
封面
选择 LifeTrace 已有照片
从照片创建足迹
```

到这里基本达到 Map of Us 的核心能力。

### P2 — EXIF 智能化

加入：

```text
GPS 自动发现
时间自动聚类
地点推荐
照片推荐
待确认足迹
```

这是 LifeTrace 可以明显超越 Map of Us 的地方。

### P3 — 时间线与统计

加入：

```text
时间线
年度统计
城市统计
省份统计
最近足迹
照片最多地点
```

### P4 — LifeTrace 联动

加入：

```text
足迹 ↔ 笔记
足迹 ↔ 日历
足迹 ↔ AI
足迹 → Analytics
```

---

## 33. 第一版本建议范围

第一版本不要做得太大。

建议真正进入开发的 MVP：

```text
中国省级地图

已访问省份点亮

省份详情

城市列表

新增足迹

编辑足迹

删除足迹

到访日期

标题

简短描述

绑定已有照片

照片墙

地图 / 时间线切换
```

另外必须预留：

```text
GPS
行政区 code
note relation
```

但第一版不用全部实现 UI。

---

## 34. MVP 页面结构

```text
足迹
│
├── 地图
│    │
│    ├── 中国地图
│    │
│    ├── 省份详情
│    │
│    └── 城市
│          │
│          └── 足迹记录
│                ├── 日期
│                ├── 标题
│                ├── 描述
│                └── 照片
│
└── 时间线
     │
     ├── 2026
     ├── 2025
     └── ...
```

---

## 35. 推荐的数据生命周期

照片导入 LifeTrace：

```text
Phone / Folder
      ↓
LifeTrace Photos
      ↓
EXIF Indexer
      ↓
captured_at
latitude
longitude
      ↓
Footprint Candidate
      ↓
用户确认
      ↓
Footprint Entry
      ↓
Province / City Aggregate
      ↓
地图点亮
```

这样数据只有一个源头。

避免出现：

```text
Photos 有一份 GPS

Travel 又有一份 GPS

Footprint 再有一份 GPS
```

---

## 36. 云同步

LifeTrace 当前同时存在：

```text
Cloud Workspace
+
Local SQLite Offline Mode
```

足迹模块最终应进入正常同步体系。

建议业务实体考虑：

```text
footprint.location
footprint.entry
footprint.entry_photo
```

但第一阶段可以：

```text
先保证 Local SQLite 完整工作
```

再接 Cloud entity。

不建议地图 UI 与同步开发完全绑定，否则第一版复杂度会大幅上升。

---

## 37. 性能要求

照片很多时不能：

```text
地图页面启动 → 扫描所有照片 EXIF
```

因为当前后台已经完成 EXIF 索引。

地图应该只查询：

```sql
SELECT ...
FROM photos
WHERE latitude IS NOT NULL
AND longitude IS NOT NULL
```

并使用数据库索引。

建议增加：

```text
photos(captured_at)
photos(latitude, longitude)

footprint_entries(location_id)
footprint_entries(started_at)
footprint_entry_photos(entry_id)
footprint_entry_photos(photo_id)
```

---

## 38. 隐私原则

地图 / GPS 属于高隐私数据。

默认原则：

```text
不调用第三方定位服务
不上传 GPS 到地图供应商
不依赖在线地图
不自动公开任何地点
```

优先：

```text
本地 SVG
本地行政区数据
本地 Point-in-Polygon
SQLite
```

这与 LifeTrace 的桌面产品定位更一致。

---

## 39. 测试

需要增加：

```text
数据库 migration 测试
Footprint repository 测试
CRUD API 测试
省份统计测试
城市统计测试
照片关系测试
照片删除后的关系测试
EXIF suggestion 测试
GPS 边界测试
地图组件测试
```

尤其测试：

```text
删除足迹不能删除照片

删除照片只删除关联

一张照片可以属于多个关联场景

无 GPS 照片不能导致错误

损坏 EXIF 不影响地图
```

---

## 40. 最终目录变化

预计主要新增：

```text
src/
├── components/
│   └── feature/
│       └── footprints/
│
├── services/
│   └── footprintApi.ts
│
└── assets/
    └── maps/
        └── china-provinces.json


src-tauri/src/
├── footprints.rs
│
├── server/
│   └── footprints.rs
│
└── database/
    ├── repositories/
    │   └── footprints.rs
    │
    └── migrations/
        └── m0018_footprints.rs
```

同时修改：

```text
navigation.ts
HengXuShell / DesktopFeatureRouter
server.rs
lib.rs
migration mod
sync entity definitions
analytics entity definitions（后期）
```

---

## 41. 推荐最终产品形态

Map of Us 可以视为：

```text
旅行回忆地图
```

LifeTrace 不应该只做一个复制品。

LifeTrace 最终应该形成：

```text
                LifeTrace Footprints

                     地图
                      │
        ┌─────────────┼──────────────┐
        ↓             ↓              ↓
       地点          时间            照片
        │             │              │
        └─────────────┼──────────────┘
                      ↓
                    足迹
                      │
             ┌────────┼────────┐
             ↓        ↓        ↓
            笔记     日历      AI
```

也就是：

**把 LifeTrace 已有的照片、时间、笔记和未来 AI 能力，通过“地点”连接起来。**

---

## 42. 第一阶段验收标准

满足以下条件即可认为 Map of Us 风格的第一阶段已经完成：

1. 左侧导航出现“足迹”。
2. 可以看到完整中国地图。
3. 地图支持深色 / 浅色主题。
4. 已去过省份自动高亮。
5. 点击省份可以查看去过的城市。
6. 一个城市可以有多条足迹。
7. 足迹支持开始 / 结束日期。
8. 足迹支持标题和描述。
9. 足迹可以绑定 LifeTrace 已有照片。
10. 足迹详情显示照片墙。
11. 删除足迹不会删除原照片。
12. 地图统计可以正确显示省份、城市、足迹、照片数量。
13. 不依赖外部地图网络即可完成核心浏览。
14. 不重复实现 EXIF / GPS 解析。
15. 不恢复旧 Travel 模块的历史架构。

---

## 43. 建议开发顺序

```text
01 数据模型
 ↓
02 Migration / Repository
 ↓
03 Footprint API
 ↓
04 中国地图数据
 ↓
05 Footprints 页面骨架
 ↓
06 地图省份交互
 ↓
07 省 → 城市
 ↓
08 Footprint CRUD
 ↓
09 照片选择 / 关联
 ↓
10 照片墙
 ↓
11 时间线
 ↓
12 EXIF 地点推荐
 ↓
13 云同步
 ↓
14 Analytics / AI
```

---

## 44. 结论

这次不建议“把 Map of Us 加进 LifeTrace”。

正确方向是：

```text
参考 Map of Us 的产品模型

            +

复用 LifeTrace 已有基础设施

            ↓

LifeTrace Footprints
```

第一版重点只有四件事：

```text
地图
地点
足迹
照片
```

而 LifeTrace 已有的 EXIF GPS、SQLite、本地照片和未来 AI 能力，会让这个模块后续自然成长为比 Map of Us 更完整的“人生空间时间线”。
