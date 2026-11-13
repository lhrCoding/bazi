# 出生地表构建（TASKS T40）

生成 `packages/core/src/geo/places.data.ts`（生成文件，勿手改）。原始数据不进仓库，按下面步骤下载到任意目录后运行：

```bash
npx tsx scripts/geo/build-places.ts <原始数据目录> <下载日期 YYYY-MM-DD>
```

## 数据来源与许可

| 文件 | 内容 | 来源 | 许可 |
|---|---|---|---|
| `mca2024.html` | 县以上行政区划代码与名称（县级 2,846、地级 333、省级 34） | 民政部《2024 年中华人民共和国县以上行政区划代码》https://www.mca.gov.cn/mzsj/xzqh/2025/202401xzqh.html | 政府公开信息（事实数据） |
| `six.csv` | 6 位代码（县级）+ 坐标 | Wikidata SPARQL（P442 中国行政区划代码、P625 坐标） | CC0 1.0（公有领域） |
| `upper.csv` | 2 / 4 位代码（省级 / 地级）+ 坐标 | Wikidata SPARQL | CC0 1.0 |
| `cities15000.txt` | 台湾主要城市、海外城市的经度与时区 | GeoNames https://download.geonames.org/export/dump/cities15000.zip | **CC BY 4.0，网站需署名「地理数据部分来自 GeoNames」**（放在隐私说明 / 关于页，T46） |
| — | 拼音 | 构建时由 `pinyin-pro`（MIT，开发依赖）生成 | MIT |

注：国家统计局自 2024 年 10 月起不再公开统计用区划代码，故名单以民政部为准。

## Wikidata 查询（https://query.wikidata.org/sparql，Accept: text/csv）

`six.csv`：
```sparql
SELECT ?item ?code ?coord WHERE {
  ?item wdt:P442 ?code .
  FILTER(STRLEN(REPLACE(?code, " ", "")) = 6)
  OPTIONAL { ?item wdt:P625 ?coord . }
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved . }
}
```
`upper.csv`：把 `= 6` 换成 `IN (2, 4)`。（Wikidata 中代码带空格，如「23 11 83」；带中文标签的大查询会超时，所以不取标签，名称一律以民政部为准。）

## 坐标取舍

- 一个代码在 Wikidata 有多个坐标：≥ 2 个点相差 < 0.05° 时取这一簇均值（多数，通常为驻地）；否则取全体均值并标 `low`。
  低精度清单写在 `low-precision.txt`（本次 56 条，含台湾省整体），待人工对照地图修正。
  尝试过用 Wikidata P36（政府驻地）与 GeoNames ADM3 / PPLA3 消歧：覆盖不足且有错误数据，未采用。
- 地级在 Wikidata 无坐标（本次只有海东市）：取辖下代码最小的区县（驻地区，海东市驻乐都区）。
- 时区：内地一律 Asia/Shanghai（含新疆，出生证一般记北京时间，calendar.md §5）；港 / 澳 / 台各自时区；海外取 GeoNames。
- 精度抽查：`packages/core/test/places.test.ts` 用 10 个城市与 GeoNames 独立比对，误差 ≤ 0.05°（最大 0.04°，哈尔滨）。

## 更新数据时

1. 重新下载上面 4 个文件，运行构建脚本。
2. `packages/core/test/fixtures/place-codes.txt` 是代码基准：**只追加新代码，不删除旧行**；测试会检查基准中每个代码仍然存在。
   民政部撤销的区县要保留在表中（老订单的链接里可能用到），只是不再出现在搜索结果的优先位置（如需要可加 `retired` 标记）。
3. 经度变化会改变真太阳时：按 `packages/core/src/bazi/version.ts` 的规则提升 ENGINE_VERSION、更新快照与版本摘要。
