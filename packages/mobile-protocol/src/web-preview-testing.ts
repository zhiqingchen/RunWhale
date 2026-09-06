/** Runs only inside the project WebView. It has no host RPC token or Studio bindings. */
export const webPreviewTestingScript = String.raw`
(() => {
  if (window.__runwhalePreviewTest) return;
  let logSequence = 0, snapshotSequence = 0, epoch = 0, snapshotEpoch = -1, snapshotId = '';
  let nodes = new Map();
  const logs = [];
  const bounded = value => {
    try { return (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)).slice(0, 2048); }
    catch { return '[unserializable]'; }
  };
  const log = (level, values) => {
    logs.push({ sequence: ++logSequence, timestamp: Date.now(), level, message: values.map(bounded).join(' ').slice(0, 2048) });
    if (logs.length > 100) logs.shift();
  };
  for (const level of ['debug', 'log', 'info', 'warn', 'error']) {
    const original = console[level];
    console[level] = function(...values) { log(level === 'log' ? 'info' : level, values); return original.apply(console, values); };
  }
  window.addEventListener('error', event => log('error', [event.error?.stack || event.message]));
  window.addEventListener('unhandledrejection', event => log('error', [event.reason?.stack || event.reason]));
  const observer = new MutationObserver(() => epoch++);
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  window.addEventListener('scroll', () => epoch++, true);
  window.addEventListener('resize', () => epoch++);
  const bounds = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const visible = element => {
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    return element.isConnected && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  const viewport = () => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio });
  const describe = (element, id, parentId) => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') || ({ button: 'button', a: 'link', input: element.type === 'checkbox' ? 'checkbox' : 'textbox', textarea: 'textbox', img: 'image', select: 'combobox' })[tag] || tag;
    const enabled = !element.disabled && element.getAttribute('aria-disabled') !== 'true';
    const actions = [];
    if (enabled && (['button','a','input','select','summary'].includes(tag) || ['button','link','checkbox','switch','tab'].includes(role) || element.onclick)) actions.push('press');
    const secure = tag === 'input' && ['password','file','hidden'].includes(element.type);
    if (enabled && !secure && !element.readOnly && (tag === 'textarea' || tag === 'input' && ['text','email','search','tel','url','number'].includes(element.type))) actions.push('fill');
    if (element.scrollHeight > element.clientHeight && /(auto|scroll)/.test(getComputedStyle(element).overflowY)) actions.push('scroll');
    return { id, ...(parentId ? {parentId} : {}), role, text: element.children.length ? '' : (element.textContent || '').slice(0,512), label: (element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('placeholder') || '').slice(0,512), testId: (element.getAttribute('data-testid') || '').slice(0,256), ...(!secure && 'value' in element ? { value: String(element.value).slice(0,512) } : {}), bounds: bounds(element), visible: visible(element), enabled, selected: Boolean(element.checked || element.selected || element.getAttribute('aria-selected') === 'true'), actions };
  };
  window.__runwhalePreviewTest = (id, command) => {
    let result;
    try {
      if (observer.takeRecords().length) epoch++;
      if (command.kind === 'close') {
        snapshotId = '';
        snapshotEpoch = -1;
        nodes.clear();
        result = { closed: true };
      } else if (command.kind === 'logs') {
        result = { logs: logs.filter(entry => entry.sequence > command.afterSequence), nextSequence: logSequence, gap: logs.length > 0 && command.afterSequence < logs[0].sequence - 1 };
      } else if (command.kind === 'inspect') {
        nodes = new Map();
        const output = [], queue = document.body ? [[document.body, undefined]] : [];
        let visited = 0;
        while (queue.length && output.length < 250 && visited++ < 2000) {
          const [element, parentId] = queue.shift();
          if (['SCRIPT','STYLE','META','LINK'].includes(element.tagName)) continue;
          const nodeId = 'n' + (output.length + 1);
          nodes.set(nodeId, element);
          output.push(describe(element, nodeId, parentId));
          for (const child of element.children) queue.push([child, nodeId]);
        }
        snapshotId = 'web-' + Date.now() + '-' + (++snapshotSequence);
        snapshotEpoch = epoch;
        result = { snapshotId, nodes: output, truncated: queue.length > 0, viewport: viewport() };
      } else if (command.kind === 'action') {
        if (command.snapshotId !== snapshotId || snapshotEpoch !== epoch) throw Error('The node snapshot is stale. Inspect again.');
        const element = nodes.get(command.nodeId);
        if (!element || !visible(element)) throw Error('The target is no longer visible. Inspect again.');
        const node = describe(element, command.nodeId);
        if (!node.actions.includes(command.action)) throw Error('This node does not support that action.');
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.max(0,rect.left) + Math.min(rect.width,innerWidth-Math.max(0,rect.left))/2, Math.max(0,rect.top) + Math.min(rect.height,innerHeight-Math.max(0,rect.top))/2);
        if (!hit || !(element === hit || element.contains(hit))) throw Error('The target is covered by another element.');
        snapshotEpoch = -1;
        if (command.action === 'press') element.click();
        else if (command.action === 'fill') {
          if (typeof command.text !== 'string') throw Error('fill requires text');
          element.focus();
          const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, command.text);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          if (!['up','down'].includes(command.direction)) throw Error('scroll requires up or down');
          element.scrollBy({ top: (command.direction === 'up' ? -1 : 1) * element.clientHeight * 0.75, behavior: 'instant' });
        }
        result = { performed: true, method: 'dom-event' };
      } else throw Error('Unsupported Web Preview command');
    } catch (error) { result = { error: String(error.message || error) }; }
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'runwhale.preview.test', id, result: { ...result, timestamp: Date.now() } }));
  };
})(); true;
`
