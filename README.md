# 风险小帮手 · 报关合规自查（纯前端离线版）

> 从 `06-学习\customs-compliance-agent`（Flask/FastAPI + Function Calling + 通义千问）搬到浏览器的静态版：
> **零服务器、零 API Key、零大模型调用、成本归零**。

**本工具为关键词与规则匹配，不是大模型推理，结果仅供自查参考，不替代海关正式认定。**

---

## 1. 怎么用

双击 `index.html` 即可（`file://` 实测可用）。也可放任意静态托管（GitHub Pages / OSS / 内网 nginx）。

```
双击 index.html          → 直接用（无需服务器、无需联网）
python -m http.server  → 也可起本地服务访问 http://127.0.0.1:8000/
```

## 2. 四个功能（全部离线确定性匹配）

| Tab | 输入 | 匹配方式 | 数据源 |
|---|---|---|---|
| HS 编码查询 | 品名关键词 / 4–8 位税号 | 税号前缀 → 同义词表 → 品名子串+n-gram → 品目注释 → 归类决定品名索引；Dice 系数排序 | `data/hs.js`（8972 条 + 1228 条品目注释 + 1883 条品名索引） |
| 稽查风险自查 | 报关要素（品名/材质/用途/贸易方式…） | 38 条规则 × 关键词表 + 规则文本覆盖率打分；按 7 维度汇总权重与等级 | `data/risk.js`（38 规则 / 7 维度 / 19 部法规依据） |
| 法规检索 | 业务关键词 | 法规名/文号/条款/要点正文计分，正文命中次数加权 | `data/regs.js`（19 部） |
| 归类决定 | 品名 / 税号 | 品名完全一致 > 含税号前缀 > 描述/依据命中；同名多税号自动提示 | `data/decisions.js`（1956 条）+ `data/boundary.js`（26 条边界规则） |

每个结果都带来源：税则年份、法规名+文号+条款+官方链接、归类决定编号+公告号+年份。

## 3. 文件

```
index.html            页面（单页 + 4 个 tab）
assets/style.css      深色样式（#101214 / #181b1f / #262a30 / #e8e6e1 / #9a978f / #a63a2a）
assets/app.js         全部逻辑：数据访问、检索算法、渲染、tab、按需加载
data/hs.js            691,698 B  8972 条税则（行数组 + 分类/品目字典）+ 1883 条品名索引
data/decisions.js     646,224 B  1956 条归类决定（描述截断 120 字 / 依据截断 160 字）
data/boundary.js       23,184 B  26 条归类边界规则
data/risk.js           18,228 B  38 条风险规则 + 7 维度 + 关键词表 + 法规依据
data/regs.js            8,546 B  19 部法规全文要点
data/meta.js              219 B  体积元信息（页脚显示）
build_data.py         从源项目 data/ 生成上述 data/*.js（可重跑）
verify.mjs            puppeteer 验收脚本（http + file 两种打开方式）
verify_report.json    最近一次验收结果
screenshots/          验收截图（01 首页 / 02 HS冻鸡爪 / 03 风险锂电池 / 04 归类决定 / 05 file:// 蚕蛹 / 06 手机）
```

**数据总计 1.37 MB（≤ 3 MB 上限）。**
首屏只同步加载 `data/hs.js`；`risk/regs/boundary` 用 `defer`；`decisions.js`（646 KB）首次切到「归类决定」tab 时才注入，空闲时预取。

## 4. 重建数据

```powershell
python build_data.py            # 默认读源项目 data/，输出到 ./data/
python build_data.py --src <源 data 目录>
```

生成时会打印每个文件的条目数与字节数、总计、是否超 3 MB，并做一次密钥自检。

安全边界：
- 只读白名单 7 个 JSON（`hs_codes_full / hs4_descriptions / rules / dimensions / regulations / classification_decisions / boundary_rules`）。
- **不读** `.env`、`api_keys.db`、`decision_vectors.npz`，产物不含任何 key/token 字段；`build_data.py` 末尾用正则扫 `sk-` / `api_key=` / `dashscope` / `access_token` / `bearer` 等模式复核。

## 5. 与旧版（LLM 版）的差异（不夸大）

| 能力 | 旧版 | 本版 |
|---|---|---|
| 意图理解 / 追问 | 大模型 ReAct 追问 4 要素 | 无。改为固定表单 + 关键词匹配，命中依据全部打印出来（关键词 / 规则文本） |
| 语义检索 | 536 条向量索引（bge）兜底 | 无向量。用「归类决定品名索引 + n-gram + Dice」兜底，可解释、可复现 |
| 风险评分 | 33 题问卷 + 规则权重（`evaluate`） | 关键词/要素文本打分（`quick_scan` 思路），7 维度权重与等级口径沿用 |
| 数据 | 全量 JSON + 8 MB 向量库 | 裁剪后 1.37 MB，无向量库 |
| 运行 | 服务器 + API Key + 按次计费 | 静态文件，0 元、0 请求、数据不出本机 |

## 6. 验收（本轮实测）

```powershell
python build_data.py                      # 5 个文件 + meta.js，合计 1,387,880 B → PASS
python -m http.server 8765                # 本地服务
node verify.mjs                           # http + file 双路径验收，输出 verify_report.json
```

| 项 | 结果 |
|---|---|
| HS「冻鸡爪」 | 1 条 → 0207.1422（+2 条归类边界规则提示） |
| HS「蚕蛹」 | 2 条 → 0410.0090（决定原文税号）/ 1602.9090 |
| 风险「锂电池」 | 4 条命中（F1 F4 B2 B6），7 维度全部渲染，中风险 |
| 风险「化妆品」 | 4 条命中（A3 F1 B2 F2），中风险 |
| 法规「稽查」 | 1 条 → 海关稽查条例实施办法（第二十五条至第二十七条） |
| 归类决定「冻煮蚕蛹」 | 4 条 → J2022-0001 1602.9090 / J2018-0001 0410.0090 + 同名多税号提示 |
| 空结果 | 有独立提示块 + 可点示例词，不留空白 |
| 控制台 | http / file 均为 0 error / 0 warning / 0 pageerror / 0 请求失败 |
| 网络请求 | 仅本地文件（http 下 `externalRequests: []`），源码无 fetch / XHR / WebSocket |

## 7. 已知限制

1. 描述性长文本按 120/160 字截断（274 条被截断，结尾有 `…`），细节请查公告原文。
2. 税则 `import_tariff` 字段里 2366 条为 0.0，可能是从量税或零关税（源数据只存从价税率），页面已提示核对原文。
3. 少量归类决定的税号（如 0410.0090）在 2026 税则中已细分，页面按「决定原文税号」标注而不猜映射。
4. 规则命中的等级（中/高）只反映「命中规则的权重」，不代表实际违法风险概率。
