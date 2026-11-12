(() => {
  "use strict";
  if (window.LSEInteractions) return;
  const registrations = new Map();
  let scheduled = false;
  const menuStyles = new WeakMap();
  const menuProperties = [
    "display",
    "max-height",
    "visibility",
    "opacity",
    "transform",
    "position",
    "width",
    "left",
    "right",
  ];
  function stretchMenu(panel) {
    panel.style.position = "absolute";
    const parent = panel.offsetParent || panel.parentElement;
    Object.assign(panel.style, {
      position: "absolute",
      width: document.documentElement.clientWidth + "px",
      left: -parent.getBoundingClientRect().left + "px",
      right: "auto",
    });
  }

  // Imported local forms keep validation and input events, never an accidental POST.
  document.addEventListener(
    "submit",
    (event) => {
      if (event.target.matches("[data-lse-interactive] form"))
        event.preventDefault();
    },
    true,
  );

  function toggleMenu(toggle, open) {
    const panel = document.getElementById(
      toggle.getAttribute("data-lse-menu-toggle"),
    );
    if (!panel || !toggle.closest("[data-lse-interactive]")?.contains(panel))
      return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("lse-source-elementor-active", open);
    panel.hidden = !open;
    if (open) {
      if (!menuStyles.has(panel))
        menuStyles.set(
          panel,
          menuProperties.map((name) => [
            name,
            panel.style.getPropertyValue(name),
            panel.style.getPropertyPriority(name),
          ]),
        );
      Object.assign(panel.style, {
        display: "block",
        maxHeight: "none",
        visibility: "visible",
        opacity: "1",
        transform: "none",
      });
      if (panel.hasAttribute("data-lse-menu-stretch")) stretchMenu(panel);
    } else {
      for (const [name, value, priority] of menuStyles.get(panel) || []) {
        if (value) panel.style.setProperty(name, value, priority);
        else panel.style.removeProperty(name);
      }
      menuStyles.delete(panel);
    }
  }
  window.addEventListener(
    "resize",
    () => {
      for (const panel of document.querySelectorAll(
        "[data-lse-menu-stretch]:not([hidden])",
      ))
        stretchMenu(panel);
    },
    { passive: true },
  );
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest?.("[data-lse-menu-toggle]");
    if (toggle) {
      event.preventDefault();
      toggleMenu(toggle, toggle.getAttribute("aria-expanded") !== "true");
    }
  });
  document.addEventListener("keydown", (event) => {
    const toggle = event.target.closest?.("[data-lse-menu-toggle]");
    if (
      toggle &&
      ["Enter", " "].includes(event.key) &&
      toggle.tagName !== "BUTTON"
    ) {
      event.preventDefault();
      toggleMenu(toggle, toggle.getAttribute("aria-expanded") !== "true");
    }
    if (event.key === "Escape")
      for (const open of document.querySelectorAll(
        '[data-lse-menu-toggle][aria-expanded="true"]',
      ))
        toggleMenu(open, false);
  });

  function start(registration) {
    const nodes = [...document.querySelectorAll("[data-lse-interactive]")];
    if (
      registration.started &&
      registration.nodes?.length === nodes.length &&
      nodes.every((node, i) => node === registration.nodes[i])
    )
      return;
    registration.cleanup?.();
    registration.started = true;
    registration.nodes = nodes;
    const listeners = [];
    const before = new Map(
      [...document.querySelectorAll("*")].map((node) => [
        node,
        new Set(node.getAttributeNames()),
      ]),
    );
    const originalAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      type,
      listener,
      options,
    ) {
      listeners.push([this, type, listener, options]);
      return originalAdd.call(this, type, listener, options);
    };
    try {
      registration.run();
    } catch (error) {
      console.error("Website interaction could not start:", error);
    } finally {
      EventTarget.prototype.addEventListener = originalAdd;
    }
    const markers = [];
    for (const [node, attributes] of before) {
      for (const name of node.getAttributeNames()) {
        if (!attributes.has(name) && /^data-[\w-]+-ready$/.test(name))
          markers.push([node, name]);
      }
    }
    registration.cleanup = () => {
      for (const [target, type, listener, options] of listeners)
        target.removeEventListener(type, listener, options);
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
      const registration = { run };
      registrations.set(id, registration);
      start(registration);
    },
    refresh,
  };
  new MutationObserver(refresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  if (window.jQuery) {
    window.jQuery(window).on("elementor/frontend/init", () => {
      window.elementorFrontend?.hooks.addAction(
        "frontend/element_ready/global",
        refresh,
      );
      refresh();
    });
  }
})();
