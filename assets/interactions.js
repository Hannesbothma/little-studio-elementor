(() => {
  "use strict";
  if (window.LSEInteractions) return;
  const registrations = new Map();
  let scheduled = false;
  const menuStyles = new WeakMap();
  const bridgedImages = new WeakMap();
  function bridgeNativeImages() {
    for (const wrapper of document.querySelectorAll(
      '.elementor-widget-image[data-lse-source-tag="img"]',
    )) {
      const image = wrapper.querySelector("img");
      if (!image || bridgedImages.get(wrapper) === image) continue;
      bridgedImages.set(wrapper, image);
      // Source scripts address the original image by its class/ID. Elementor
      // owns that outer widget now; relay image properties to its real <img>.
      for (const property of [
        "src",
        "srcset",
        "sizes",
        "alt",
        "title",
        "width",
        "height",
      ])
        Object.defineProperty(wrapper, property, {
          configurable: true,
          get: () => image[property],
          set(value) {
            if (property === "src") {
              image.removeAttribute("srcset");
              image.removeAttribute("sizes");
            }
            image[property] = value;
          },
        });
      for (const property of [
        "currentSrc",
        "naturalWidth",
        "naturalHeight",
        "complete",
      ])
        Object.defineProperty(wrapper, property, {
          configurable: true,
          get: () => image[property],
        });
      if (image.decode) wrapper.decode = image.decode.bind(image);
    }
  }
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
    const id = toggle.getAttribute("data-lse-menu-toggle");
    const panel = toggle
      .closest("[data-lse-interactive]")
      ?.querySelector("#" + CSS.escape(id));
    if (!panel) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("lse-source-elementor-active", open);
    panel.hidden = !open;
    panel.toggleAttribute("data-lse-menu-open", open);
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
  function hoverSubmenu(event, open) {
    if (event.pointerType !== "mouse") return;
    const item = event.target.closest?.("[data-lse-submenu-item]");
    if (!item?.closest(".lse-source-elementor-nav-menu--main")) return;
    if (item.contains(event.relatedTarget)) return;
    if (!open && item.contains(document.activeElement)) return;
    const toggle = item.querySelector(":scope > [data-lse-submenu-button]");
    if (toggle) toggleMenu(toggle, open);
  }
  document.addEventListener("pointerover", (event) =>
    hoverSubmenu(event, true),
  );
  document.addEventListener("pointerout", (event) =>
    hoverSubmenu(event, false),
  );
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
  // Atomic tabs retain their authored markup and styling without the source runtime.
  const atomicTabs = "[data-lse-interactive] .e-tabs-base";
  function tabsFor(tab) {
    const group = tab?.closest(atomicTabs);
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('button[role="tab"][aria-controls]'),
    )
      .filter((button) => button.closest(".e-tabs-base") === group)
      .map((button) => ({
        button,
        panel: document.getElementById(button.getAttribute("aria-controls")),
      }))
      .filter(
        ({ button, panel }) =>
          !button.disabled &&
          panel?.matches('[role="tabpanel"]') &&
          panel.closest(".e-tabs-base") === group,
      );
  }
  function selectTab(tab, tabs) {
    for (const { button, panel } of tabs) {
      const selected = button === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("e--selected", selected);
      panel.classList.toggle("e--selected", selected);
      panel.hidden = !selected;
      if (selected) {
        if (panel.style.display === "none")
          panel.style.removeProperty("display");
      } else {
        panel.style.display = "none";
      }
    }
  }
  document.addEventListener("click", (event) => {
    const tab = event.target.closest?.('button[role="tab"]');
    const tabs = tabsFor(tab);
    if (tabs.some(({ button }) => button === tab)) {
      event.preventDefault();
      selectTab(tab, tabs);
      return;
    }
    const toggle = event.target.closest?.("[data-lse-menu-toggle]");
    if (toggle) {
      event.preventDefault();
      toggleMenu(toggle, toggle.getAttribute("aria-expanded") !== "true");
    }
  });
  document.addEventListener("keydown", (event) => {
    const tab = event.target.closest?.('button[role="tab"]');
    const list = tab?.closest('[role="tablist"]');
    const vertical = list?.getAttribute("aria-orientation") === "vertical";
    const rtl = list && getComputedStyle(list).direction === "rtl";
    const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    if (tab && [forward, backward, "Home", "End"].includes(event.key)) {
      const tabs = tabsFor(tab);
      const current = tabs.findIndex(({ button }) => button === tab);
      if (current !== -1) {
        const last = tabs.length - 1;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : (current + (event.key === forward ? 1 : last)) % tabs.length;
        event.preventDefault();
        selectTab(tabs[next].button, tabs);
        tabs[next].button.focus();
        return;
      }
    }
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
    bridgeNativeImages();
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
      registration.run.call(window);
    } catch (error) {
      console.error("Website interaction could not start:", error);
    } finally {
      EventTarget.prototype.addEventListener = originalAdd;
    }
    // Source scripts can create controls (for example gallery playback buttons)
    // after conversion. Keep their original CSS scoped to that new content,
    // just as it is for copied HTML, without styling native Elementor controls.
    for (const node of document.querySelectorAll(".lse-imported-site *")) {
      if (
        !before.has(node) &&
        !node.parentElement?.closest("[data-lse-source-content]") &&
        !node.hasAttribute("data-lse-native") &&
        !node.classList.contains("elementor-element")
      )
        node.setAttribute("data-lse-source-content", "");
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
