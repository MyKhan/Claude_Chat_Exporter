(function setupClaudeMarkdownExporter() {
  const originalWriteText = navigator.clipboard.writeText;

  const capturedResponses = [];
  const humanMessages = [];

  let currentCapture = null;
  let captureEnabled = false;
  let statusDiv = null;

  const SELECTORS = {
    copyButton: 'button[data-testid="action-bar-copy"]',
    conversationTitle:
      '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] div.truncate',
    messageActionsGroup: '[role="group"][aria-label="Message actions"]',
    feedbackButton: 'button[aria-label="Give positive feedback"]'
  };

  const DELAYS = {
    startup: 700,
    afterScroll: 100,
    afterClick: 250,
    maxClipboardWait: 4000,
    clipboardPoll: 50
  };

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function sanitizeFilename(title) {
    const cleaned = String(title || "")
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
      .substring(0, 100);

    return cleaned || "claude_conversation";
  }

  function getConversationTitle() {
    const titleElement = document.querySelector(SELECTORS.conversationTitle);
    const title = titleElement?.textContent?.trim();

    if (!title || title === "Claude" || title.includes("New conversation")) {
      return "claude_conversation";
    }

    return sanitizeFilename(title);
  }

  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], {
      type: "text/markdown;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  function createStatusIndicator() {
    const div = document.createElement("div");

    div.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 2147483647;
      background: #2196F3;
      color: white;
      padding: 10px 15px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      max-width: 420px;
      white-space: pre-wrap;
      line-height: 1.4;
    `;

    document.body.appendChild(div);
    return div;
  }

  function setStatus(message, color = "#2196F3") {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.style.background = color;
  }

  function updateStatus() {
    setStatus(
      `Human: ${humanMessages.length} | Claude: ${capturedResponses.length}`
    );
  }

  function normalizeContent(content) {
    return String(content ?? "").trim();
  }

  function pushUniqueMessage(targetArray, type, content) {
    const normalized = normalizeContent(content);

    if (!normalized) return false;

    const alreadyCaptured = targetArray.some(
      item => normalizeContent(item.content) === normalized
    );

    if (alreadyCaptured) {
      console.log(`Skipped duplicate ${type} message`);
      return false;
    }

    targetArray.push({
      type,
      content: normalized
    });

    console.log(`Captured ${type} message ${targetArray.length}`);
    updateStatus();

    return true;
  }

  function installClipboardInterceptor() {
    navigator.clipboard.writeText = function patchedWriteText(text) {
      if (captureEnabled && currentCapture) {
        const type = currentCapture === humanMessages ? "human" : "claude";
        pushUniqueMessage(currentCapture, type, text);
      }

      // Important:
      // Do NOT call the real clipboard API here.
      // Programmatic clicks often lack user activation, causing browser blocks.
      // Returning a resolved Promise makes Claude's copy handler think it succeeded.
      return Promise.resolve();
    };
  }

  function restoreClipboardInterceptor() {
    navigator.clipboard.writeText = originalWriteText;
  }

  function getCopyButtons(claudeOnly) {
    const actionGroups = Array.from(
      document.querySelectorAll(SELECTORS.messageActionsGroup)
    );

    const buttons = [];

    for (const group of actionGroups) {
      const hasFeedback = !!group.querySelector(SELECTORS.feedbackButton);

      if (hasFeedback === claudeOnly) {
        const copyButton = group.querySelector(SELECTORS.copyButton);

        if (copyButton && copyButton.offsetParent !== null) {
          buttons.push(copyButton);
        }
      }
    }

    return buttons;
  }

  async function clickAndCaptureButton(button, targetArray) {
    const beforeCount = targetArray.length;

    currentCapture = targetArray;
    captureEnabled = true;

    try {
      button.scrollIntoView({
        behavior: "instant",
        block: "nearest"
      });

      await delay(DELAYS.afterScroll);

      button.click();

      let elapsed = 0;

      while (
        elapsed < DELAYS.maxClipboardWait &&
        targetArray.length === beforeCount
      ) {
        await delay(DELAYS.clipboardPoll);
        elapsed += DELAYS.clipboardPoll;
      }

      if (targetArray.length === beforeCount) {
        console.warn("No clipboard text captured for this button.");
      }
    } catch (error) {
      console.warn("Failed to click/capture copy button:", error);
    } finally {
      captureEnabled = false;
      currentCapture = null;
      await delay(DELAYS.afterClick);
    }
  }

  async function triggerCopyButtons(buttons, targetArray, label) {
    for (let i = 0; i < buttons.length; i++) {
      setStatus(
        `Copying ${label}...\n${i + 1}/${buttons.length}\nHuman: ${humanMessages.length} | Claude: ${capturedResponses.length}`
      );

      console.log(`Clicking ${label} copy button ${i + 1}/${buttons.length}`);

      await clickAndCaptureButton(buttons[i], targetArray);
    }
  }

  function buildMarkdown() {
    const rawTitle = getConversationTitle();
    const readableTitle = rawTitle
      .replace(/_/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase());

    let markdown = `# ${readableTitle || "Conversation with Claude"}\n\n`;

    const maxLength = Math.max(humanMessages.length, capturedResponses.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < humanMessages.length) {
        markdown += `## Human\n\n${humanMessages[i].content}\n\n---\n\n`;
      }

      if (i < capturedResponses.length) {
        markdown += `## Claude\n\n${capturedResponses[i].content}\n\n---\n\n`;
      }
    }

    return markdown;
  }

  function cleanup() {
    captureEnabled = false;
    currentCapture = null;

    try {
      restoreClipboardInterceptor();
    } catch (error) {
      console.warn("Failed to restore clipboard function:", error);
    }

    setTimeout(() => {
      if (statusDiv && document.body.contains(statusDiv)) {
        document.body.removeChild(statusDiv);
      }
    }, 3000);
  }

  async function startExport() {
    try {
      statusDiv = createStatusIndicator();
      installClipboardInterceptor();
      updateStatus();

      await delay(DELAYS.startup);

      const humanButtons = getCopyButtons(false);
      const claudeButtons = getCopyButtons(true);

      console.log(`Found ${humanButtons.length} human copy buttons`);
      console.log(`Found ${claudeButtons.length} Claude copy buttons`);

      if (humanButtons.length === 0 && claudeButtons.length === 0) {
        throw new Error("No visible Claude copy buttons found on this page.");
      }

      await triggerCopyButtons(humanButtons, humanMessages, "human messages");
      await triggerCopyButtons(claudeButtons, capturedResponses, "Claude responses");

      if (humanMessages.length === 0 && capturedResponses.length === 0) {
        throw new Error("No messages were captured.");
      }

      const markdown = buildMarkdown();
      const filename = `${getConversationTitle()}.md`;

      downloadMarkdown(markdown, filename);

      setStatus(
        `Downloaded: ${filename}\nHuman: ${humanMessages.length} | Claude: ${capturedResponses.length}`,
        "#4CAF50"
      );

      console.log("Claude Markdown export complete.");
      console.log({
        filename,
        humanMessages: humanMessages.length,
        claudeResponses: capturedResponses.length
      });
    } catch (error) {
      console.error("Claude Markdown export failed:", error);
      setStatus(`Error: ${error.message}`, "#f44336");
    } finally {
      cleanup();
    }
  }

  startExport();
})();
