/* 风险小帮手 · 离线报关合规自查
 * 纯静态、零网络：所有匹配在浏览器本地完成（编码前缀 / 品名关键词 / 规则权重打分）。
 * 数据由 build_data.py 从源项目 data/ 生成，形如 window.DATA_HS。
 * 无 fetch / XHR / WebSocket / 大模型调用。 */
(function () {
  'use strict';

  /* ==================== 基础工具 ==================== */

  var PUNCT;
  try { PUNCT = new RegExp('[\\s\\u3000\\p{P}\\p{S}_]+', 'gu'); }
  catch (e) {
    PUNCT = /[\s\u3000"'.,\/#!$%^&*;:{}=\-_`~()\[\]<>?\\|·、。，；：！？（）【】《》—…“”‘’]+/g;
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(PUNCT, '');
  }

  function bigrams(s) {
    var out = [];
    if (!s) return out;
    if (s.length === 1) return [s];
    for (var i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
    return out;
  }

  // Dice 系数（字符二元组），替代 Python difflib，确定性且无依赖
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var A = bigrams(a), B = bigrams(b), i;
    if (!A.length || !B.length) return 0;
    var m = Object.create(null), hit = 0;
    for (i = 0; i < A.length; i++) m[A[i]] = (m[A[i]] || 0) + 1;
    for (i = 0; i < B.length; i++) {
      if (m[B[i]]) { m[B[i]]--; hit++; }
    }
    return (2 * hit) / (A.length + B.length);
  }

  // 查询串在文档中最长的公共子串（≥2 字），用于「冻鸡爪」→「鸡爪」
  function longestSub(q, doc) {
    if (!q || !doc) return '';
    var max = Math.min(6, q.length);
    for (var L = max; L >= 2; L--) {
      for (var i = 0; i + L <= q.length; i++) {
        var s = q.substr(i, L);
        if (doc.indexOf(s) >= 0) return s;
      }
    }
    return '';
  }

  // 业务通用词：不参与「文本覆盖率」打分，避免「申报/货物」这类词把规则全点亮
  var GENERIC = {
    '申报': 1, '货物': 1, '商品': 1, '企业': 1, '公司': 1, '进口': 1, '出口': 1,
    '海关': 1, '报关': 1, '一批': 1, '采购': 1, '计划': 1, '涉及': 1, '情况': 1,
    '是否': 1, '风险': 1, '自查': 1, '请问': 1, '我们': 1, '这批': 1, '本次': 1,
    '一个': 1, '相关': 1, '管理': 1, '业务': 1, '以下': 1, '用于': 1, '产品': 1,
    '进口货物': 1, '报关单': 1, '需要': 1, '如何': 1, '哪些': 1
  };

  // 2~4 字滑窗切词（中文无空格，用 n-gram 代替分词）
  function tokenize(text) {
    var s = norm(text);
    var set = Object.create(null), out = [];
    for (var L = 4; L >= 2; L--) {
      for (var i = 0; i + L <= s.length; i++) {
        var t = s.substr(i, L);
        if (GENERIC[t]) continue;
        if (/^\d+$/.test(t)) continue;   // 纯数字串（税号片段/百分比）不参与文本匹配
        if (!set[t]) { set[t] = 1; out.push(t); }
      }
    }
    return out;
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = String(txt);
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtBytes(n) {
    return (n / 1048576).toFixed(2) + ' MB';
  }

  /* ==================== 基础查询词典 ==================== */

  // 与源项目 hs_classifier.py 同源的品名同义词（保留其口径，便于结果对齐）
  var SYNONYMS = {
    '口红': ['唇用化妆品', '唇膏'], '手机': ['智能手机', '移动电话'],
    '蓝牙耳机': ['无线耳机', '耳机'], '笔记本电脑': ['便携式电脑', '笔记本'],
    '平板电脑': ['平板电脑'], '充电宝': ['移动电源'], '红酒': ['葡萄酒'],
    '啤酒': ['麦芽酿造'], '水杯': ['塑料制餐具'], '咖啡': ['咖啡'],
    '不锈钢锅': ['不锈钢制'], '茶叶': ['绿茶', '红茶'], '奶粉': ['乳粉'],
    '巧克力': ['可可'], '运动鞋': ['鞋靴'], '背包': ['箱包'], '手表': ['腕表'],
    '相机': ['照相机', '摄像机'], '保温杯': ['真空', '保温'], '雨伞': ['阳伞'],
    '眼镜': ['太阳镜', '护目镜'], '不锈钢餐具': ['不锈钢制'], '石棉制品': ['石棉'],
    '肉包': ['包子'], '鸡胗': ['鸡盹', '鸡胃'], '熟鸡胗': ['鸡盹'],
    '橡胶雨靴': ['雨鞋'], '香水': ['香水'], '面膜': ['护肤'],
    '打印机': ['打印机'], '路由器': ['路由器'], '键盘': ['键盘'], '鼠标': ['鼠标'],
    '显示器': ['显示器'], '硬盘': ['硬盘'], 'u盘': ['闪存'], '充电器': ['变压器'],
    '数据线': ['电缆'], '尿不湿': ['尿布'], '纸巾': ['纸'], '牙膏': ['牙膏'],
    '洗发水': ['洗发'], '猫粮': ['饲料'], '狗粮': ['饲料'], '自行车': ['自行车'],
    '电动车': ['摩托车', '脚踏'], '玩具': ['玩具'], '药品': ['药品'], '大米': ['稻米'],
    '面粉': ['小麦'], '食用油': ['油'], '牛肉': ['牛肉'], '猪肉': ['猪肉'],
    '鸡肉': ['鸡肉'], '鸡爪': ['鸡爪'], '蚕蛹': ['蚕蛹'],
    // 税则用技术名，口语名靠同义词表直连税号（值为 4~8 位税号则按前缀匹配）
    '锂电池': ['850760', '锂离子蓄电池'], '锂离子电池': ['850760'],
    '充电宝': ['850760', '移动电源'], '锂电': ['850760']
  };

  /* ==================== HS 编码 ==================== */

  var hsCache = null;

  function hsPrepare() {
    if (hsCache) return hsCache;
    var H = window.DATA_HS;
    if (!H) return null;
    var cats = H.cats, h4 = H.h4;
    var cat4 = Object.create(null);
    var rows = new Array(H.rows.length);
    for (var i = 0; i < H.rows.length; i++) {
      var r = H.rows[i], code = r[0], name = r[1] || '';
      var hd = h4[code.replace('.', '').slice(0, 4)] || '';
      var full = hd ? hd + '；' + name : name;
      var c4 = code.replace('.', '').slice(0, 4);
      if (!cat4[c4]) cat4[c4] = cats[r[5]] || '';
      rows[i] = {
        code: code, name: name, full: full,
        nn: norm(name), fn: norm(full),
        tariff: r[2], vat: r[3], ctax: r[4],
        cat: cats[r[5]] || '', prov: r[6], hd: hd
      };
    }
    var alias = new Array(H.alias.length);
    for (var j = 0; j < H.alias.length; j++) {
      var a = H.alias[j];
      alias[j] = { n: a[0], nn: norm(a[0]), code: a[1], id: a[2] };
    }
    hsCache = { rows: rows, alias: alias, byCode: null, cat4: cat4 };
    return hsCache;
  }

  function hsIndexByCode() {
    var c = hsPrepare();
    if (!c.byCode) {
      c.byCode = Object.create(null);
      for (var i = 0; i < c.rows.length; i++) c.byCode[c.rows[i].code] = c.rows[i];
    }
    return c.byCode;
  }

  function searchHS(q) {
    var c = hsPrepare();
    if (!c) return null;
    var qn = norm(q);
    if (!qn) return { total: 0, rows: [] };

    var byCode = Object.create(null);
    function put(code, score, why, src) {
      var cur = byCode[code];
      if (!cur) {
        cur = byCode[code] = { code: code, score: 0, why: [], src: [] };
      }
      if (score > cur.score) cur.score = score;
      if (why && cur.why.indexOf(why) < 0) cur.why.push(why);
      if (src && cur.src.indexOf(src) < 0) cur.src.push(src);
    }

    // 1) 编码直查 / 前缀
    if (/^\d+$/.test(qn)) {
      if (qn.length >= 8) {
        for (var k in hsIndexByCode()) {
          if (k.replace('.', '') === qn) put(k, 1200, '税号完全匹配', 'code');
        }
      } else if (qn.length >= 4) {
        for (var k2 in hsIndexByCode()) {
          if (k2.replace('.', '').indexOf(qn) === 0) put(k2, 900, '税号前缀 ' + qn, 'code');
        }
      }
    }

    // 2) 同义词（值可以是品名关键词，也可以是 4~8 位税号前缀）
    for (var term in SYNONYMS) {
      var nt = norm(term);
      if (nt.indexOf(qn) >= 0 || qn.indexOf(nt) >= 0) {
        var vals = SYNONYMS[term];
        for (var vi = 0; vi < vals.length; vi++) {
          var v = norm(vals[vi]);
          if (v.length < 2) continue;
          if (/^\d{4,8}$/.test(v)) {
            for (var ri0 = 0; ri0 < c.rows.length; ri0++) {
              if (c.rows[ri0].code.replace('.', '').indexOf(v) === 0) {
                put(c.rows[ri0].code, 760, '同义词「' + term + '」→ 税号 ' + vals[vi], 'syn');
              }
            }
            continue;
          }
          for (var ri = 0; ri < c.rows.length; ri++) {
            if (c.rows[ri].nn.indexOf(v) >= 0) {
              put(c.rows[ri].code, 700 + dice(qn, c.rows[ri].nn) * 40,
                '同义词「' + term + '」→「' + vals[vi] + '」', 'syn');
            }
          }
        }
      }
    }

    // 3) 逐条品名打分
    var bestName = 0;
    for (var i = 0; i < c.rows.length; i++) {
      var row = c.rows[i], s = 0, why = '', nameHit = false;
      if (row.nn.indexOf(qn) >= 0) {
        s = 420 + dice(qn, row.nn) * 60;
        why = '品名含「' + q + '」';
        nameHit = true;
      } else if (qn.indexOf(row.nn) >= 0 && row.nn.length >= 3) {
        s = 360; why = '品名「' + row.name + '」被查询词包含';
        nameHit = true;
      } else {
        var sub = longestSub(qn, row.nn);
        if (sub && sub.length >= 2) {
          s = 210 + sub.length * 45 + dice(qn, row.nn) * 40;
          why = '品名含「' + sub + '」';
          nameHit = true;
        } else {
          var d = dice(qn, row.nn);
          if (d >= 0.4) { s = 120 + d * 180; why = '品名相似度 ' + d.toFixed(2); }
        }
      }
      if (!s && row.hd) {
        var sub2 = longestSub(qn, row.fn);
        if (sub2 && sub2.length >= 2 && row.hd.indexOf(sub2) >= 0) {
          s = 150 + sub2.length * 30; why = '品目注释含「' + sub2 + '」';
        } else if (qn.length >= 2 && row.hd.indexOf(qn) >= 0) {
          s = 170; why = '品目注释含「' + q + '」';
        }
      }
      if (s) {
        put(row.code, s, why, 'tariff');
        if (nameHit && s > bestName) bestName = s;
      }
    }

    // 4) 归类决定品名索引（税则品名里没有的商品，如「蚕蛹」）
    //    规则：① 2 字短词只做受限匹配，避免「电池」把「电池箔」全捞进来；
    //          ② 税则品名已有明确命中时，决定索引一律排在其后（它只是兜底）。
    for (var ai = 0; ai < c.alias.length; ai++) {
      var al = c.alias[ai], as = 0, aw = '';
      var extra = Math.max(0, al.nn.length - qn.length);
      var need = Math.min(3, qn.length);
      if (al.nn === qn) {
        as = 900; aw = '归类决定品名完全一致';
      } else if (al.nn.indexOf(qn) === 0) {
        as = 560 + dice(qn, al.nn) * 60 - extra * 12; aw = '归类决定品名以「' + q + '」开头';
      } else if (al.nn.indexOf(qn) > 0) {
        as = 470 + dice(qn, al.nn) * 60 - extra * 14; aw = '归类决定品名含「' + q + '」';
      } else {
        var asub = longestSub(qn, al.nn);
        if (asub && asub.length >= need) {
          as = 420 + asub.length * 40 - extra * 10; aw = '归类决定品名含「' + asub + '」';
        } else {
          var ad = dice(qn, al.nn);
          if (ad >= 0.6) { as = 300 + ad * 100; aw = '归类决定品名相似度 ' + ad.toFixed(2); }
        }
      }
      if (as > 0) {
        if (bestName >= 260) as = Math.min(as, bestName - 1);
        put(al.code, as, aw, '决策 ' + al.id);
      }
    }

    var list = [];
    for (var code in byCode) list.push(byCode[code]);
    list.sort(function (x, y) { return y.score - x.score || (x.code < y.code ? -1 : 1); });
    list = list.slice(0, 8);

    var out = [];
    var H4 = window.DATA_HS.h4;
    for (var li = 0; li < list.length; li++) {
      var it = list[li], meta = byCode[it.code];
      var hit = hsIndexByCode()[it.code];
      var code4 = it.code.replace('.', '').slice(0, 4);
      var hd4 = H4[code4] || '';
      out.push({
        code: it.code,
        name: hit ? hit.name : '',
        full: hit ? hit.full : hd4,
        hd: hit ? hit.hd : hd4,
        cat: hit ? hit.cat : (c.cat4[code4] || ''),
        tariff: hit ? hit.tariff : null,
        vat: hit ? hit.vat : null,
        ctax: hit ? hit.ctax : null,
        prov: hit ? hit.prov : null,
        missing: !hit,
        why: meta.why,
        src: meta.src,
        score: meta.score
      });
    }
    return { total: out.length, rows: out };
  }

  /* ==================== 归类边界规则 ==================== */

  function matchBoundary(queryText, extraNames) {
    var B = window.DATA_BOUNDARY;
    if (!B) return [];
    var qn = norm(queryText);
    var extras = (extraNames || []).map(norm);
    var out = [];
    for (var i = 0; i < B.rows.length; i++) {
      var r = B.rows[i], topic = r[0], rule = r[1], ex = r[2], wrong = r[3], kws = r[4] || [];
      var s = 0, hits = [];
      for (var k = 0; k < kws.length; k++) {
        var kw = norm(kws[k]);
        if (kw.length < 2) continue;
        if (qn.indexOf(kw) >= 0) { s += 12 + kw.length * 4; hits.push(kws[k]); }
        for (var e2 = 0; e2 < extras.length; e2++) {
          if (extras[e2].indexOf(kw) >= 0) { s += 6; hits.push(kws[k]); break; }
        }
      }
      for (var j = 0; j < ex.length; j++) {
        var pn = norm(ex[j][0]);
        if (pn && qn.indexOf(pn) >= 0) { s += 20; if (hits.indexOf(ex[j][0]) < 0) hits.push(ex[j][0]); }
      }
      var tn = norm(topic);
      var sub = longestSub(qn, tn);
      if (sub && sub.length >= 3) s += 8;
      if (s > 0) out.push({ topic: topic, rule: rule, examples: ex, wrong: wrong, score: s, hits: hits });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 3);
  }

  /* ==================== 稽查风险 ==================== */

  var DIM_ORDER;

  function scanRisk(text) {
    var R = window.DATA_RISK;
    if (!R) return null;
    var qn = norm(text);
    if (!qn) return { empty: true };

    var toks = tokenize(text);
    var hits = [];

    for (var i = 0; i < R.rules.length; i++) {
      var r = R.rules[i];
      var id = r[0], dim = r[1], w = r[2], title = r[3], desc = r[4], advice = r[5], basis = r[6];
      var kws = R.kw[id] || [];
      var kwHit = [];
      for (var k = 0; k < kws.length; k++) {
        if (qn.indexOf(norm(kws[k])) >= 0) kwHit.push(kws[k]);
      }
      var rtext = norm(title + desc + advice);
      var matched = [];
      for (var t = 0; t < toks.length; t++) {
        if (rtext.indexOf(toks[t]) >= 0) matched.push(toks[t]);
      }
      var cov = toks.length ? matched.length / toks.length : 0;
      var qualify = kwHit.length > 0 || (matched.length >= 3 && cov >= 0.35);
      if (!qualify) continue;
      var score = kwHit.length * 14 + matched.length * 9 + cov * 30;
      hits.push({
        id: id, dim: dim, weight: w, title: title, desc: desc, advice: advice, basis: basis,
        kw: kwHit, matched: matched, cov: cov, score: score
      });
    }

    hits.sort(function (a, b) {
      return (b.weight - a.weight) || (b.score - a.score) || (a.id < b.id ? -1 : 1);
    });

    var dims = [];
    var i2;
    for (i2 = 0; i2 < R.dims.length; i2++) {
      dims.push({
        key: R.dims[i2][0], name: R.dims[i2][1], short: R.dims[i2][2],
        color: R.dims[i2][3], desc: R.dims[i2][4],
        score: 0, count: 0, level: 'green', hits: []
      });
    }
    var byKey = Object.create(null);
    for (i2 = 0; i2 < dims.length; i2++) byKey[dims[i2].key] = dims[i2];

    var totalW = 0, highRules = 0;
    for (i2 = 0; i2 < hits.length; i2++) {
      var h = hits[i2], d = byKey[h.dim];
      totalW += h.weight;
      if (h.weight === 3) highRules++;
      if (d) {
        d.score += h.weight;
        d.count++;
        d.hits.push(h.id);
        if (h.weight === 3) d.level = 'red';
        else if (h.weight === 2 && d.level !== 'red') d.level = 'yellow';
        else if (d.level === 'green') d.level = 'blue';
      }
    }

    var redDims = 0;
    for (i2 = 0; i2 < dims.length; i2++) if (dims[i2].level === 'red') redDims++;

    var overall = 'low';
    if (highRules >= 3 || redDims >= 3) overall = 'high';
    else if (highRules >= 1 || redDims >= 1 || hits.length >= 3) overall = 'mid';

    return {
      hits: hits, dims: dims, overall: overall,
      totalW: totalW, maxW: R.maxWeight, highRules: highRules,
      redDims: redDims, empty: hits.length === 0
    };
  }

  /* ==================== 法规 ==================== */

  function searchRegs(q) {
    var G = window.DATA_REGS;
    if (!G) return null;
    var qn = norm(q);
    if (!qn) return { total: 0, rows: [] };
    var toks = tokenize(q), out = [];
    var COL = { id: 0, law: 1, order: 2, article: 3, topic: 4, text: 5, url: 6, status: 7, checked: 8 };
    for (var i = 0; i < G.rows.length; i++) {
      var r = G.rows[i];
      var law = r[COL.law] || '', order = r[COL.order] || '', art = r[COL.article] || '', text = r[COL.text] || '';
      var ln = norm(law), tn = norm(text), on = norm(order), an = norm(art);
      var s = 0, why = [];
      if (ln.indexOf(qn) >= 0) { s += 70; why.push('法规名含「' + q + '」'); }
      if (on.indexOf(qn) >= 0) { s += 30; why.push('文号含「' + q + '」'); }
      if (an.indexOf(qn) >= 0) { s += 26; why.push('条款含「' + q + '」'); }
      if (tn.indexOf(qn) >= 0) {
        var cnt = tn.split(qn).length - 1;
        s += 46 + Math.min(cnt, 5) * 6;
        why.push('正文含「' + q + '」' + (cnt > 1 ? ' ×' + cnt : ''));
      }
      var mt = 0, miss = 0;
      for (var t = 0; t < toks.length; t++) {
        if (tn.indexOf(toks[t]) >= 0 || ln.indexOf(toks[t]) >= 0) mt++;
        else miss++;
      }
      if (mt >= 2) { s += mt * 9; why.push('关键词命中 ' + mt + ' 个'); }
      if (s > 0) {
        out.push({
          id: r[COL.id], law: law, order: order, article: art, topic: r[COL.topic],
          text: text, url: r[COL.url], status: r[COL.status], checked: r[COL.checked],
          score: s, why: why
        });
      }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return { total: out.length, rows: out.slice(0, 10) };
  }

  /* ==================== 归类决定 ==================== */

  var decCache = null;

  function decPrepare() {
    if (decCache) return decCache;
    var D = window.DATA_DECISIONS;
    if (!D) return null;
    var rows = new Array(D.rows.length);
    for (var i = 0; i < D.rows.length; i++) {
      var r = D.rows[i];
      rows[i] = {
        id: r[0], code: r[1], name: r[2], desc: r[3], basis: r[4],
        year: r[5], ann: D.anns[r[6]] || '',
        nn: norm(r[2]), dn: norm(r[3]), bn: norm(r[4]), cn: norm(r[1])
      };
    }
    decCache = { rows: rows };
    return decCache;
  }

  function searchDecisions(q) {
    var c = decPrepare();
    if (!c) return null;
    var qn = norm(q);
    if (!qn) return { total: 0, rows: [] };
    var toks = tokenize(q), out = [];
    var isCode = /^\d{2,}$/.test(qn);

    for (var i = 0; i < c.rows.length; i++) {
      var r = c.rows[i], s = 0, why = [];
      if (isCode) {
        // 纯数字查询：只按税号/决定编号匹配，避免数字片段误当关键词
        if (r.cn === qn) { s += 600; why.push('税号完全匹配'); }
        else if (r.cn.indexOf(qn) === 0) { s += 380; why.push('税号前缀 ' + q); }
        if (r.id.toLowerCase().indexOf(qn) >= 0) { s += 240; why.push('决定编号含「' + q + '」'); }
        if (s > 0) {
          out.push({
            id: r.id, code: r.code, name: r.name, desc: r.desc, basis: r.basis,
            year: r.year, ann: r.ann, score: s + (r.year || 0) * 0.01, why: why
          });
        }
        continue;
      }
      if (r.nn.indexOf(qn) >= 0) {
        s += 300;
        if (r.nn === qn) { s += 260; why.push('品名完全一致'); }
        else why.push('品名含「' + q + '」');
      } else {
        var sub = longestSub(qn, r.nn);
        if (sub && sub.length >= 2) { s += 170 + sub.length * 35; why.push('品名含「' + sub + '」'); }
      }
      if (r.id.toLowerCase().indexOf(qn) >= 0) { s += 240; why.push('决定编号含「' + q + '」'); }
      if (r.dn.indexOf(qn) >= 0) { s += 90; why.push('商品描述含「' + q + '」'); }
      if (r.bn.indexOf(qn) >= 0) { s += 60; why.push('归类依据含「' + q + '」'); }

      var mt = 0;
      for (var t = 0; t < toks.length; t++) {
        if (r.nn.indexOf(toks[t]) >= 0) mt += 3;
        else if (r.dn.indexOf(toks[t]) >= 0) mt += 1;
        else if (r.bn.indexOf(toks[t]) >= 0) mt += 1;
      }
      if (mt) { s += mt * 4; if (!why.length) why.push('关键词命中 ' + mt); }
      var d = dice(qn, r.nn);
      if (d >= 0.45 && !why.length) { s += d * 90; why.push('品名相似度 ' + d.toFixed(2)); }

      if (s > 0) {
        out.push({
          id: r.id, code: r.code, name: r.name, desc: r.desc, basis: r.basis,
          year: r.year, ann: r.ann, score: s + (r.year || 0) * 0.01, why: why
        });
      }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return { total: out.length, rows: out.slice(0, 10) };
  }

  /* ==================== 渲染：通用 ==================== */

  function markText(text, needle) {
    var frag = document.createDocumentFragment();
    if (!text) return frag;
    var raw = (needle || '').trim();
    if (!raw || raw.length < 2) { frag.appendChild(document.createTextNode(text)); return frag; }
    var lower = text.toLowerCase(), nl = raw.toLowerCase(), idx = 0, i;
    while ((i = lower.indexOf(nl, idx)) >= 0) {
      frag.appendChild(document.createTextNode(text.slice(idx, i)));
      frag.appendChild(el('mark', null, text.slice(i, i + raw.length)));
      idx = i + raw.length;
      if (idx >= text.length) break;
    }
    frag.appendChild(document.createTextNode(text.slice(idx)));
    return frag;
  }

  function emptyState(title, msg, hints, onHint) {
    var box = el('div', 'empty');
    box.appendChild(el('h3', null, title));
    box.appendChild(el('p', null, msg));
    if (hints && hints.length) {
      var ul = el('ul', 'hintlist');
      hints.forEach(function (h) {
        var li = el('li');
        var b = el('button', null, h);
        b.type = 'button';
        b.addEventListener('click', function () { onHint(h); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    return box;
  }

  function pctText(v) { return v == null || v === '' ? '—' : v + '%'; }

  /* ==================== 渲染：HS ==================== */

  function renderHS(q, res, host, metaHost) {
    clear(host);
    clear(metaHost);
    if (!res) { host.appendChild(el('p', 'meta-line', 'HS 数据未加载（data/hs.js）')); return; }

    if (!res.total) {
      metaHost.appendChild(el('span', null, '未命中 '));
      host.appendChild(emptyState(
        '没有匹配到税号',
        '「' + q + '」在 8972 条税则品名与 1883 条归类决定品名中都没有直接匹配。可尝试更短的核心词（如「鸡爪」而非「冻鸡爪」），或直接输入 4 位税号（如 0207）。',
        ['鸡爪', '蚕蛹', '锂电池', '0207'],
        function (h) { setInput('q-hs', h); runHS(); }
      ));
      return;
    }

    metaHost.appendChild(el('span', null, '命中 '));
    metaHost.appendChild(el('b', null, String(res.total)));
    metaHost.appendChild(el('span', null, ' 条（按相关度排序，最多显示 8 条）。进口关税取税则从价税率，显示 0% 的税号可能实行从量税或零关税，请核对税则原文。'));

    res.rows.forEach(function (r, i) {
      var card = el('article', 'card');

      var hd = el('div', 'res-hd');
      hd.appendChild(el('span', 'rank', '#' + (i + 1)));
      hd.appendChild(el('span', 'code', r.code));
      hd.appendChild(el('span', 'name', r.name || (r.missing ? '（2026 税则未单列）' : '（无品名）')));
      if (r.missing) hd.appendChild(el('span', 'tag acc', '决定原文税号'));
      if (r.src.indexOf('code') >= 0) hd.appendChild(el('span', 'tag acc', '税号直查'));
      card.appendChild(hd);

      if (r.hd) {
        var kv = el('div', 'kv');
        kv.appendChild(el('span', 'k', '品目　'));
        kv.appendChild(document.createTextNode(r.hd));
        card.appendChild(kv);
      }
      if (r.cat) {
        var kv2 = el('div', 'kv');
        kv2.appendChild(el('span', 'k', '类章　'));
        kv2.appendChild(document.createTextNode(r.cat));
        card.appendChild(kv2);
      }

      var tax = el('div', 'tax');
      function addTax(label, val) {
        var sp = el('span');
        sp.appendChild(el('span', 'k', label + ' '));
        sp.appendChild(document.createTextNode(val));
        tax.appendChild(sp);
      }
      if (r.missing) {
        tax.appendChild(el('span', 'k', '该税号在《2026年进出口税则》中未单列，税率请按现行税则核对'));
      } else {
        addTax('进口关税', r.tariff == null || r.tariff === '' ? '—' : r.tariff + '%');
        if (r.prov != null && r.prov !== '') addTax('暂定税率', r.prov + '%');
        addTax('增值税', pctText(r.vat));
        addTax('消费税', r.ctax == null || r.ctax === '' || r.ctax === 0 ? '无' : r.ctax);
      }
      card.appendChild(tax);
      tax.title = '数据源：2026 年进出口税则；0% 可能为从量税，请核对税则原文';

      var src = el('div', 'src');
      if (r.missing) {
        src.appendChild(document.createTextNode('来源：商品归类决定原文税号（该 8 位税号未在 2026 税则中单列，可能已细分，以决定原文为准）'));
      } else {
        src.appendChild(document.createTextNode('来源：财政部《2026年进出口税则》'));
      }
      var decIds = r.src.filter(function (x) { return x.indexOf('决策 ') === 0; });
      if (decIds.length) {
        src.appendChild(document.createTextNode('；对应归类决定 '));
        decIds.forEach(function (x) { src.appendChild(el('span', 'tag ok', x.replace('决策 ', ''))); });
      }
      card.appendChild(src);

      if (r.why && r.why.length) {
        var why = el('div', 'why');
        why.appendChild(el('b', null, '匹配依据：'));
        why.appendChild(document.createTextNode(r.why.join(' · ')));
        card.appendChild(why);
      }
      host.appendChild(card);
    });

    // 归类边界提示
    var extraNames = res.rows.map(function (r) { return r.name; });
    var bd = matchBoundary(q, extraNames);
    if (bd.length) {
      host.appendChild(renderBoundary(q, bd));
    }
  }

  function renderBoundary(q, list) {
    var box = el('div', 'bd');
    var hd = el('div', 'bd-hd');
    hd.appendChild(document.createTextNode('相关归类边界提示（易错点）'));
    box.appendChild(hd);
    list.forEach(function (b) {
      var card = el('article', 'card');
      card.appendChild(el('div', 'bd-topic', b.topic));
      card.appendChild(el('div', 'bd-rule', b.rule));
      if (b.examples && b.examples.length) {
        var ul = el('ul', 'bd-ex');
        b.examples.forEach(function (e) {
          var li = el('li');
          li.appendChild(document.createTextNode(e[0] + ' '));
          var c = el('span', 'c', e[1]);
          li.appendChild(c);
          if (e[2]) li.appendChild(document.createTextNode(' · ' + e[2]));
          ul.appendChild(li);
        });
        card.appendChild(ul);
      }
      if (b.wrong) card.appendChild(el('div', 'wrong', '常见错法：' + b.wrong));
      var src = el('div', 'src');
      src.appendChild(document.createTextNode('来源：' + (window.DATA_BOUNDARY.source || '归类边界规则') +
        (b.hits && b.hits.length ? ' · 命中「' + b.hits.slice(0, 4).join('、') + '」' : '')));
      card.appendChild(src);
      box.appendChild(card);
    });
    return box;
  }

  /* ==================== 渲染：风险 ==================== */

  var LEVEL_TXT = { red: '高风险', yellow: '关注', blue: '提示', green: '未命中' };
  var VERDICT = {
    high: {
      label: '高风险', cls: 'high',
      tip: '命中 3 项以上权重 3 的高风险情形（或 3 个维度出现高风险项），建议在进出口前完成整改；如已发生，可评估主动披露的适用性。'
    },
    mid: {
      label: '中风险', cls: 'mid',
      tip: '存在需要关注的合规薄弱点（含权重 3 项），建议逐项核实并留存书面证据。本工具只看关键词与规则文本，等级不等于海关认定。'
    },
    low: {
      label: '低风险', cls: 'low',
      tip: '本次未命中高权重规则，仅有个别提示项；仍建议按建议逐项自查，低风险不等于无风险。'
    }
  };

  function renderRisk(q, res, host, metaHost) {
    clear(host);
    clear(metaHost);
    if (!res) { host.appendChild(el('p', 'meta-line', '风险规则数据未加载（data/risk.js）')); return; }

    if (res.empty) {
      metaHost.appendChild(el('span', null, '未命中任何规则'));
      host.appendChild(emptyState(
        '没有命中风险规则',
        '输入「' + q + '」未匹配到 38 条规则中的任何一条（含关键词表与规则文本匹配）。可以补充报关要素（材质 / 用途 / 加工方式 / 贸易方式 / 原产地），或用下面的示例词看效果。',
        ['锂电池', '化妆品', '加工贸易 保税 单耗', '减免税设备 监管年限'],
        function (h) { setInput('q-risk', h); runRisk(); }
      ));
      return;
    }

    var V = VERDICT[res.overall];
    var v = el('div', 'verdict');
    v.appendChild(el('span', 'v-badge ' + V.cls, V.label));
    v.appendChild(el('span', 'v-txt', V.tip));
    var num = el('span', 'v-num');
    num.textContent = '命中 ' + res.hits.length + ' 条 · 权重 ' + res.totalW + '/' + res.maxW +
      ' · 高风险项 ' + res.highRules;
    v.appendChild(num);
    host.appendChild(v);

    // 7 维度
    var dims = el('div', 'dims');
    res.dims.forEach(function (d) {
      var row = el('div', 'dim' + (d.count ? ' hit' : ''));
      row.appendChild(el('span', 'dim-name', d.name));
      var bar = el('div', 'dim-bar');
      var i = el('i');
      var ratio = d.score > 0 ? Math.min(1, d.score / 9) : 0;
      i.style.width = (ratio * 100).toFixed(1) + '%';
      i.style.background = d.count ? d.color : '#2a2f36';
      bar.appendChild(i);
      row.appendChild(bar);
      var st = el('span', 'dim-state');
      st.appendChild(el('span', 'n', d.count ? d.count + ' 项' : '—'));
      st.appendChild(document.createTextNode(' ' + LEVEL_TXT[d.level]));
      row.appendChild(st);
      row.title = d.name + '：' + (d.desc || '');
      dims.appendChild(row);
    });
    host.appendChild(dims);

    // 命中规则
    res.hits.forEach(function (h) {
      var card = el('article', 'card');
      var hd = el('div', 'hit-hd');
      hd.appendChild(el('span', 'rid', h.id));
      hd.appendChild(el('span', 'htitle', h.title));
      hd.appendChild(el('span', 'wtag w' + h.weight, h.weight === 3 ? '权重 3 · 高' : h.weight === 2 ? '权重 2 · 中' : '权重 1 · 低'));
      var dim = null;
      for (var i = 0; i < res.dims.length; i++) if (res.dims[i].key === h.dim) dim = res.dims[i];
      if (dim) {
        var dt = el('span', 'dimtag');
        var dot = el('span', 'dot');
        dot.style.background = dim.color;
        dt.appendChild(dot);
        dt.appendChild(document.createTextNode(dim.name));
        hd.appendChild(dt);
      }
      card.appendChild(hd);

      card.appendChild(el('p', 'desc', h.desc));

      var ad = el('p', 'advice');
      ad.appendChild(el('b', null, '建议　'));
      ad.appendChild(document.createTextNode(h.advice));
      card.appendChild(ad);

      var basis = el('p', 'basis');
      var b = window.DATA_RISK.basis[h.basis];
      if (b) {
        basis.appendChild(el('span', 'law', '依据：《' + b[0] + '》'));
        if (b[2]) basis.appendChild(document.createTextNode(' ' + b[2]));
        if (b[1]) basis.appendChild(document.createTextNode(' · ' + b[1]));
        if (b[4]) basis.appendChild(document.createTextNode(' · ' + b[4]));
        if (b[3]) {
          basis.appendChild(document.createTextNode(' · '));
          var a = el('a', null, '原文链接');
          a.href = b[3];
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          basis.appendChild(a);
        }
      } else {
        basis.appendChild(document.createTextNode('依据：内置风险规则库'));
      }
      card.appendChild(basis);

      var why = el('div', 'why');
      why.appendChild(el('b', null, '命中依据：'));
      var parts = [];
      if (h.kw.length) parts.push('关键词 ' + h.kw.slice(0, 5).join('、'));
      if (h.matched.length) parts.push('规则文本匹配 ' + h.matched.slice(0, 5).join('、'));
      why.appendChild(document.createTextNode(parts.join(' · ') || '规则文本'));
      card.appendChild(why);

      host.appendChild(card);
    });

    metaHost.appendChild(el('span', null, '共 38 条规则 / 7 维度，本次扫描命中 '));
    metaHost.appendChild(el('b', null, String(res.hits.length)));
    metaHost.appendChild(el('span', null, ' 条。等级口径：权重 3 命中 ≥3 项 → 高；≥1 项 → 中；其余 → 低。每条命中均标注关键词或规则文本依据，可回溯。'));
  }

  /* ==================== 渲染：法规 ==================== */

  var TOPIC = {
    price: '完税价格', classify: '商品归类', origin: '原产地', processing: '加工贸易',
    exemption: '减免税', control: '贸易管制', credit: '企业信用', disclosure: '主动披露'
  };

  function renderRegs(q, res, host, metaHost) {
    clear(host);
    clear(metaHost);
    if (!res) { host.appendChild(el('p', 'meta-line', '法规数据未加载（data/regs.js）')); return; }

    if (!res.total) {
      metaHost.appendChild(el('span', null, '0 条'));
      host.appendChild(emptyState(
        '没有匹配到法规',
        '「' + q + '」在 19 部法规的法规名、文号、条款与要点正文中都没有命中。可尝试更常见的业务词，如「稽查」「归类」「原产地」「预裁定」。',
        ['稽查', '归类', '原产地', '预裁定'],
        function (h) { setInput('q-regs', h); runRegs(); }
      ));
      return;
    }

    metaHost.appendChild(el('span', null, '命中 '));
    metaHost.appendChild(el('b', null, String(res.total)));
    metaHost.appendChild(el('span', null, ' 条（最多显示 10 条）'));

    res.rows.forEach(function (r, i) {
      var card = el('article', 'card');
      var hd = el('div', 'res-hd');
      hd.appendChild(el('span', 'rank', '#' + (i + 1)));
      var nm = el('span', 'name');
      nm.appendChild(markText(r.law, q));
      hd.appendChild(nm);
      if (r.status) hd.appendChild(el('span', 'tag ok', r.status));
      card.appendChild(hd);

      if (r.order || r.article) {
        var kv = el('div', 'kv');
        kv.appendChild(el('span', 'k', '文号　'));
        kv.appendChild(document.createTextNode((r.order || '—') + (r.article ? '　' + r.article : '')));
        card.appendChild(kv);
      }
      if (r.topic && TOPIC[r.topic]) {
        var kv2 = el('div', 'kv');
        kv2.appendChild(el('span', 'k', '主题　'));
        kv2.appendChild(document.createTextNode(TOPIC[r.topic]));
        card.appendChild(kv2);
      }

      var tx = el('p', 'desc');
      tx.appendChild(markText(r.text, q));
      card.appendChild(tx);

      var src = el('div', 'src');
      src.appendChild(document.createTextNode('来源：' + r.id + ' · ' + (r.law || '')));
      if (r.checked) src.appendChild(document.createTextNode(' · 核对于 ' + r.checked));
      if (r.url) {
        src.appendChild(document.createTextNode(' · '));
        var a = el('a', null, '官方原文');
        a.href = r.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        src.appendChild(a);
      }
      card.appendChild(src);

      if (r.why && r.why.length) {
        var why = el('div', 'why');
        why.appendChild(el('b', null, '匹配依据：'));
        why.appendChild(document.createTextNode(r.why.join(' · ')));
        card.appendChild(why);
      }
      host.appendChild(card);
    });
  }

  /* ==================== 渲染：归类决定 ==================== */

  function renderDecisions(q, res, host, metaHost) {
    clear(host);
    clear(metaHost);
    if (!res) { host.appendChild(el('p', 'meta-line', '归类决定数据未加载')); return; }

    if (!res.total) {
      metaHost.appendChild(el('span', null, '0 条'));
      host.appendChild(emptyState(
        '没有匹配到归类决定',
        '「' + q + '」在 1956 条商品归类决定（2018–2025）的品名、描述、归类依据与税号中都没有命中。可换更短的商品名，或直接输入 4 位税号。',
        ['冻煮蚕蛹', '锂电池', '化妆品', '8507'],
        function (h) { setInput('q-dec', h); runDecisions(); }
      ));
      return;
    }

    metaHost.appendChild(el('span', null, '命中 '));
    metaHost.appendChild(el('b', null, String(res.total)));
    metaHost.appendChild(el('span', null, ' 条（2018–2025 商品归类决定，最多显示 10 条）'));

    res.rows.forEach(function (r, i) {
      var card = el('article', 'card');
      var hd = el('div', 'res-hd');
      hd.appendChild(el('span', 'rank', '#' + (i + 1)));
      hd.appendChild(el('span', 'code', r.code));
      hd.appendChild(el('span', 'name', r.name));
      if (r.year) hd.appendChild(el('span', 'tag acc', r.year + ' 年'));
      card.appendChild(hd);

      var kv = el('div', 'kv');
      kv.appendChild(el('span', 'k', '归类决定　'));
      kv.appendChild(document.createTextNode(r.id));
      card.appendChild(kv);

      if (r.desc) {
        var p = el('p', 'desc');
        p.appendChild(el('b', null, '商品描述：'));
        p.appendChild(document.createTextNode(r.desc));
        card.appendChild(p);
      }
      if (r.basis) {
        var p2 = el('p', 'desc');
        p2.appendChild(el('b', null, '归类依据：'));
        p2.appendChild(document.createTextNode(r.basis));
        card.appendChild(p2);
      }

      var src = el('div', 'src');
      src.appendChild(document.createTextNode('来源：'));
      if (r.ann) src.appendChild(document.createTextNode(r.ann + ' · '));
      src.appendChild(document.createTextNode('决定编号 ' + r.id));
      card.appendChild(src);

      if (r.why && r.why.length) {
        var why = el('div', 'why');
        why.appendChild(el('b', null, '匹配依据：'));
        why.appendChild(document.createTextNode(r.why.join(' · ')));
        card.appendChild(why);
      }
      host.appendChild(card);
    });

    // 同名商品多税号提示（确定性：仅根据返回结果里出现的同名不同税号推断）
    var groups = Object.create(null);
    res.rows.forEach(function (r) {
      var k = r.name;
      if (!k) return;
      (groups[k] = groups[k] || []).push(r);
    });
    Object.keys(groups).forEach(function (name) {
      var g = groups[name];
      var codes = {};
      g.forEach(function (r) { codes[r.code] = 1; });
      if (Object.keys(codes).length < 2) return;
      var box = el('div', 'bd');
      var hd = el('div', 'bd-hd');
      hd.appendChild(document.createTextNode('同一品名存在多个归类决定（请核对口径差异）'));
      box.appendChild(hd);
      var card = el('article', 'card');
      card.appendChild(el('div', 'bd-topic', name));
      var ul = el('ul', 'bd-ex');
      g.forEach(function (r) {
        var li = el('li');
        var c = el('span', 'c', r.code);
        li.appendChild(c);
        li.appendChild(document.createTextNode(' ' + r.id + '（' + r.year + ' 年）'));
        ul.appendChild(li);
      });
      card.appendChild(ul);
      card.appendChild(el('div', 'wrong', '同一商品因加工状态（生/冻 vs 煮/熟/调味）、年份或公告批次不同而结论不同，务必核对该决定原文的加工工艺描述。'));
      box.appendChild(card);
      host.appendChild(box);
    });

    var bd = matchBoundary(q, res.rows.map(function (r) { return r.name; }));
    if (bd.length) host.appendChild(renderBoundary(q, bd));
  }

  /* ==================== 交互 ==================== */

  function setInput(id, v) {
    var n = document.getElementById(id);
    if (n) { n.value = v; n.focus(); }
  }

  function runHS() {
    var q = document.getElementById('q-hs').value.trim();
    var out = document.getElementById('out-hs'), meta = document.getElementById('meta-hs');
    if (!q) { clear(out); clear(meta); out.appendChild(introHS()); return; }
    var res = searchHS(q);
    renderHS(q, res, out, meta);
  }

  function runRisk() {
    var q = document.getElementById('q-risk').value.trim();
    var out = document.getElementById('out-risk'), meta = document.getElementById('meta-risk');
    if (!window.DATA_RISK) { clear(out); out.appendChild(el('p', 'meta-line', '风险数据加载中，请稍候…')); setTimeout(runRisk, 120); return; }
    if (!q) { clear(out); clear(meta); out.appendChild(introRisk()); return; }
    var res = scanRisk(q);
    renderRisk(q, res, out, meta);
  }

  function runRegs() {
    var q = document.getElementById('q-regs').value.trim();
    var out = document.getElementById('out-regs'), meta = document.getElementById('meta-regs');
    if (!window.DATA_REGS) { clear(out); out.appendChild(el('p', 'meta-line', '法规数据加载中，请稍候…')); setTimeout(runRegs, 120); return; }
    if (!q) { clear(out); clear(meta); out.appendChild(introRegs()); return; }
    var res = searchRegs(q);
    renderRegs(q, res, out, meta);
  }

  function runDecisions() {
    var q = document.getElementById('q-dec').value.trim();
    var out = document.getElementById('out-dec'), meta = document.getElementById('meta-dec');
    if (!window.DATA_DECISIONS) {
      clear(out);
      out.appendChild(el('p', 'meta-line', '归类决定数据（646 KB）按需加载中…'));
      ensureDecisions(function () {
        if (window.DATA_DECISIONS) runDecisions();
        else { clear(out); out.appendChild(el('p', 'meta-line', 'data/decisions.js 加载失败，请确认文件存在。')); }
      });
      return;
    }
    if (!q) { clear(out); clear(meta); out.appendChild(introDec()); return; }
    var res = searchDecisions(q);
    renderDecisions(q, res, out, meta);
  }

  /* ---------- 初始提示块（不留空白） ---------- */

  function introHS() {
    return emptyState(
      '输入品名或税号开始查询',
      '按品名关键词（支持简称、缺字，如「鸡爪」查「冻鸡爪」）或 4 位以上税号查询；数据为 2026 年进出口税则 8972 条 + 1883 条归类决定品名索引。回车即可查询。',
      ['冻鸡爪', '蚕蛹', '锂电池', '0207'],
      function (h) { setInput('q-hs', h); runHS(); }
    );
  }
  function introRisk() {
    return emptyState(
      '填写报关要素后扫描',
      '把品名、材质、用途、加工方式、贸易方式、原产地等要素写进来，规则引擎会命中 38 条风险规则并按 7 个维度汇总（回车或点按钮扫描）。',
      ['锂电池', '化妆品', '加工贸易 保税 单耗', '特许权使用费 关联公司'],
      function (h) { setInput('q-risk', h); runRisk(); }
    );
  }
  function introRegs() {
    return emptyState(
      '输入法规关键词检索',
      '在 19 部海关核心法规的法规名、文号、条款与要点正文中检索，结果附官方原文链接与核对日期。',
      ['稽查', '归类', '原产地', '主动披露'],
      function (h) { setInput('q-regs', h); runRegs(); }
    );
  }
  function introDec() {
    return emptyState(
      '输入品名或税号检索归类决定',
      '在 1956 条 2018–2025 年商品归类决定中检索，结果给出「归类决定编号 + 税号 + 归类依据 + 公告号 + 年份」，并附相关归类边界提示。',
      ['冻煮蚕蛹', '锂电池', '化妆品', '8507'],
      function (h) { setInput('q-dec', h); runDecisions(); }
    );
  }

  /* ---------- 按需加载 decisions.js ---------- */

  var decLoading = false, decQueue = [];

  function ensureDecisions(cb) {
    if (window.DATA_DECISIONS) { cb(); return; }
    decQueue.push(cb);
    if (decLoading) return;
    decLoading = true;
    var s = document.createElement('script');
    s.src = 'data/decisions.js';
    s.onload = function () {
      decLoading = false;
      var q = decQueue.slice(); decQueue.length = 0;
      q.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    };
    s.onerror = function () {
      decLoading = false;
      var q = decQueue.slice(); decQueue.length = 0;
      q.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    };
    document.body.appendChild(s);
  }

  /* ---------- Tab ---------- */

  var current = 'hs';

  function switchTab(name) {
    current = name;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === name;
      tabs[i].classList.toggle('is-on', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var panels = document.querySelectorAll('.panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].id !== 'panel-' + name;
      panels[j].classList.toggle('is-on', panels[j].id === 'panel-' + name);
    }
    if (name === 'dec' && !window.DATA_DECISIONS) {
      ensureDecisions(function () { if (current === 'dec') runDecisions(); });
    }
  }

  /* ---------- 页脚统计 ---------- */

  function renderFooter() {
    var host = document.getElementById('ft-stats');
    if (!host) return;
    clear(host);
    function item(label, val) {
      var sp = el('span');
      sp.appendChild(document.createTextNode(label + ' '));
      sp.appendChild(el('b', null, val));
      host.appendChild(sp);
    }
    if (window.DATA_HS) item('税则条目', window.DATA_HS.total.toLocaleString());
    if (window.DATA_HS) item('品名索引', window.DATA_HS.alias.length.toLocaleString());
    if (window.DATA_RISK) item('风险规则', window.DATA_RISK.rules.length + ' 条 / ' + window.DATA_RISK.dims.length + ' 维度');
    if (window.DATA_REGS) item('法规', window.DATA_REGS.rows.length + ' 部');
    if (window.DATA_BOUNDARY) item('归类边界规则', window.DATA_BOUNDARY.rows.length + ' 条');
    var d = el('span');
    var txt = '归类决定 ';
    if (window.DATA_DECISIONS) txt += window.DATA_DECISIONS.total.toLocaleString() + ' 条';
    else txt += '1956 条（按需加载）';
    d.textContent = txt;
    host.appendChild(d);
    var x = el('span');
    var bytes = window.DATA_META && window.DATA_META.total ? window.DATA_META.total : 1387895;
    x.textContent = '数据包 ' + fmtBytes(bytes) + ' · 0 个网络请求';
    host.appendChild(x);
  }

  /* ---------- 绑定 ---------- */

  function bindEnter(inputId, fn) {
    var n = document.getElementById(inputId);
    if (!n) return;
    n.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        fn();
      }
    });
  }

  function init() {
    var btns = { hs: ['btn-hs', runHS], risk: ['btn-risk', runRisk], regs: ['btn-regs', runRegs], dec: ['btn-dec', runDecisions] };
    Object.keys(btns).forEach(function (k) {
      var b = document.getElementById(btns[k][0]);
      if (b) b.addEventListener('click', btns[k][1]);
    });

    bindEnter('q-hs', runHS);
    bindEnter('q-regs', runRegs);
    bindEnter('q-dec', runDecisions);
    bindEnter('q-risk', runRisk);

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (t) {
        t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
      })(tabs[i]);
    }

    // 快捷词
    var chips = document.querySelectorAll('.chips');
    for (var c = 0; c < chips.length; c++) {
      (function (bar) {
        var target = bar.getAttribute('data-for');
        var inId = target === 'risk' ? 'q-risk' : 'q-' + target;
        var fn = { hs: runHS, risk: runRisk, regs: runRegs, dec: runDecisions }[target];
        var bs = bar.querySelectorAll('.chip');
        for (var k = 0; k < bs.length; k++) {
          (function (chip) {
            chip.addEventListener('click', function () {
              setInput(inId, chip.textContent.trim());
              fn();
            });
          })(bs[k]);
        }
      })(chips[c]);
    }

    document.getElementById('out-hs').appendChild(introHS());
    document.getElementById('out-risk').appendChild(introRisk());
    document.getElementById('out-regs').appendChild(introRegs());
    document.getElementById('out-dec').appendChild(introDec());

    // 预取归类决定：空闲时先拉数据，切 tab 立刻可用（仍然是静态文件，不发请求到任何服务器）
    if (window.requestIdleCallback) {
      requestIdleCallback(function () { ensureDecisions(function () { renderFooter(); }); }, { timeout: 2500 });
    } else {
      setTimeout(function () { ensureDecisions(function () { renderFooter(); }); }, 1200);
    }

    renderFooter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 调试/验证用：暴露只读查询函数（不影响页面）
  window.RISK_APP = {
    searchHS: searchHS, scanRisk: scanRisk, searchRegs: searchRegs, searchDecisions: searchDecisions,
    matchBoundary: matchBoundary, norm: norm, dice: dice
  };
})();
