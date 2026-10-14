/* =====================================================
 * 电路画板 — 电路拓扑分析
 *
 * 这里是整个工具的地基：连通关系不存储，靠 wires 推导（union-find）。
 * 电路图 / 实物图都只是同一份拓扑的两种投影，所以互转天然无损。
 *
 * 依据：GB/T 4728 把用途分为「电路图 / 接线图 / 功能图」，
 * 本工具的 schematic ≈ 电路图，pictorial ≈ 接线图。
 * ===================================================== */
(function (global) {
  'use strict';

  var Parts = global.CircuitParts;

  function pinKey(c, p) { return c + ':' + p; }

  /* =====================================================
   * 1. 推导网络（nets）—— 唯一的真理源
   * ===================================================== */

  /** 简化并查集：key 是 '元件id:引脚id' */
  function makeDSU() {
    var parent = {};
    function find(k) {
      if (parent[k] === undefined) { parent[k] = k; return k; }
      var root = k;
      while (parent[root] !== root) root = parent[root];
      while (parent[k] !== root) { var nx = parent[k]; parent[k] = root; k = nx; }
      return root;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    return { find: find, union: union, keys: function () { return Object.keys(parent); } };
  }

  /**
   * 由 wires 推导 nets。
   * @returns {{nets:Array, netOf:Object}} nets 按最小成员键排序，id 稳定
   */
  function computeNets(state) {
    var dsu = makeDSU();

    // 先登记所有引脚，保证孤立引脚也有自己的 net
    state.components.forEach(function (c) {
      Parts.get(c.part).pins.forEach(function (p) { dsu.find(pinKey(c.id, p.id)); });
    });

    state.wires.forEach(function (w) {
      var a = pinKey(w.a.c, w.a.p);
      var b = pinKey(w.b.c, w.b.p);
      if (dsu.keys().indexOf(a) < 0) dsu.find(a);
      if (dsu.keys().indexOf(b) < 0) dsu.find(b);
      dsu.union(a, b);
    });

    // 归组
    var groups = {};
    dsu.keys().forEach(function (k) {
      var r = dsu.find(k);
      (groups[r] = groups[r] || []).push(k);
    });

    var nets = Object.keys(groups).map(function (r) {
      var members = groups[r].slice().sort();
      return {
        id: members[0],           // 用最小成员键当 id，保证同一电路每次结果一致
        members: members,
        comps: uniq(members.map(function (k) { return k.split(':')[0]; }))
      };
    });

    var byId = {};
    nets.forEach(function (n) { byId[n.id] = n; });

    var netOf = {};
    nets.forEach(function (n) {
      n.members.forEach(function (k) { netOf[k] = n; });
    });

    // 每个 net 上挂了多少个元件引脚端（判断并联/悬空用）
    nets.forEach(function (n) {
      n.terminals = n.members.length;
      n.isDangling = n.terminals < 2;
    });

    return { nets: nets, netOf: netOf, byId: byId };
  }

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  /** 取元件某个引脚所属的 net（元件不存在时返回 null） */
  function netOfPin(state, netInfo, compId, pinId) {
    var n = netInfo.netOf[pinKey(compId, pinId)];
    return n || null;
  }

  /** 元件两端所属的 net（两端式元件） */
  function compNets(state, netInfo, comp) {
    var def = Parts.get(comp.part);
    if (def.twoTerminal) {
      return [netOfPin(state, netInfo, comp.id, def.pins[0].id),
              netOfPin(state, netInfo, comp.id, def.pins[1].id)];
    }
    return def.pins.map(function (p) { return netOfPin(state, netInfo, comp.id, p.id); });
  }

  /** 元件连接的两个不同 net（忽略短路情况） */
  function compEndpoints(state, netInfo, comp) {
    var ns = compNets(state, netInfo, comp).filter(Boolean);
    if (ns.length < 2) return null;
    return [ns[0].id, ns[1].id];
  }

  function findSource(state) {
    for (var i = 0; i < state.components.length; i++) {
      var def = Parts.get(state.components[i].part);
      if (def.category === 'source') return state.components[i];
    }
    return null;
  }

  /* =====================================================
   * 2. 串并联分解 —— 把网表压成"链 + 并联块"
   *
   * 步骤：
   *   a) 反复合并「度为 2 的中间节点」→ 得到串联超级元件
   *   b) 在超级图上从电源两端 BFS 出一条主路径
   *   c) 主路径上相邻两节点间若还有别的超级元件 → 并联支线
   * ===================================================== */

  function analyze(state) {
    var netInfo = computeNets(state);
    var src = findSource(state);

    var result = {
      nets: netInfo.nets,
      netInfo: netInfo,
      source: src,
      nodes: [],          // 布局用：[netId]
      steps: [],          // 布局用：[{netId, kind:'series'|'parallel', items:[superComp]}]
      branches: null,     // 串并联信息，供 UI 展示
      issues: [],
      ok: false
    };

    result.issues = validate(state, netInfo);

    if (!src) {
      result.issues.unshift({ level: 'warn', msg: '电路中没有电源（电池组），无法自动排布。' });
      return result;
    }

    var ep = compEndpoints(state, netInfo, src);
    if (!ep) {
      result.issues.unshift({ level: 'error', msg: '电池组没有接成通路。' });
      return result;
    }
    var S = ep[0], T = ep[1];
    result.S = S; result.T = T;

    // ---- a) 串联合并 ----
    // 电源不进图：S/T 已由电源两端确定，电源那条边会把路径走成「只有一个电源」
    var units = {};
    state.components.forEach(function (c) {
      if (src && c.id === src.id) return;
      var e = compEndpoints(state, netInfo, c);
      if (e) units['u_' + c.id] = { comps: [c.id], nets: e };
    });

    // netId -> [端点key...]，端点为 'u_xxx#0|1'
    function endpointsOnNet(netId) {
      var out = [];
      Object.keys(units).forEach(function (uid) {
        var u = units[uid];
        u.nets.forEach(function (n, i) { if (n === netId) out.push({ uid: uid, idx: i }); });
      });
      return out;
    }

    var changed = true;
    var guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (var i = 0; i < netInfo.nets.length; i++) {
        var nid = netInfo.nets[i].id;
        if (nid === S || nid === T) continue;
        var eps = endpointsOnNet(nid).filter(function (e) {
          // 只合并仍"活着"的独立单元
          return units[e.uid] && units[e.uid].comps.length;
        });
        if (eps.length !== 2) continue;
        if (eps[0].uid === eps[1].uid) continue;    // 同一元件两端短路，不合并
        var ua = units[eps[0].uid], ub = units[eps[1].uid];
        if (ua.nets[0] === ub.nets[0] && ua.nets[1] === ub.nets[1]) {
          // 两单元本来就并联在同一对节点上，不能串联合并
          continue;
        }
        // 合并：ua 的非 nid 端 + ub 的非 nid 端
        var na = ua.nets[1 - eps[0].idx];
        var nb = ub.nets[1 - eps[1].idx];
        if (na === nb) continue;

        var merged = { comps: ua.comps.concat(ub.comps), nets: [na, nb] };
        Object.keys(units).forEach(function (k) {
          if (units[k] === ua || units[k] === ub) delete units[k];
        });
        units['u_' + merged.comps[0]] = merged;
        changed = true;
        break;
      }
    }

    // ---- b) 超级图上找 S→T 路径 ----
    var adj = {};
    Object.keys(units).forEach(function (uid) {
      var u = units[uid];
      if (u.nets[0] === u.nets[1]) return;
      (adj[u.nets[0]] = adj[u.nets[0]] || []).push({ uid: uid, to: u.nets[1] });
      (adj[u.nets[1]] = adj[u.nets[1]] || []).push({ uid: uid, to: u.nets[0] });
    });

    var path = bfsPath(adj, S, T);

    if (!path) {
      result.issues.unshift({ level: 'error', msg: '从电池正极到负极没有通路（回路不闭合）。' });
      result.steps = [];
      return result;
    }

    // ---- c) 逐步构造 steps，检测并联支线 ----
    var nodes = [S];
    for (var s = 0; s < path.length; s++) {
      var a = path[s].from, b = path[s].to;
      var onPath = path[s].uid;
      // 同一对节点之间的其它单元 = 并联
      var parallels = Object.keys(units).filter(function (uid) {
        if (uid === onPath) return false;
        var n = units[uid].nets;
        return (n[0] === a && n[1] === b) || (n[0] === b && n[1] === a);
      });
      var items = [units[onPath]].concat(parallels.map(function (k) { return units[k]; }));
      // 并联行排序：普通元件在前，电表（电压表）画在最外层
      items = items.slice().sort(function (x, y) {
        var mx = rankMeter(x.comps, state), my = rankMeter(y.comps, state);
        return mx - my;
      });
      result.steps.push({
        from: a, to: b,
        kind: items.length > 1 ? 'parallel' : 'series',
        items: items
      });
      nodes.push(b);
    }

    result.nodes = nodes;
    result.units = units;
    result.ok = true;
    return result;
  }

  function rankMeter(comps, state) {
    for (var i = 0; i < comps.length; i++) {
      var c = state.components.filter(function (x) { return x.id === comps[i]; })[0];
      if (c && Parts.get(c.part).parallel) return 1;   // 电压表排最后
    }
    return 0;
  }

  function bfsPath(adj, from, to) {
    if (from === to) return [];
    var prev = {}, seen = {}, q = [from];
    seen[from] = 1;
    while (q.length) {
      var cur = q.shift();
      var edges = adj[cur] || [];
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (seen[e.to]) continue;
        seen[e.to] = 1;
        prev[e.to] = { from: cur, uid: e.uid };
        if (e.to === to) {
          var path = [], node = to;
          while (node !== from) {
            var p = prev[node];
            path.unshift({ from: p.from, to: node, uid: p.uid });
            node = p.from;
          }
          return path;
        }
        q.push(e.to);
      }
    }
    return null;
  }

  /* =====================================================
   * 3. 教学校验
   * ===================================================== */

  function validate(state, netInfo) {
    var issues = [];
    var defs = {};
    state.components.forEach(function (c) { defs[c.id] = c; });

    // 3.1 悬空引脚
    netInfo.nets.forEach(function (n) {
      if (n.terminals === 1) {
        var k = n.members[0].split(':');
        var c = defs[k[0]];
        var label = c ? Parts.get(c.part).name : '?';
        issues.push({ level: 'warn', msg: '「' + label + '」有一个接线柱悬空，没接入电路。' });
      }
    });

    // 3.2 元件自身短路
    state.components.forEach(function (c) {
      var def = Parts.get(c.part);
      if (!def.twoTerminal) return;
      var a = netOfPin(state, netInfo, c.id, def.pins[0].id);
      var b = netOfPin(state, netInfo, c.id, def.pins[1].id);
      if (a && b && a.id === b.id) {
        issues.push({ level: 'error', msg: '「' + def.name + '」的两个接线柱接到了同一个节点上（短路）。' });
      }
    });

    // 3.3 电表接法
    state.components.forEach(function (c) {
      var def = Parts.get(c.part);
      var e = compEndpoints(state, netInfo, c);
      if (!e) return;

      // 与它并联的元件数量
      var parallels = 0;
      state.components.forEach(function (o) {
        if (o.id === c.id) return;
        var oe = compEndpoints(state, netInfo, o);
        if (!oe) return;
        if ((oe[0] === e[0] && oe[1] === e[1]) || (oe[0] === e[1] && oe[1] === e[0])) parallels++;
      });

      if (def.series && parallels > 0) {
        issues.push({ level: 'error', msg: '电流表必须串联使用，现在它和其它元件并联了。' });
      }
      if (def.parallel && parallels === 0) {
        issues.push({ level: 'error', msg: '电压表必须并联使用（接在被测元件两端），现在是串联。' });
      }
      // 电压表直接并在电源两端 = 短路
      if (def.parallel) {
        var src = findSource(state);
        if (src) {
          var se = compEndpoints(state, netInfo, src);
          if (se && ((se[0] === e[0] && se[1] === e[1]) || (se[0] === e[1] && se[1] === e[0]))) {
            issues.push({ level: 'error', msg: '电压表直接并在电池组两端会造成短路。' });
          }
        }
      }
    });

    // 3.4 元件太少 / 没有用电器
    if (state.components.length < 2) {
      issues.push({ level: 'warn', msg: '元件太少，还不是一个完整电路。' });
    }

    // 去重
    var seen = {}, out = [];
    issues.forEach(function (i) { if (!seen[i.msg]) { seen[i.msg] = 1; out.push(i); } });
    return out;
  }

  /* =====================================================
   * 导出
   * ===================================================== */
  global.CircuitNet = {
    pinKey: pinKey,
    computeNets: computeNets,
    compNets: compNets,
    compEndpoints: compEndpoints,
    netOfPin: netOfPin,
    findSource: findSource,
    analyze: analyze,
    validate: validate
  };
})(window);
