(() => {
  "use strict";
  if (window.LSEScrolling) return;
  const instances = new Map();
  const activeClass = "lse-source-elementor-sticky--active";
  const effectsClass = "lse-source-elementor-sticky--effects";
  const properties = [
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "width",
    "margin-top",
    "margin-bottom",
    "z-index",
  ];
  let frame = 0;
  const number = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : 0;
  const device = () =>
    innerWidth <= 767 ? "mobile" : innerWidth <= 1024 ? "tablet" : "desktop";
  function restore(state) {
    for (const [name, value, priority] of state.original) {
      if (value) state.node.style.setProperty(name, value, priority);
      else state.node.style.removeProperty(name);
    }
    if (state.placeholder) state.resize.unobserve(state.placeholder);
    state.placeholder?.remove();
    state.placeholder = null;
    state.node.classList.remove(activeClass, effectsClass);
  }
  function scan() {
    for (const [node, state] of instances) {
      if (
        !node.isConnected ||
        node.getAttribute("data-lse-sticky") !== state.raw
      ) {
        restore(state);
        state.resize.disconnect();
        instances.delete(node);
      }
    }
    for (const node of document.querySelectorAll("[data-lse-sticky]")) {
      if (instances.has(node)) continue;
      let config;
      try {
        config = JSON.parse(node.getAttribute("data-lse-sticky"));
      } catch {
        continue;
      }
      if (
        !["top", "bottom"].includes(config?.edge) ||
        !Array.isArray(config.devices)
      )
        continue;
      const state = {
        node,
        config,
        raw: node.getAttribute("data-lse-sticky"),
        placeholder: null,
        original: properties.map((name) => [
          name,
          node.style.getPropertyValue(name),
          node.style.getPropertyPriority(name),
        ]),
        resize: new ResizeObserver(schedule),
      };
      state.resize.observe(node);
      instances.set(node, state);
      node.classList.add("lse-source-elementor-sticky");
    }
  }
  function adminOffset() {
    const bar = document.getElementById("wpadminbar");
    if (!bar || getComputedStyle(bar).display === "none") return 0;
    return Math.max(0, bar.getBoundingClientRect().bottom);
  }
  function update(state) {
    const { node, config } = state;
    const current = device();
    if (
      !config.devices.includes(current) ||
      getComputedStyle(node).display === "none"
    ) {
      if (state.placeholder) restore(state);
      return;
    }
    const offsets = config.offsets || {};
    const offset = number(
      offsets[current] ??
        (current === "mobile" ? offsets.tablet : undefined) ??
        offsets.desktop,
    );
    const edge =
      config.edge === "top" ? offset + adminOffset() : innerHeight - offset;
    const anchor = (state.placeholder || node).getBoundingClientRect();
    const activate =
      config.edge === "top" ? anchor.top <= edge : anchor.bottom >= edge;
    if (!activate) {
      if (state.placeholder) restore(state);
      return;
    }
    if (!state.placeholder) {
      const placeholder = node.cloneNode(false);
      for (const attr of [...placeholder.attributes]) {
        if (attr.name !== "class" && attr.name !== "style")
          placeholder.removeAttribute(attr.name);
      }
      placeholder.classList.remove(activeClass, effectsClass);
      placeholder.setAttribute("data-lse-sticky-placeholder", "");
      placeholder.setAttribute("aria-hidden", "true");
      for (const [name, value] of Object.entries({
        position: "static",
        visibility: "hidden",
        pointerEvents: "none",
        minHeight: "0",
        maxHeight: "none",
        height: node.getBoundingClientRect().height + "px",
      })) {
        placeholder.style.setProperty(
          name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
          value,
          "important",
        );
      }
      node.after(placeholder);
      state.placeholder = placeholder;
      state.resize.observe(placeholder);
    }
    node.style.setProperty("position", "fixed", "important");
    const rect = state.placeholder.getBoundingClientRect();
    const zIndex = getComputedStyle(node).zIndex;
    for (const [name, value] of Object.entries({
      position: "fixed",
      width: rect.width + "px",
      left: rect.left + "px",
      right: "auto",
      bottom: "auto",
      "margin-top": "0px",
      "margin-bottom": "0px",
      "z-index": zIndex === "auto" ? "100" : zIndex,
    })) {
      node.style.setProperty(name, value, "important");
    }
    // Preserve the normal-flow spacer when a source scroll effect shrinks the header.
    // Both measurements happen before paint; the editor never runs this adapter.
    node.classList.remove(activeClass, effectsClass);
    const naturalHeight = node.getBoundingClientRect().height;
    node.classList.add(activeClass);
    node.classList.toggle(
      effectsClass,
      scrollY >= rect.top + scrollY + number(config.effects),
    );
    const height = node.getBoundingClientRect().height;
    let top = config.edge === "top" ? edge : edge - height;
    if (config.parent) {
      const parent = state.placeholder.parentElement.getBoundingClientRect();
      top =
        config.edge === "top"
          ? Math.min(top, parent.bottom - height)
          : Math.max(top, parent.top);
    }
    node.style.setProperty("top", top + "px", "important");
    state.placeholder.style.setProperty(
      "height",
      naturalHeight + "px",
      "important",
    );
  }
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      scan();
      for (const state of instances.values()) update(state);
    });
  }
  window.LSEScrolling = { refresh: schedule };
  addEventListener("scroll", schedule, { passive: true, capture: true });
  addEventListener("resize", schedule, { passive: true });
  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-lse-sticky"],
  });
  schedule();
})();
