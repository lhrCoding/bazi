# hko-solar-terms：香港天文台节气时刻（T12 权威抽查）

- 来源：香港天文台「二十四節氣的日期及時間資料」<https://www.hko.gov.hk/tc/gts/astronomy/Solar_Term.htm>
- 原始数据：该页面脚本读取的 `https://www.hko.gov.hk/tc/gts/astronomy/data/files/24SolarTerms_{YEAR}.xml`
- 取数日期：2026-10-30。当日可下载 2019–2028 年；2010–2018、2029、2030 年返回 404，所以只有这 10 年（240 条）。
- 时区：香港时间 = UTC+8（来源页原文「以上的時間是香港時間，即協調世界時加 8小時。」），与北京标准时间相同。
- 精度：只到分钟，来源未说明取整方式；测试容差 ±60 秒。
- 转换：`hko-2019-2028.json` 由上述 XML 逐条机械转换，日期与时刻未改动；XML 不含节气名，名称按来源页 `Terms_A1` 数组顺序（小寒 … 冬至）补上并转为简体。
- 用途：`test/jieqi.test.ts` ②。不得用 tyme4ts / lunar-javascript 的输出补充或替换本目录数据。
