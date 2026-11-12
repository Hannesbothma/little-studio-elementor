(() => {
  "use strict";
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function kind(message) {
    if (/^Skipped /i.test(message)) return "skipped";
    if (
      /could not (?:package|be packaged)|stylesheet.*not fetched|stylesheet.*must be packaged/i.test(
        message,
      )
    )
      return "missing";
    if (
      /external file needs review|left external|circular stylesheet/i.test(
        message,
      )
    )
      return "review";
    if (
      /was omitted|initialization.*omitted|captured scripts will run|review the imported layout and behavio[u]?r/i.test(
        message,
      )
    )
      return "notes";
    if (
      /connect \d+|need(?:s)? (?:a destination|its original|manual)|manual rebuilding|must be configured|not downloaded|event handlers are removed|rebuilt as/i.test(
        message,
      )
    )
      return "features";
    return "review";
  }
  function groups(messages) {
    const result = [
      {
        id: "skipped",
        title: "Skipped items — retry with Update from file",
        items: [],
      },
      { id: "missing", title: "Missing resources", items: [] },
      { id: "review", title: "Resources and styling to review", items: [] },
      {
        id: "features",
        title: "Features needing setup or rebuilding",
        items: [],
      },
      { id: "notes", title: "Capture notes", items: [] },
    ];
    const byKind = new Map(result.map((group) => [group.id, group])),
      seen = new Set();
    for (const message of messages || []) {
      if (typeof message !== "string" || !message.trim()) continue;
      const category = kind(message);
      const url = message
        .match(/https?:\/\/[^\s"'<>]+/)?.[0]
        .replace(/[:.,;]+$/, "");
      // A failed download and its follow-up stylesheet notice describe one resource.
      const key =
        category === "missing" && url ? category + ":" + url : message;
      if (seen.has(key)) continue;
      seen.add(key);
      byKind.get(category).items.push(message);
    }
    return result.filter((group) => group.items.length);
  }
  function render(messages) {
    return groups(messages)
      .map((group) => {
        const content =
          "<ul>" +
          group.items
            .map((message) => "<li>" + escape(message) + "</li>")
            .join("") +
          "</ul>";
        return group.id === "notes"
          ? '<details class="lse-findings-group lse-findings-notes"><summary>' +
              group.title +
              " (" +
              group.items.length +
              ")</summary>" +
              content +
              "</details>"
          : '<section class="lse-findings-group lse-findings-' +
              group.id +
              '"><h4>' +
              group.title +
              "</h4>" +
              content +
              "</section>";
      })
      .join("");
  }
  window.LSEReports = {
    groups,
    render,
    needsReview: (messages) =>
      groups(messages).some((group) => group.id !== "notes"),
  };
})();
