// Sandboxed tree-walking interpreter for After Effects expressions (ES5 + some ES2015).
// No eval / new Function. Uses acorn only for parsing.
import * as acorn from 'acorn';
import { add, sub, mul, div, mod, isVec } from './vecmath.js';

export class SandboxError extends Error {}
export class BudgetError extends SandboxError {}
export const NOT_HANDLED = Symbol('notHandled');

const FORBIDDEN = new Set([
  'constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
  'caller', 'callee', 'globalThis', 'window', 'self', 'process', 'require', 'Function', 'eval',
]);

const astCache = new Map();
export function parseExpression(src) {
  let c = astCache.get(src);
  if (c) { if (c.error) throw c.error; return c.ast; }
  try {
    const ast = acorn.parse(src, { ecmaVersion: 2020, allowReturnOutsideFunction: true, sourceType: 'script' });
    c = { ast };
  } catch (e) {
    c = { error: e };
  }
  if (astCache.size > 2000) astCache.clear();
  astCache.set(src, c);
  if (c.error) throw c.error;
  return c.ast;
}

class Scope {
  constructor(parent, isFn) { this.parent = parent; this.vars = new Map(); this.isFn = !!isFn; }
  find(name) { let s = this; while (s) { if (s.vars.has(name)) return s; s = s.parent; } return null; }
  fnScope() { let s = this; while (s && !s.isFn) s = s.parent; return s; }
}

const BREAK = { t: 'break' }, CONTINUE = { t: 'continue' };
class Return { constructor(v) { this.v = v; } }
class Brk { constructor(label) { this.label = label; } }
class Cnt { constructor(label) { this.label = label; } }
class ThrowSignal { constructor(v) { this.v = v; } }

function collectVars(node, out) {
  if (!node || typeof node.type !== 'string') return;
  switch (node.type) {
    case 'VariableDeclaration':
      if (node.kind === 'var') for (const d of node.declarations) patNames(d.id, out);
      for (const d of node.declarations) collectVars(d.init, out);
      return;
    case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': return;
    default:
  }
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && collectVars(x, out));
    else if (v && typeof v.type === 'string') collectVars(v, out);
  }
}
function patNames(p, out) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ArrayPattern': p.elements.forEach((e) => patNames(e, out)); break;
    case 'ObjectPattern': p.properties.forEach((pr) => patNames(pr.type === 'RestElement' ? pr.argument : pr.value, out)); break;
    case 'AssignmentPattern': patNames(p.left, out); break;
    case 'RestElement': patNames(p.argument, out); break;
    default:
  }
}

export class Interp {
  /**
   * host: { has(name), get(name), set?(name,v), unwrap(v), isHost(obj), thisValue, statics: object }
   */
  constructor(host, maxSteps = 400000) {
    this.host = host;
    this.steps = 0;
    this.maxSteps = maxSteps;
    this.last = undefined;
    this.depth = 0;
  }

  U(v) { return this.host.unwrap(v); }

  run(ast) {
    const scope = new Scope(null, true);
    scope.vars.set('%this', this.host.thisValue);
    const vars = [];
    collectVars(ast, vars);
    for (const n of vars) if (!scope.vars.has(n)) scope.vars.set(n, undefined);
    this.hoist(ast.body, scope);
    const sig = this.execList(ast.body, scope);
    if (sig instanceof Return) return sig.v;
    if (sig instanceof ThrowSignal) throw sig.v;
    return this.last;
  }

  hoist(body, scope) {
    for (const st of body) if (st.type === 'FunctionDeclaration') scope.vars.set(st.id.name, this.makeFn(st, scope));
  }

  tick() {
    if (++this.steps > this.maxSteps) throw new BudgetError('expression step budget exceeded');
  }

  // ---------- statements ----------
  execList(list, scope) {
    for (let i = 0; i < list.length; i++) {
      const r = this.exec(list[i], scope);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  exec(n, scope) {
    this.tick();
    switch (n.type) {
      case 'ExpressionStatement': this.last = this.ev(n.expression, scope); return undefined;
      case 'VariableDeclaration': {
        for (const d of n.declarations) {
          if (n.kind === 'var') {
            if (d.init) this.bindPattern(d.id, this.ev(d.init, scope), scope, 'assign');
          } else {
            this.bindPattern(d.id, d.init ? this.ev(d.init, scope) : undefined, scope, 'declare');
          }
        }
        return undefined;
      }
      case 'FunctionDeclaration': return undefined; // hoisted
      case 'ReturnStatement': return new Return(n.argument ? this.U(this.ev(n.argument, scope)) : undefined);
      case 'IfStatement':
        if (this.truthy(this.ev(n.test, scope))) return this.exec(n.consequent, scope);
        return n.alternate ? this.exec(n.alternate, scope) : undefined;
      case 'BlockStatement': {
        const s = new Scope(scope, false);
        this.hoist(n.body, s);
        return this.execList(n.body, s);
      }
      case 'EmptyStatement': return undefined;
      case 'ForStatement': return this.execFor(n, scope, null);
      case 'WhileStatement': return this.execWhile(n, scope, null);
      case 'DoWhileStatement': return this.execDoWhile(n, scope, null);
      case 'ForInStatement': case 'ForOfStatement': return this.execForIn(n, scope, null);
      case 'BreakStatement': return new Brk(n.label ? n.label.name : null);
      case 'ContinueStatement': return new Cnt(n.label ? n.label.name : null);
      case 'LabeledStatement': {
        const b = n.body, label = n.label.name;
        let r;
        if (b.type === 'ForStatement') r = this.execFor(b, scope, label);
        else if (b.type === 'WhileStatement') r = this.execWhile(b, scope, label);
        else if (b.type === 'DoWhileStatement') r = this.execDoWhile(b, scope, label);
        else if (b.type === 'ForInStatement' || b.type === 'ForOfStatement') r = this.execForIn(b, scope, label);
        else r = this.exec(b, scope);
        if (r instanceof Brk && r.label === label) return undefined;
        return r;
      }
      case 'SwitchStatement': return this.execSwitch(n, scope);
      case 'ThrowStatement': throw new ThrowSignal(this.ev(n.argument, scope));
      case 'TryStatement': return this.execTry(n, scope);
      default: throw new SandboxError('unsupported statement ' + n.type);
    }
  }

  // returns: undefined (continue loop) / signal to propagate / BREAK to leave
  loopSignal(r, label) {
    if (r === undefined) return undefined;
    if (r instanceof Brk) return r.label === null || r.label === label ? BREAK : r;
    if (r instanceof Cnt) return r.label === null || r.label === label ? CONTINUE : r;
    return r;
  }

  execFor(n, scope, label) {
    const s = new Scope(scope, false);
    if (n.init) { if (n.init.type === 'VariableDeclaration') this.exec(n.init, s); else this.ev(n.init, s); }
    for (;;) {
      this.tick();
      if (n.test && !this.truthy(this.ev(n.test, s))) break;
      const r = this.loopSignal(this.exec(n.body, s), label);
      if (r === BREAK) break;
      if (r !== undefined && r !== CONTINUE) return r;
      if (n.update) this.ev(n.update, s);
    }
    return undefined;
  }
  execWhile(n, scope, label) {
    for (;;) {
      this.tick();
      if (!this.truthy(this.ev(n.test, scope))) break;
      const r = this.loopSignal(this.exec(n.body, scope), label);
      if (r === BREAK) break;
      if (r !== undefined && r !== CONTINUE) return r;
    }
    return undefined;
  }
  execDoWhile(n, scope, label) {
    do {
      this.tick();
      const r = this.loopSignal(this.exec(n.body, scope), label);
      if (r === BREAK) break;
      if (r !== undefined && r !== CONTINUE) return r;
    } while (this.truthy(this.ev(n.test, scope)));
    return undefined;
  }
  execForIn(n, scope, label) {
    let obj = this.U(this.ev(n.right, scope));
    let items;
    if (n.type === 'ForOfStatement') {
      if (obj == null) throw new TypeError('not iterable');
      items = typeof obj === 'string' ? Array.from(obj) : Array.from(obj);
    } else {
      items = [];
      if (obj != null && typeof obj === 'object') for (const k in obj) { if (!FORBIDDEN.has(k)) items.push(k); }
      else if (typeof obj === 'string') for (let i = 0; i < obj.length; i++) items.push(String(i));
    }
    for (const it of items) {
      this.tick();
      const s = new Scope(scope, false);
      const l = n.left;
      if (l.type === 'VariableDeclaration') this.bindPattern(l.declarations[0].id, it, l.kind === 'var' ? scope : s, l.kind === 'var' ? 'assign' : 'declare');
      else this.assignTo(l, it, s);
      const r = this.loopSignal(this.exec(n.body, s), label);
      if (r === BREAK) break;
      if (r !== undefined && r !== CONTINUE) return r;
    }
    return undefined;
  }
  execSwitch(n, scope) {
    const d = this.U(this.ev(n.discriminant, scope));
    const s = new Scope(scope, false);
    let matched = -1;
    for (let i = 0; i < n.cases.length; i++) {
      const c = n.cases[i];
      if (c.test && this.U(this.ev(c.test, s)) === d) { matched = i; break; }
    }
    if (matched < 0) matched = n.cases.findIndex((c) => !c.test);
    if (matched < 0) return undefined;
    for (let i = matched; i < n.cases.length; i++) {
      const r = this.execList(n.cases[i].consequent, s);
      if (r instanceof Brk && r.label === null) return undefined;
      if (r !== undefined) return r;
    }
    return undefined;
  }
  execTry(n, scope) {
    let result;
    try {
      try {
        result = this.exec(n.block, scope);
      } catch (e) {
        if (e instanceof SandboxError) throw e;
        if (!n.handler) throw e;
        const s = new Scope(scope, false);
        const val = e instanceof ThrowSignal ? e.v : e;
        if (n.handler.param) this.bindPattern(n.handler.param, val, s, 'declare');
        result = this.exec(n.handler.body, s);
      }
    } finally {
      if (n.finalizer) {
        const f = this.exec(n.finalizer, scope);
        if (f !== undefined) result = f;
      }
    }
    return result;
  }

  truthy(v) { return !!this.U(v); }

  // ---------- binding ----------
  bindPattern(p, value, scope, mode) {
    switch (p.type) {
      case 'Identifier':
        if (mode === 'declare') scope.vars.set(p.name, value);
        else this.setVar(p.name, value, scope);
        return;
      case 'AssignmentPattern':
        if (value === undefined) value = this.ev(p.right, scope);
        this.bindPattern(p.left, value, scope, mode);
        return;
      case 'ArrayPattern': {
        const arr = Array.from(this.U(value) ?? []);
        p.elements.forEach((e, i) => {
          if (!e) return;
          if (e.type === 'RestElement') this.bindPattern(e.argument, arr.slice(i), scope, mode);
          else this.bindPattern(e, arr[i], scope, mode);
        });
        return;
      }
      case 'ObjectPattern': {
        const o = this.U(value);
        if (o == null) throw new TypeError('cannot destructure ' + o);
        for (const pr of p.properties) {
          if (pr.type === 'RestElement') continue;
          const key = pr.computed ? this.key(this.ev(pr.key, scope)) : pr.key.name !== undefined ? pr.key.name : String(pr.key.value);
          this.bindPattern(pr.value, this.getMember(o, key), scope, mode);
        }
        return;
      }
      case 'MemberExpression': this.assignTo(p, value, scope); return;
      default: throw new SandboxError('bad binding ' + p.type);
    }
  }

  setVar(name, value, scope) {
    const s = scope.find(name);
    if (s) { s.vars.set(name, value); return; }
    // implicit global (sloppy mode) -> top function scope
    let top = scope; while (top.parent) top = top.parent;
    top.vars.set(name, value);
  }

  assignTo(target, value, scope) {
    if (target.type === 'Identifier') { this.setVar(target.name, value, scope); return; }
    if (target.type === 'MemberExpression') {
      const obj = this.ev(target.object, scope);
      const key = this.memberKey(target, scope);
      this.setMember(obj, key, value);
      return;
    }
    this.bindPattern(target, value, scope, 'assign');
  }

  // ---------- member access ----------
  key(k) {
    k = this.U(k);
    if (typeof k === 'symbol') throw new SandboxError('symbol keys not allowed');
    if (typeof k === 'number') return k;
    k = String(k);
    return k;
  }
  memberKey(n, scope) {
    return n.computed ? this.key(this.ev(n.property, scope)) : n.property.name;
  }
  getMember(obj, key) {
    if (obj == null) throw new TypeError(`Cannot read property '${String(key)}' of ${obj}`);
    if (typeof key === 'string' && FORBIDDEN.has(key)) throw new SandboxError('forbidden property ' + key);
    const t = typeof obj;
    if ((t === 'object' || t === 'function') && typeof obj.__get === 'function') {
      const r = obj.__get(key);
      if (r !== NOT_HANDLED) return r;
    }
    return obj[key];
  }
  setMember(obj, key, value) {
    if (obj == null) throw new TypeError('Cannot set property of ' + obj);
    if (typeof key === 'string' && FORBIDDEN.has(key)) throw new SandboxError('forbidden property ' + key);
    if (this.host.isHost(obj)) return;
    if (typeof obj !== 'object' && typeof obj !== 'function') return;
    if (typeof obj === 'function') return;
    obj[key] = value;
  }

  // ---------- expressions ----------
  lookup(name, scope) {
    const s = scope.find(name);
    if (s) return s.vars.get(name);
    const r = this.host.lookup(name);
    if (r !== NOT_HANDLED) return r;
    throw new ReferenceError(name + ' is not defined');
  }

  ev(n, scope) {
    this.tick();
    switch (n.type) {
      case 'Literal':
        if (n.regex) throw new SandboxError('regex not supported');
        return n.value;
      case 'Identifier':
        if (n.name === 'undefined') return undefined;
        return this.lookup(n.name, scope);
      case 'ThisExpression': { const s = scope.find('%this'); return s ? s.vars.get('%this') : this.host.thisValue; }
      case 'TemplateLiteral': {
        let out = n.quasis[0].value.cooked;
        for (let i = 0; i < n.expressions.length; i++) out += String(this.U(this.ev(n.expressions[i], scope))) + n.quasis[i + 1].value.cooked;
        return out;
      }
      case 'ArrayExpression': {
        const out = [];
        for (const e of n.elements) {
          if (!e) out.push(undefined);
          else if (e.type === 'SpreadElement') out.push(...Array.from(this.U(this.ev(e.argument, scope))));
          else out.push(this.U(this.ev(e, scope)));
        }
        return out;
      }
      case 'ObjectExpression': {
        const o = {};
        for (const p of n.properties) {
          if (p.type === 'SpreadElement') { Object.assign(o, this.U(this.ev(p.argument, scope))); continue; }
          const k = p.computed ? this.key(this.ev(p.key, scope)) : p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
          if (typeof k === 'string' && FORBIDDEN.has(k)) throw new SandboxError('forbidden property ' + k);
          if (p.kind === 'get' || p.kind === 'set') {
            const f = this.makeFn(p.value, scope);
            Object.defineProperty(o, k, p.kind === 'get' ? { get: f, enumerable: true, configurable: true } : { set: f, enumerable: true, configurable: true });
          } else o[k] = this.ev(p.value, scope);
        }
        return o;
      }
      case 'FunctionExpression': case 'ArrowFunctionExpression': return this.makeFn(n, scope);
      case 'SequenceExpression': { let v; for (const e of n.expressions) v = this.ev(e, scope); return v; }
      case 'UnaryExpression': return this.unary(n, scope);
      case 'UpdateExpression': {
        const old = this.U(this.ev(n.argument, scope));
        const nv = n.operator === '++' ? old + 1 : old - 1;
        this.assignTo(n.argument, nv, scope);
        return n.prefix ? nv : old;
      }
      case 'BinaryExpression': return this.binary(n.operator, this.ev(n.left, scope), this.ev(n.right, scope), n);
      case 'LogicalExpression': {
        const l = this.ev(n.left, scope);
        if (n.operator === '&&') return this.truthy(l) ? this.ev(n.right, scope) : l;
        if (n.operator === '||') return this.truthy(l) ? l : this.ev(n.right, scope);
        return l == null ? this.ev(n.right, scope) : l;
      }
      case 'ConditionalExpression': return this.truthy(this.ev(n.test, scope)) ? this.ev(n.consequent, scope) : this.ev(n.alternate, scope);
      case 'AssignmentExpression': return this.assign(n, scope);
      case 'MemberExpression': {
        if (n.object.type === 'Super') throw new SandboxError('super');
        const obj = this.ev(n.object, scope);
        if (n.optional && obj == null) return undefined;
        return this.getMember(obj, this.memberKey(n, scope));
      }
      case 'ChainExpression': {
        try { return this.ev(n.expression, scope); } catch (e) { if (e instanceof TypeError) return undefined; throw e; }
      }
      case 'CallExpression': return this.call(n, scope);
      case 'NewExpression': {
        const C = this.ev(n.callee, scope);
        const args = this.evArgs(n.arguments, scope);
        if (typeof C !== 'function') throw new TypeError('not a constructor');
        if (C.__interp) {
          const o = {};
          const r = C.apply(o, args);
          return r !== null && typeof r === 'object' ? r : o;
        }
        return Reflect.construct(C, args);
      }
      default: throw new SandboxError('unsupported expression ' + n.type);
    }
  }

  evArgs(list, scope) {
    const out = [];
    for (const a of list) {
      if (a.type === 'SpreadElement') out.push(...Array.from(this.U(this.ev(a.argument, scope))));
      else out.push(this.U(this.ev(a, scope)));
    }
    return out;
  }

  call(n, scope) {
    const c = n.callee;
    let fn, thisArg;
    if (c.type === 'MemberExpression') {
      thisArg = this.ev(c.object, scope);
      if (c.optional && thisArg == null) return undefined;
      fn = this.getMember(thisArg, this.memberKey(c, scope));
    } else {
      fn = this.ev(c, scope);
      thisArg = undefined;
    }
    if (n.optional && fn == null) return undefined;
    if (typeof fn !== 'function') {
      const nm = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : 'expression';
      throw new TypeError(nm + ' is not a function');
    }
    const args = this.evArgs(n.arguments, scope);
    if (this.depth > 200) throw new SandboxError('call depth exceeded');
    this.depth++;
    try {
      return fn.apply(thisArg, args);
    } finally { this.depth--; }
  }

  unary(n, scope) {
    if (n.operator === 'typeof') {
      if (n.argument.type === 'Identifier') {
        const nm = n.argument.name;
        if (!scope.find(nm) && this.host.lookup(nm) === NOT_HANDLED && nm !== 'undefined') return 'undefined';
      }
      const v = this.ev(n.argument, scope);
      return typeof this.host.typeofValue(v);
    }
    if (n.operator === 'delete') {
      if (n.argument.type === 'MemberExpression') {
        const o = this.ev(n.argument.object, scope);
        if (o && typeof o === 'object' && !this.host.isHost(o)) return delete o[this.memberKey(n.argument, scope)];
      }
      return true;
    }
    const v = this.U(this.ev(n.argument, scope));
    switch (n.operator) {
      case '-': return isVec(v) ? v.map((x) => -x) : -v;
      case '+': return +v;
      case '!': return !v;
      case '~': return ~v;
      case 'void': return undefined;
      default: throw new SandboxError('unary ' + n.operator);
    }
  }

  assign(n, scope) {
    const op = n.operator;
    let value;
    if (op === '=') {
      value = this.ev(n.right, scope);
      value = this.U(value);
    } else {
      const cur = this.ev(n.left, scope);
      const r = this.ev(n.right, scope);
      const bop = op.slice(0, -1);
      if (bop === '&&') { if (!this.truthy(cur)) return cur; value = this.U(r); }
      else if (bop === '||') { if (this.truthy(cur)) return cur; value = this.U(r); }
      else if (bop === '??') { if (cur != null) return cur; value = this.U(r); }
      else value = this.binary(bop, cur, r, n);
    }
    if (n.left.type === 'Identifier' || n.left.type === 'MemberExpression') this.assignTo(n.left, value, scope);
    else this.bindPattern(n.left, value, scope, 'assign');
    return value;
  }

  binary(op, a, b) {
    a = this.U(a); b = this.U(b);
    switch (op) {
      case '+':
        if (typeof a === 'string' || typeof b === 'string') return a + b;
        if (isVec(a) || isVec(b)) return add(a, b);
        return a + b;
      case '-': return isVec(a) || isVec(b) ? sub(a, b) : a - b;
      case '*': return isVec(a) || isVec(b) ? mul(a, b) : a * b;
      case '/': return isVec(a) || isVec(b) ? div(a, b) : a / b;
      case '%': return isVec(a) || isVec(b) ? mod(a, b) : a % b;
      case '**': return a ** b;
      case '==': return a == b; // eslint-disable-line eqeqeq
      case '!=': return a != b; // eslint-disable-line eqeqeq
      case '===': return a === b;
      case '!==': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '<<': return a << b;
      case '>>': return a >> b;
      case '>>>': return a >>> b;
      case 'in':
        if (b == null || typeof b !== 'object') throw new TypeError("cannot use 'in'");
        if (typeof a === 'string' && FORBIDDEN.has(a)) return false;
        return a in b;
      case 'instanceof':
        if (typeof b !== 'function') throw new TypeError('bad instanceof');
        return a instanceof b;
      default: throw new SandboxError('binary ' + op);
    }
  }

  // ---------- functions ----------
  makeFn(node, scope) {
    const self = this;
    const isArrow = node.type === 'ArrowFunctionExpression';
    const f = function (...args) {
      return self.invoke(node, scope, isArrow, this, args);
    };
    f.__interp = true;
    return f;
  }

  invoke(node, closure, isArrow, thisArg, args) {
    const s = new Scope(closure, true);
    if (!isArrow) {
      s.vars.set('%this', thisArg === undefined ? this.host.thisValue : thisArg);
      s.vars.set('arguments', args);
    }
    node.params.forEach((p, i) => {
      if (p.type === 'RestElement') this.bindPattern(p.argument, args.slice(i), s, 'declare');
      else this.bindPattern(p, args[i], s, 'declare');
    });
    if (node.name) { /* name only */ }
    if (node.id && node.type === 'FunctionExpression' && !s.vars.has(node.id.name)) { /* self ref resolved via closure not needed */ }
    if (node.expression) { // arrow with expression body
      return this.U(this.ev(node.body, s));
    }
    const vars = [];
    collectVars(node.body, vars);
    for (const nm of vars) if (!s.vars.has(nm)) s.vars.set(nm, undefined);
    this.hoist(node.body.body, s);
    const sig = this.execList(node.body.body, s);
    if (sig instanceof Return) return sig.v;
    if (sig instanceof ThrowSignal) throw sig.v;
    return undefined;
  }
}
