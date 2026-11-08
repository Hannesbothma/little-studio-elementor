(() => {
  'use strict';
  if (window.LSEInteractions) return;
  const registrations = new Map();
  let scheduled = false;

  // Imported local forms keep validation and input events, never an accidental POST.
  document.addEventListener('submit', event => {
    if (event.target.matches('[data-lse-interactive] form')) event.preventDefault();
  }, true);

  function start(registration) {
    const nodes = [...document.querySelectorAll('[data-lse-interactive]')];
    if (!nodes.length || (registration.nodes?.length === nodes.length && nodes.every((node, i) => node === registration.nodes[i]))) return;
    registration.cleanup?.();
    registration.nodes = nodes;
    const listeners = [];
    const before = new Map([...document.querySelectorAll('*')].map(node => [node, new Set(node.getAttributeNames())]));
    const originalAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      listeners.push([this, type, listener, options]);
      return originalAdd.call(this, type, listener, options);
    };
    try { registration.run(); }
    catch (error) { console.error('Website interaction could not start:', error); }
    finally { EventTarget.prototype.addEventListener = originalAdd; }
    const markers = [];
    for (const [node, attributes] of before) {
      for (const name of node.getAttributeNames()) {
        if (!attributes.has(name) && /^data-[\w-]+-ready$/.test(name)) markers.push([node, name]);
      }
    }
    registration.cleanup = () => {
      for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options);
      for (const [node, name] of markers) node.removeAttribute(name);
    };
  }

  function refresh() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      for (const registration of registrations.values()) start(registration);
    }, 80);
  }

  window.LSEInteractions = {
    register(id, run) {
      registrations.get(id)?.cleanup?.();
      const registration = {run};
      registrations.set(id, registration);
      start(registration);
    },
    refresh
  };
  new MutationObserver(refresh).observe(document.documentElement, {childList: true, subtree: true});
  if (window.jQuery) {
    window.jQuery(window).on('elementor/frontend/init', () => {
      window.elementorFrontend?.hooks.addAction('frontend/element_ready/global', refresh);
      refresh();
    });
  }
})();
