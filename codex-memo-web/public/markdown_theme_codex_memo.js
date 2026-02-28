(() => {
  const THEME = {
    heading: {
      common: {
        fontWeight: "700",
        margin: "0.5em 0 0.35em"
      },
      h1: {
        fontSize: "1.26em",
        padding: "0 0 0.24em",
        borderRadius: "0",
        background: "transparent",
        border: "0",
        borderBottom: "1px solid #d8d3cc",
        marginBottom: "0.72em"
      },
      h2: {
        fontSize: "1.05em",
        color: "#605e5a",
        marginTop: "0.95em",
        marginBottom: "0.45em",
        paddingLeft: "0.5em",
        borderLeft: "2px solid #d8d3cc"
      },
      h3: {
        fontSize: "1.02em",
        color: "#626b78",
        marginTop: "0.8em",
        marginBottom: "0.3em",
        fontWeight: "650"
      },
      afterBlockTop: "1.25em"
    },
    small: {
      fontSize: "0.8em",
      color: "#64748b",
      lineHeight: "1.25"
    },
    paragraph: {
      margin: "0.4em 0",
      consecutiveTop: "0.9em"
    },
    list: {
      margin: "0.7em 0",
      paddingLeft: "1.25em",
      itemMargin: "0.22em 0",
      chainTop: "1.4em",
      afterParagraphTop: "1.05em",
      afterTableQuotePreTop: "1.35em",
      beforeClosingMessageTop: "0.9em",
      ulType: "disc",
      olType: "decimal"
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      margin: "0.95em 0",
      fontSize: "0.94em",
      cellBorder: "1px solid #cbd5e1",
      cellPadding: "4px 8px",
      thBackground: "#f3f4f6",
      thWeight: "600"
    },
    blockquote: {
      margin: "0.74em 0",
      padding: "0.28em 0 0.22em 1.02em",
      backgroundColor: "#f3f1ec",
      lineColor: "#cfc8bf",
      lineWidth: "4px",
      lineHeightCut: "18px",
      lineX: "6px",
      lineTop: "9px",
      color: "#5f5950",
      borderRadius: "8px"
    },
    code: {
      inline: {
        background: "#666e79",
        color: "#f7f5ef",
        fontSize: "0.96em",
        fontWeight: "400",
        borderRadius: "4px",
        border: "1.5px solid #828a95",
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        padding: "1px 4px"
      },
      block: {
        margin: "0.95em 0",
        background: "#666e79",
        color: "#f7f5ef",
        fontSize: "0.96em",
        borderRadius: "8px",
        border: "1.5px solid #828a95",
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        padding: "8px",
        overflowX: "hidden",
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        lineHeight: "1.45"
      },
      nestedInPre: {
        background: "transparent",
        color: "inherit",
        border: "0",
        boxShadow: "none",
        padding: "0",
        borderRadius: "0",
        whiteSpace: "inherit",
        wordBreak: "inherit",
        overflowWrap: "inherit"
      }
    }
  };

  function applyStyles(node, styles) {
    if (!node || !styles) return;
    Object.entries(styles).forEach(([key, value]) => {
      node.style[key] = value;
    });
  }

  function forEach(root, selector, fn) {
    root.querySelectorAll(selector).forEach(fn);
  }

  function apply(root, overrides = {}) {
    if (!root) return;
    const theme = {
      ...THEME,
      ...overrides,
      heading: { ...THEME.heading, ...(overrides.heading || {}) },
      small: { ...THEME.small, ...(overrides.small || {}) },
      paragraph: { ...THEME.paragraph, ...(overrides.paragraph || {}) },
      list: { ...THEME.list, ...(overrides.list || {}) },
      table: { ...THEME.table, ...(overrides.table || {}) },
      blockquote: { ...THEME.blockquote, ...(overrides.blockquote || {}) },
      code: {
        ...THEME.code,
        ...(overrides.code || {}),
        inline: { ...THEME.code.inline, ...((overrides.code || {}).inline || {}) },
        block: { ...THEME.code.block, ...((overrides.code || {}).block || {}) },
        nestedInPre: { ...THEME.code.nestedInPre, ...((overrides.code || {}).nestedInPre || {}) }
      }
    };
    theme.heading = {
      ...theme.heading,
      common: { ...THEME.heading.common, ...((theme.heading || {}).common || {}) },
      h1: { ...THEME.heading.h1, ...((theme.heading || {}).h1 || {}) },
      h2: { ...THEME.heading.h2, ...((theme.heading || {}).h2 || {}) },
      h3: { ...THEME.heading.h3, ...((theme.heading || {}).h3 || {}) }
    };

    forEach(root, "h1,h2,h3", (n) => applyStyles(n, theme.heading.common));
    forEach(root, "h1", (n) => applyStyles(n, theme.heading.h1));
    forEach(root, "h2", (n) => applyStyles(n, theme.heading.h2));
    forEach(root, "h3", (n) => applyStyles(n, theme.heading.h3));
    forEach(root, "small", (n) => applyStyles(n, theme.small));

    forEach(
      root,
      "p + h1, p + h2, p + h3, ul + h1, ul + h2, ul + h3, ol + h1, ol + h2, ol + h3, table + h1, table + h2, table + h3, blockquote + h1, blockquote + h2, blockquote + h3, pre + h1, pre + h2, pre + h3",
      (n) => { n.style.marginTop = theme.heading.afterBlockTop; }
    );

    forEach(root, "p", (n) => { n.style.margin = theme.paragraph.margin; });
    forEach(root, "p + p", (n) => { n.style.marginTop = theme.paragraph.consecutiveTop; });

    forEach(root, "ul,ol", (n) => {
      n.style.margin = theme.list.margin;
      n.style.paddingLeft = theme.list.paddingLeft;
    });
    forEach(root, "ul", (n) => { n.style.listStyleType = theme.list.ulType; });
    forEach(root, "ul.md-list-dash", (n) => {
      n.style.listStyleType = "none";
      n.style.paddingLeft = "0";
    });
    forEach(root, "ol", (n) => { n.style.listStyleType = theme.list.olType; });
    forEach(root, "li", (n) => {
      n.style.display = "list-item";
      n.style.margin = theme.list.itemMargin;
    });
    forEach(root, "ul.md-list-dash > li", (n) => n.classList.add("md-dash-list-item"));

    forEach(root, "table", (n) => applyStyles(n, {
      width: theme.table.width,
      borderCollapse: theme.table.borderCollapse,
      margin: theme.table.margin,
      fontSize: theme.table.fontSize
    }));
    forEach(root, "th,td", (n) => applyStyles(n, {
      border: theme.table.cellBorder,
      padding: theme.table.cellPadding,
      verticalAlign: "top",
      textAlign: "left"
    }));
    forEach(root, "th", (n) => applyStyles(n, {
      background: theme.table.thBackground,
      fontWeight: theme.table.thWeight
    }));

    forEach(root, "blockquote", (n) => {
      n.style.margin = theme.blockquote.margin;
      n.style.padding = theme.blockquote.padding;
      n.style.borderLeft = "0";
      n.style.backgroundColor = theme.blockquote.backgroundColor;
      n.style.backgroundImage = `linear-gradient(${theme.blockquote.lineColor}, ${theme.blockquote.lineColor})`;
      n.style.backgroundRepeat = "no-repeat";
      n.style.backgroundSize = `${theme.blockquote.lineWidth} calc(100% - ${theme.blockquote.lineHeightCut})`;
      n.style.backgroundPosition = `left ${theme.blockquote.lineX} top ${theme.blockquote.lineTop}`;
      n.style.color = theme.blockquote.color;
      n.style.borderRadius = theme.blockquote.borderRadius;
    });

    forEach(root, "img", (n) => applyStyles(n, {
      display: "block",
      maxWidth: "100%",
      height: "auto",
      margin: "0.7em 0",
      border: "1px solid rgba(91, 105, 129, 0.12)",
      borderRadius: "8px",
      cursor: "zoom-in"
    }));

    forEach(root, "pre", (n) => { n.style.margin = theme.code.block.margin; });
    forEach(root, "p + ul, p + ol, p + table, p + blockquote, p + pre", (n) => {
      n.style.marginTop = theme.list.afterParagraphTop;
    });
    forEach(root, "ul + ul, ul + ol, ol + ul, ol + ol", (n) => {
      n.style.marginTop = theme.list.chainTop;
    });
    forEach(root, "table + p, blockquote + p, pre + p", (n) => {
      n.style.marginTop = theme.list.afterParagraphTop;
    });
    forEach(root, "table + ul, table + ol, blockquote + ul, blockquote + ol, pre + ul, pre + ol", (n) => {
      n.style.marginTop = theme.list.afterTableQuotePreTop;
    });
    forEach(root, "ul + p, ol + p", (n) => {
      n.style.marginTop = theme.list.beforeClosingMessageTop;
    });

    forEach(root, "code", (n) => applyStyles(n, theme.code.inline));
    forEach(root, "pre", (n) => applyStyles(n, {
      background: theme.code.block.background,
      color: theme.code.block.color,
      fontSize: theme.code.block.fontSize,
      borderRadius: theme.code.block.borderRadius,
      border: theme.code.block.border,
      boxShadow: theme.code.block.boxShadow,
      padding: theme.code.block.padding,
      overflowX: theme.code.block.overflowX,
      overflowY: theme.code.block.overflowY,
      whiteSpace: theme.code.block.whiteSpace,
      wordBreak: theme.code.block.wordBreak,
      overflowWrap: theme.code.block.overflowWrap,
      lineHeight: theme.code.block.lineHeight
    }));
    forEach(root, "pre code", (n) => applyStyles(n, theme.code.nestedInPre));
  }

  window.CodexMemoMarkdownTheme = {
    name: "codex-memo",
    tokens: THEME,
    apply
  };
})();
